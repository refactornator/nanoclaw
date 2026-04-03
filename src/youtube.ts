import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);
const OUTPUT_TEMPLATE = '%(title)s [%(id)s].%(ext)s';
const YOUTUBE_DL_MODULE = 'youtube-dl-exec';

type YoutubeDlCallable = (
  url: string,
  options: Record<string, string | boolean>,
) => Promise<unknown>;

export type YoutubeDownloadFailureCode =
  | 'invalid_url'
  | 'invalid_destination'
  | 'dependency_unavailable'
  | 'network_error'
  | 'download_failed';

export type YoutubeDownloadResult =
  | {
      ok: true;
      sourceUrl: string;
      destinationDir: string;
      filePath: string;
      fileName: string;
    }
  | {
      ok: false;
      code: YoutubeDownloadFailureCode;
      error: string;
    };

let youtubeDlLoader: (() => Promise<unknown>) | null = null;

export function __setYoutubeDlLoaderForTesting(
  loader: (() => Promise<unknown>) | null,
): void {
  youtubeDlLoader = loader;
}

function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return false;

    if (url.hostname.toLowerCase() === 'youtu.be') {
      return url.pathname.length > 1;
    }

    return (
      (url.pathname === '/watch' && url.searchParams.has('v')) ||
      url.pathname.startsWith('/shorts/') ||
      url.pathname.startsWith('/live/') ||
      url.pathname.startsWith('/embed/')
    );
  } catch {
    return false;
  }
}

function resolveDownloader(moduleValue: unknown): YoutubeDlCallable | null {
  if (typeof moduleValue === 'function') return moduleValue as YoutubeDlCallable;

  if (
    moduleValue &&
    typeof moduleValue === 'object' &&
    'default' in moduleValue &&
    typeof moduleValue.default === 'function'
  ) {
    return moduleValue.default as YoutubeDlCallable;
  }

  return null;
}

async function loadDownloader(): Promise<YoutubeDlCallable> {
  const moduleValue = youtubeDlLoader
    ? await youtubeDlLoader()
    : await import(YOUTUBE_DL_MODULE as string);
  const downloader = resolveDownloader(moduleValue);

  if (!downloader) {
    throw new Error('youtube-dl-exec is not available on this host');
  }

  return downloader;
}

function extractOutputPath(rawOutput: unknown, destinationDir: string): string | null {
  const text =
    typeof rawOutput === 'string'
      ? rawOutput
      : Buffer.isBuffer(rawOutput)
        ? rawOutput.toString('utf8')
        : '';
  const filePath = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!filePath) return null;
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(destinationDir, filePath);
}

function classifyDownloadError(err: unknown): YoutubeDownloadResult {
  const details = [
    err instanceof Error ? err.message : String(err),
    typeof err === 'object' && err && 'stderr' in err ? String(err.stderr) : '',
    typeof err === 'object' && err && 'stdout' in err ? String(err.stdout) : '',
  ]
    .join('\n')
    .toLowerCase();

  if (details.includes('unsupported url') || details.includes('invalid url')) {
    return {
      ok: false,
      code: 'invalid_url',
      error: 'Please provide a valid YouTube video URL.',
    };
  }

  if (
    details.includes('python3') ||
    details.includes('yt-dlp') ||
    details.includes('youtube-dl-exec') ||
    details.includes('cannot find package') ||
    details.includes('cannot find module') ||
    details.includes('enoent')
  ) {
    return {
      ok: false,
      code: 'dependency_unavailable',
      error:
        'YouTube downloads are unavailable because the downloader is not installed correctly on this host.',
    };
  }

  if (
    details.includes('timed out') ||
    details.includes('network is unreachable') ||
    details.includes('temporary failure in name resolution') ||
    details.includes('unable to download webpage') ||
    details.includes('econnreset') ||
    details.includes('econnrefused') ||
    details.includes('enotfound') ||
    details.includes('eai_again')
  ) {
    return {
      ok: false,
      code: 'network_error',
      error: 'Unable to reach YouTube right now. Please try again.',
    };
  }

  return {
    ok: false,
    code: 'download_failed',
    error: 'Unable to download this YouTube video.',
  };
}

export async function downloadYouTubeVideo(
  youtubeUrl: string,
  destinationDir: string,
): Promise<YoutubeDownloadResult> {
  const trimmedUrl = youtubeUrl.trim();
  const trimmedDestinationDir = destinationDir.trim();

  if (!isYouTubeUrl(trimmedUrl)) {
    return {
      ok: false,
      code: 'invalid_url',
      error: 'Please provide a valid YouTube video URL.',
    };
  }

  if (!trimmedDestinationDir) {
    return {
      ok: false,
      code: 'invalid_destination',
      error: 'Please provide a destination directory.',
    };
  }

  const resolvedDestinationDir = path.resolve(trimmedDestinationDir);

  try {
    fs.mkdirSync(resolvedDestinationDir, { recursive: true });

    const downloader = await loadDownloader();
    const rawOutput = await downloader(trimmedUrl, {
      noPlaylist: true,
      noWarnings: true,
      restrictFilenames: true,
      output: path.join(resolvedDestinationDir, OUTPUT_TEMPLATE),
      print: 'after_move:filepath',
    });
    const filePath = extractOutputPath(rawOutput, resolvedDestinationDir);

    if (!filePath) {
      logger.warn({ sourceUrl: trimmedUrl }, 'YouTube download returned no file path');
      return {
        ok: false,
        code: 'download_failed',
        error: 'Unable to determine where the YouTube video was saved.',
      };
    }

    const fileName = path.basename(filePath);
    logger.info({ filePath, sourceUrl: trimmedUrl }, 'Downloaded YouTube video');

    return {
      ok: true,
      sourceUrl: trimmedUrl,
      destinationDir: resolvedDestinationDir,
      filePath,
      fileName,
    };
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EACCES') {
      return {
        ok: false,
        code: 'invalid_destination',
        error: 'Could not create the destination directory.',
      };
    }

    logger.error(
      { err, sourceUrl: trimmedUrl, destinationDir: resolvedDestinationDir },
      'YouTube download failed',
    );
    return classifyDownloadError(err);
  }
}