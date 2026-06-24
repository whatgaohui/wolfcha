import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wolfcha LLM proxy — backed by z.ai's LLM (z-ai-web-dev-sdk).
 *
 * Accepts OpenAI-compatible requests in the same shape the frontend (src/lib/llm.ts) sends:
 *   - Single:  { model, messages, temperature, max_tokens, stream, reasoning, response_format }
 *   - Batch:   { requests: [...] }
 *
 * Non-streaming response: { id, choices: [{ message: { role, content }, finish_reason }], usage }
 * Streaming response:     SSE "data: {json}\n\n" lines, ending with "data: [DONE]"
 *
 * The z.ai SDK manages its own credentials internally, so no per-user API keys are required.
 */

type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string | LLMContentPart[];
}

interface GenerateOptions {
  model?: string;
  messages: LLMMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  reasoning?: { enabled: boolean; effort?: string; max_tokens?: number };
  reasoning_effort?: string;
  response_format?:
    | { type: "text" }
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: { name: string; schema: unknown } };
  provider?: string;
}

/** Flatten wolfcha's multipart content into a plain string for the z.ai SDK. */
function flattenContent(content: string | LLMContentPart[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "image_url") return "[image]";
      if (part.type === "input_audio") return "[audio]";
      return "";
    })
    .join("");
}

/** Convert wolfcha LLMMessage[] into z.ai ChatMessage[], keeping roles as-is. */
function toZaiMessages(messages: LLMMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content: flattenContent(m.content),
  }));
}

/** Build the z.ai request body from wolfcha GenerateOptions. */
function buildZaiBody(options: GenerateOptions) {
  const body: Record<string, unknown> = {
    messages: toZaiMessages(options.messages),
    stream: Boolean(options.stream),
    // z.ai SDK uses `thinking: { type: 'enabled' | 'disabled' }`.
    thinking: { type: "disabled" },
  };

  if (typeof options.temperature === "number" && Number.isFinite(options.temperature)) {
    body.temperature = options.temperature;
  }
  if (typeof options.max_tokens === "number" && Number.isFinite(options.max_tokens)) {
    body.max_tokens = Math.max(16, Math.floor(options.max_tokens));
  }

  // Map wolfcha reasoning options to z.ai thinking.
  if (options.reasoning?.enabled) {
    body.thinking = { type: "enabled" };
  }

  // response_format passthrough (json_object / json_schema help keep JSON output valid).
  if (options.response_format) {
    if (options.response_format.type === "json_object") {
      body.response_format = { type: "json_object" };
    } else if (options.response_format.type === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: options.response_format.json_schema,
      };
    }
  }

  return body;
}

/** Singleton ZAI instance to avoid re-initialising on every request. */
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
      // Retry on 429 (rate limit) and 5xx; otherwise throw immediately.
      const isRetryable = msg.includes("429") || msg.includes("status 5") || msg.includes("Too many requests");
      if (!isRetryable || attempt === maxAttempts) throw err;
      // Exponential backoff: 2s, 4s, 8s…
      const backoffMs = 2000 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Non-streaming single completion → returns JSON. */
async function handleSingle(options: GenerateOptions): Promise<Response> {
  const zai = await getZai();
  const body = buildZaiBody({ ...options, stream: false });

  const result = await withRetry(() => zai.chat.completions.create(body));

  // Normalise to the OpenAI-compatible shape the frontend expects.
  const normalised = {
    id: result?.id ?? `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    choices: (result?.choices ?? []).map(
      (c: { message?: { role?: string; content?: string }; finish_reason?: string }, i: number) => ({
        index: i,
        message: {
          role: c?.message?.role ?? "assistant",
          content: c?.message?.content ?? "",
        },
        finish_reason: c?.finish_reason ?? "stop",
      })
    ),
    usage: {
      prompt_tokens: result?.usage?.prompt_tokens ?? 0,
      completion_tokens: result?.usage?.completion_tokens ?? 0,
      total_tokens: result?.usage?.total_tokens ?? 0,
    },
  };

  return NextResponse.json(normalised);
}

/** Streaming single completion → pipes z.ai SSE ReadableStream straight through. */
async function handleStream(options: GenerateOptions): Promise<Response> {
  const zai = await getZai();
  const body = buildZaiBody({ ...options, stream: true });

  const stream = (await zai.chat.completions.create(body)) as ReadableStream<Uint8Array> | null;

  if (!stream) {
    return NextResponse.json({ error: "No stream from z.ai" }, { status: 502 });
  }

  // The z.ai SDK returns a ReadableStream that already emits SSE "data:" lines.
  // Pass it through unchanged so the frontend SSE parser (src/lib/llm.ts) works as-is.
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/** Batch completion → runs all requests, returns { results: [...] }. */
async function handleBatch(requests: GenerateOptions[]): Promise<Response> {
  const zai = await getZai();

  const results = await Promise.all(
    requests.map(async (options): Promise<Record<string, unknown>> => {
      try {
        const body = buildZaiBody({ ...options, stream: false });
        const result = await withRetry(() => zai.chat.completions.create(body));
        const normalised = {
          id: result?.id ?? `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          choices: (result?.choices ?? []).map(
            (c: { message?: { role?: string; content?: string }; finish_reason?: string }, i: number) => ({
              index: i,
              message: {
                role: c?.message?.role ?? "assistant",
                content: c?.message?.content ?? "",
              },
              finish_reason: c?.finish_reason ?? "stop",
            })
          ),
          usage: {
            prompt_tokens: result?.usage?.prompt_tokens ?? 0,
            completion_tokens: result?.usage?.completion_tokens ?? 0,
            total_tokens: result?.usage?.total_tokens ?? 0,
          },
        };
        return { ok: true, data: normalised };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
        return { ok: false, error: message, status };
      }
    })
  );

  return NextResponse.json({ results });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = (await req.json().catch(() => ({}))) as Partial<GenerateOptions> & { requests?: GenerateOptions[] };

    // Batch mode: { requests: [...] }
    if (Array.isArray(parsed.requests) && parsed.requests.length > 0) {
      return await handleBatch(parsed.requests);
    }

    // Single mode
    if (!parsed.messages || !Array.isArray(parsed.messages) || parsed.messages.length === 0) {
      return NextResponse.json({ error: "Missing 'messages' array" }, { status: 400 });
    }

    if (parsed.stream) {
      return await handleStream(parsed as GenerateOptions);
    }
    return await handleSingle(parsed as GenerateOptions);
  } catch (error: unknown) {
    console.error("[api/chat] error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    // Detect z.ai rate-limit / quota exhaustion and return 429 so the frontend
    // can surface a clear "quota exhausted" message instead of a generic error.
    const isRateLimited = message.includes("429") || message.includes("Too many requests");
    if (isRateLimited) {
      return NextResponse.json(
        {
          error: "[QUOTA_EXHAUSTED] z.ai 每日调用额度已用尽 (HTTP 429 Too many requests)。请稍后重试或等待额度重置。",
        },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
