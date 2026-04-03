import path from 'path';
import { fileURLToPath } from 'url';

import { downloadYouTubeVideo } from './youtube.js';

const USAGE = 'Usage: npm run youtube:download -- <youtube-url> <destination-dir>';

type CliDependencies = {
  download: typeof downloadYouTubeVideo;
  writeStdout: (message: string) => void;
  writeStderr: (message: string) => void;
};

export async function runYouTubeDownloadCli(
  args: string[],
  deps: CliDependencies = {
    download: downloadYouTubeVideo,
    writeStdout: console.log,
    writeStderr: console.error,
  },
): Promise<number> {
  const [youtubeUrl = '', destinationDir = '', ...extraArgs] = args;

  if (extraArgs.length > 0 || !youtubeUrl.trim() || !destinationDir.trim()) {
    deps.writeStderr(USAGE);
    return 1;
  }

  const result = await deps.download(youtubeUrl, destinationDir);

  if (!result.ok) {
    deps.writeStderr(`Download failed (${result.code}): ${result.error}`);
    return 1;
  }

  deps.writeStdout(`Downloaded YouTube video to ${result.filePath}`);
  return 0;
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  return Boolean(entryPath) && path.resolve(entryPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  const exitCode = await runYouTubeDownloadCli(process.argv.slice(2));
  process.exitCode = exitCode;
}