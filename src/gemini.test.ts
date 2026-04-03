import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEnv,
  mockGenerateContent,
  mockGetGenerativeModel,
  mockGoogleGenerativeAI,
  mockLogger,
} = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string>,
  mockGenerateContent: vi.fn(),
  mockGetGenerativeModel: vi.fn(),
  mockGoogleGenerativeAI: vi.fn(),
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

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn((keys: string[]) => {
    const values: Record<string, string> = {};
    for (const key of keys) {
      if (mockEnv[key] !== undefined) values[key] = mockEnv[key];
    }
    return values;
  }),
}));

vi.mock('./logger.js', () => ({ logger: mockLogger }));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: mockGoogleGenerativeAI,
}));

import { analyzeImage, analyzeVideo, isGeminiEnabled } from './gemini.js';

describe('gemini wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockEnv)) delete mockEnv[key];

    mockGetGenerativeModel.mockImplementation(() => ({
      generateContent: mockGenerateContent,
    }));
    mockGoogleGenerativeAI.mockImplementation(function () {
      return {
        getGenerativeModel: mockGetGenerativeModel,
      };
    });
  });

  it('enables Gemini only for non-empty configured API keys', () => {
    expect(isGeminiEnabled()).toBe(false);

    mockEnv.GEMINI_API_KEY = '   ';
    expect(isGeminiEnabled()).toBe(false);

    mockEnv.GEMINI_API_KEY = 'test-key';
    expect(isGeminiEnabled()).toBe(true);
  });

  it('returns null without creating a client when Gemini is disabled', async () => {
    const result = await analyzeImage(Buffer.from('image-bytes'));

    expect(result).toBeNull();
    expect(mockGoogleGenerativeAI).not.toHaveBeenCalled();
  });

  it('uses the flash model and includes caption context for image analysis', async () => {
    mockEnv.GEMINI_API_KEY = 'test-key';
    mockGenerateContent.mockResolvedValue({
      response: {
        text: vi.fn().mockReturnValue('  A beach at sunset.  '),
      },
    });

    const buffer = Buffer.from('image-bytes');
    const result = await analyzeImage(buffer, 'image/png', 'Scenic beach');

    expect(result).toBe('A beach at sunset.');
    expect(mockGoogleGenerativeAI).toHaveBeenCalledWith('test-key');
    expect(mockGetGenerativeModel).toHaveBeenCalledWith({
      model: 'gemini-1.5-flash-latest',
    });
    expect(mockGenerateContent).toHaveBeenCalledWith([
      {
        text: expect.stringContaining(
          'Caption/context from sender: Scenic beach',
        ),
      },
      {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType: 'image/png',
        },
      },
    ]);
  });

  it('returns an oversized-video fallback without calling Gemini', async () => {
    mockEnv.GEMINI_API_KEY = 'test-key';
    mockEnv.GEMINI_MAX_VIDEO_MB = '1';

    const result = await analyzeVideo(
      Buffer.alloc(2 * 1024 * 1024),
      'video/mp4',
      'Large clip',
    );

    expect(result).toBe('[Video analysis unavailable: file exceeds 1 MB limit]');
    expect(mockGoogleGenerativeAI).not.toHaveBeenCalled();
  });

  it('falls back to the default 20 MB video limit when env is invalid', async () => {
    mockEnv.GEMINI_MAX_VIDEO_MB = 'invalid';

    const result = await analyzeVideo(Buffer.alloc(21 * 1024 * 1024));

    expect(result).toBe(
      '[Video analysis unavailable: file exceeds 20 MB limit]',
    );
    expect(mockGoogleGenerativeAI).not.toHaveBeenCalled();
  });

  it('logs and returns null when Gemini analysis fails', async () => {
    mockEnv.GEMINI_API_KEY = 'test-key';
    mockGenerateContent.mockResolvedValue({
      response: {
        text: vi.fn(() => {
          throw new Error('blocked');
        }),
      },
    });

    const result = await analyzeVideo(
      Buffer.from('video-bytes'),
      'video/mp4',
      'Check this out',
    );

    expect(result).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Gemini video analysis failed',
    );
  });
});