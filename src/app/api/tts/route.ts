import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wolfcha TTS proxy — backed by z.ai's TTS (z-ai-web-dev-sdk).
 *
 * Request:  { text: string, voiceId: string }
 * Response: raw audio bytes (mp3) with a sniffed Content-Type.
 *
 * The z.ai SDK manages its own credentials internally, so no per-user keys are required.
 * Available voices: tongtong, chuichui, xiaochen, jam, kazi, douji, luodo.
 * Input text is limited to 1024 chars per request by the z.ai API.
 */

const MAX_INPUT_LENGTH = 1024;

// Voices supported by z.ai TTS. Any voiceId that isn't one of these falls back
// to a gender-appropriate default so AI players always get audio.
const ZAI_VOICES = new Set(["tongtong", "chuichui", "xiaochen", "jam", "kazi", "douji", "luodo"]);

const DEFAULT_VOICE = {
  male: "douji",
  female: "tongtong",
};

function pickVoice(voiceId: string): string {
  const v = (voiceId || "").trim();
  if (v && ZAI_VOICES.has(v)) return v;
  // Heuristic: treat voiceIds containing "male"/"man"/"gentle" as male, else female.
  const lower = v.toLowerCase();
  if (lower.includes("male") || lower.includes("man") || lower.includes("gentle") || lower.includes("diligent")) {
    return DEFAULT_VOICE.male;
  }
  return DEFAULT_VOICE.female;
}

function sniffAudioMime(buffer: Buffer): { mime: string | null; reason?: string } {
  if (!buffer || buffer.length < 4) return { mime: null, reason: "empty_or_too_short" };
  // WAV
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString("ascii") === "RIFF" &&
    buffer.slice(8, 12).toString("ascii") === "WAVE"
  ) {
    return { mime: "audio/wav" };
  }
  // OGG
  if (buffer.slice(0, 4).toString("ascii") === "OggS") {
    return { mime: "audio/ogg" };
  }
  // MP3
  if (buffer.slice(0, 3).toString("ascii") === "ID3") return { mime: "audio/mpeg" };
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return { mime: "audio/mpeg" };
  // If it looks like text/json, treat as non-audio
  const head = buffer.slice(0, 64).toString("utf8").trim();
  if (head.startsWith("{") || head.startsWith("[") || head.toLowerCase().includes("error")) {
    return { mime: null, reason: "looks_like_text_or_json" };
  }
  return { mime: null, reason: "unknown_format" };
}

function splitTextIntoChunks(text: string, maxLength = MAX_INPUT_LENGTH): string[] {
  const chunks: string[] = [];
  const sentences = text.match(/[^.!?。！？\n]+[.!?。！？\n]+/g) || [text];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLength) {
      current += sentence;
    } else {
      if (current) chunks.push(current.trim());
      current = sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

let zaiPromise: Promise<ZAI> | null = null;
async function getZai(): Promise<ZAI> {
  if (!zaiPromise) {
    zaiPromise = ZAI.create();
  }
  return zaiPromise;
}

/** Retry wrapper that handles transient z.ai 429 / 5xx errors with backoff. */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = msg.includes("429") || msg.includes("status 5") || msg.includes("Too many requests");
      if (!isRetryable || attempt === maxAttempts) throw err;
      const backoffMs = 2000 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function POST(req: NextRequest) {
  try {
    const parsed = (await req.json().catch(() => ({} as any))) as {
      text?: string;
      voiceId?: string;
    };

    const text = typeof parsed.text === "string" ? parsed.text : String(parsed.text ?? "");
    const voiceId = typeof parsed.voiceId === "string" ? parsed.voiceId : String(parsed.voiceId ?? "");

    const normText = text.trim();
    const normVoiceId = voiceId.trim();

    if (!normText || !normVoiceId) {
      return NextResponse.json({ error: "Missing text or voiceId" }, { status: 400 });
    }

    const zai = await getZai();
    const voice = pickVoice(normVoiceId);

    // z.ai TTS limits input to 1024 chars. Split longer text and concatenate audio.
    const chunks = splitTextIntoChunks(normText, MAX_INPUT_LENGTH);
    const buffers: Buffer[] = [];

    for (const chunk of chunks) {
      const response = await withRetry(() =>
        zai.audio.tts.create({
          input: chunk,
          voice,
          speed: 1.0,
          response_format: "mp3",
          stream: false,
        })
      );

      const arrayBuffer = await (response as Response).arrayBuffer();
      buffers.push(Buffer.from(new Uint8Array(arrayBuffer)));
    }

    const audioBuffer = buffers.length === 1 ? buffers[0] : Buffer.concat(buffers);

    const sniff = sniffAudioMime(audioBuffer);
    if (!sniff.mime) {
      const preview = audioBuffer.slice(0, 400).toString("utf8");
      return NextResponse.json(
        {
          error: "TTS audio is not in a supported format.",
          reason: sniff.reason,
          byteLength: audioBuffer.length,
          preview,
        },
        { status: 502 }
      );
    }

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": sniff.mime,
        "Content-Length": audioBuffer.length.toString(),
        "Cache-Control": "no-cache",
        "X-Zai-Voice": voice,
      },
    });
  } catch (error: unknown) {
    console.error("[api/tts] error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
