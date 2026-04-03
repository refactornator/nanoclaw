import { describe, expect, it, vi } from 'vitest';

import { runYouTubeDownloadCli } from './youtube-cli.js';

describe('runYouTubeDownloadCli', () => {
  it('prints usage and exits non-zero when args are missing', async () => {
    const writeStdout = vi.fn();
    const writeStderr = vi.fn();
    const download = vi.fn();

    const exitCode = await runYouTubeDownloadCli(['https://youtu.be/abc123def45'], {
      download,
      writeStdout,
      writeStderr,
    });

    expect(exitCode).toBe(1);
    expect(writeStdout).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(writeStderr).toHaveBeenCalledWith(
      'Usage: npm run youtube:download -- <youtube-url> <destination-dir>',
    );
  });

  it('reports the saved file path on success', async () => {
    const writeStdout = vi.fn();
    const writeStderr = vi.fn();
    const download = vi.fn().mockResolvedValue({
      ok: true,
      sourceUrl: 'https://www.youtube.com/watch?v=abc123def45',
      destinationDir: '/tmp/videos',
      filePath: '/tmp/videos/Test_Video [abc123].mp4',
      fileName: 'Test_Video [abc123].mp4',
    });

    const exitCode = await runYouTubeDownloadCli(
      ['https://www.youtube.com/watch?v=abc123def45', '/tmp/videos'],
      {
        download,
        writeStdout,
        writeStderr,
      },
    );

    expect(exitCode).toBe(0);
    expect(download).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=abc123def45',
      '/tmp/videos',
    );
    expect(writeStderr).not.toHaveBeenCalled();
    expect(writeStdout).toHaveBeenCalledWith(
      'Downloaded YouTube video to /tmp/videos/Test_Video [abc123].mp4',
    );
  });

  it('prints a friendly failure message and exits non-zero on download errors', async () => {
    const writeStdout = vi.fn();
    const writeStderr = vi.fn();
    const download = vi.fn().mockResolvedValue({
      ok: false,
      code: 'invalid_url',
      error: 'Please provide a valid YouTube video URL.',
    });

    const exitCode = await runYouTubeDownloadCli(
      ['https://example.com/video', '/tmp/videos'],
      {
        download,
        writeStdout,
        writeStderr,
      },
    );

    expect(exitCode).toBe(1);
    expect(writeStdout).not.toHaveBeenCalled();
    expect(writeStderr).toHaveBeenCalledWith(
      'Download failed (invalid_url): Please provide a valid YouTube video URL.',
    );
  });
});