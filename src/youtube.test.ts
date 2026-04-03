import path from 'path';
import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDownloader, mockLogger } = vi.hoisted(() => ({
  mockDownloader: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
    },
  };
});

vi.mock('./logger.js', () => ({ logger: mockLogger }));

import {
  __setYoutubeDlLoaderForTesting,
  downloadYouTubeVideo,
} from './youtube.js';

describe('downloadYouTubeVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    __setYoutubeDlLoaderForTesting(async () => mockDownloader);
  });

  afterEach(() => {
    __setYoutubeDlLoaderForTesting(null);
  });

  it('creates the destination directory and returns the saved file path', async () => {
    mockDownloader.mockResolvedValue('/tmp/videos/Test_Video [abc123].mp4\n');

    const result = await downloadYouTubeVideo(
      'https://www.youtube.com/watch?v=abc123def45',
      '/tmp/videos',
    );

    expect(result).toEqual({
      ok: true,
      sourceUrl: 'https://www.youtube.com/watch?v=abc123def45',
      destinationDir: path.resolve('/tmp/videos'),
      filePath: '/tmp/videos/Test_Video [abc123].mp4',
      fileName: 'Test_Video [abc123].mp4',
    });
    expect(fs.mkdirSync).toHaveBeenCalledWith(path.resolve('/tmp/videos'), {
      recursive: true,
    });
    expect(mockDownloader).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=abc123def45',
      expect.objectContaining({
        noPlaylist: true,
        noWarnings: true,
        restrictFilenames: true,
        output: path.join(path.resolve('/tmp/videos'), '%(title)s [%(id)s].%(ext)s'),
        print: 'after_move:filepath',
      }),
    );
  });

  it('rejects invalid YouTube URLs without invoking the downloader', async () => {
    const result = await downloadYouTubeVideo(
      'https://example.com/watch?v=abc123def45',
      '/tmp/videos',
    );

    expect(result).toEqual({
      ok: false,
      code: 'invalid_url',
      error: 'Please provide a valid YouTube video URL.',
    });
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(mockDownloader).not.toHaveBeenCalled();
  });

  it('rejects blank destination directories safely', async () => {
    const result = await downloadYouTubeVideo(
      'https://youtu.be/abc123def45',
      '   ',
    );

    expect(result).toEqual({
      ok: false,
      code: 'invalid_destination',
      error: 'Please provide a destination directory.',
    });
    expect(mockDownloader).not.toHaveBeenCalled();
  });

  it('maps downloader timeouts to a friendly network error', async () => {
    mockDownloader.mockRejectedValue(
      Object.assign(new Error('request timed out'), {
        stderr: 'ERROR: unable to download webpage: timed out',
      }),
    );

    const result = await downloadYouTubeVideo(
      'https://www.youtube.com/watch?v=abc123def45',
      '/tmp/videos',
    );

    expect(result).toEqual({
      ok: false,
      code: 'network_error',
      error: 'Unable to reach YouTube right now. Please try again.',
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'YouTube download failed',
    );
  });
});