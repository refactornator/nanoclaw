import { GoogleGenerativeAI, type Part } from '@google/generative-ai';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const GEMINI_MODEL = 'gemini-1.5-flash-latest';
const DEFAULT_MAX_VIDEO_MB = 20;

function readGeminiConfig(): { apiKey: string; maxVideoMb: number } {
  const env = readEnvFile(['GEMINI_API_KEY', 'GEMINI_MAX_VIDEO_MB']);
  const apiKey = (env.GEMINI_API_KEY ?? '').trim();
  const parsedMaxVideoMb = Number.parseFloat(env.GEMINI_MAX_VIDEO_MB ?? '');

  return {
    apiKey,
    maxVideoMb:
      Number.isFinite(parsedMaxVideoMb) && parsedMaxVideoMb > 0
        ? parsedMaxVideoMb
        : DEFAULT_MAX_VIDEO_MB,
  };
}

function buildPrompt(kind: 'image' | 'video', caption?: string): string {
  const prompt =
    kind === 'image'
      ? 'Describe this image for a chat assistant. Keep it concise and focus on the most relevant visible details.'
      : 'Describe this video for a chat assistant. Keep it concise and focus on the most relevant visible actions and details.';

  const trimmedCaption = caption?.trim();
  if (!trimmedCaption) return prompt;

  return `${prompt}\n\nCaption/context from sender: ${trimmedCaption}`;
}

function buildInlineParts(
  prompt: string,
  buffer: Buffer,
  mimeType: string,
): Part[] {
  return [
    { text: prompt },
    {
      inlineData: {
        data: buffer.toString('base64'),
        mimeType,
      },
    },
  ];
}

async function analyzeMedia(
  kind: 'image' | 'video',
  buffer: Buffer,
  mimeType: string,
  caption?: string,
): Promise<string | null> {
  try {
    if (!buffer || buffer.length === 0) return null;

    const { apiKey } = readGeminiConfig();
    if (!apiKey) return null;

    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent(
      buildInlineParts(buildPrompt(kind, caption), buffer, mimeType),
    );
    const text = result.response.text().trim();

    return text || null;
  } catch (err) {
    logger.error({ err }, `Gemini ${kind} analysis failed`);
    return null;
  }
}

export function isGeminiEnabled(): boolean {
  return readGeminiConfig().apiKey.length > 0;
}

export async function analyzeImage(
  buffer: Buffer,
  mimeType = 'image/jpeg',
  caption?: string,
): Promise<string | null> {
  return analyzeMedia('image', buffer, mimeType || 'image/jpeg', caption);
}

export async function analyzeVideo(
  buffer: Buffer,
  mimeType = 'video/mp4',
  caption?: string,
): Promise<string | null> {
  try {
    if (!buffer || buffer.length === 0) return null;

    const { maxVideoMb } = readGeminiConfig();
    if (buffer.length > maxVideoMb * 1024 * 1024) {
      return `[Video analysis unavailable: file exceeds ${maxVideoMb} MB limit]`;
    }

    return await analyzeMedia('video', buffer, mimeType || 'video/mp4', caption);
  } catch (err) {
    logger.error({ err }, 'Gemini video analysis failed');
    return null;
  }
}