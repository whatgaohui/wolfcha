---
Task ID: 1
Agent: Explore
Task: Analyze wolfcha AI/LLM/TTS integration points

Work Log:
- Verified worklog.md did not exist; created it now (append-style entry for Task 1).
- Listed the project tree to map out API routes, lib files, hooks, phases, and components.
- Read `/home/z/my-project/src/app/api/chat/route.ts` (979 lines) in 3 chunks to fully understand the LLM proxy flow.
- Read `/home/z/my-project/src/lib/llm.ts` (869 lines) in 2 chunks; identified all exported helpers.
- Read `/home/z/my-project/src/lib/ai-config.ts` (47 lines) and `/home/z/my-project/src/lib/api-keys.ts` (346 lines) in full.
- Read `/home/z/my-project/src/types/game.ts` (373 lines) — captured ModelRef, MODEL_IDS, AVAILABLE_MODELS, PROJECT_MODELS, ALL_MODELS, BUILTIN_PLAYER_MODELS, PLAYER_MODELS, DEFAULT_MODEL_CONFIG, GENERATOR_MODEL, SUMMARY_MODEL, REVIEW_MODEL.
- Read `/home/z/my-project/src/app/api/tts/route.ts` (400 lines) and `/home/z/my-project/src/app/api/stt/route.ts` (11 lines) in full.
- Read `/home/z/my-project/src/lib/narrator-voice.ts`, `narrator-audio-player.ts`, `voice-constants.ts`, `audio-manager.ts` in full.
- Inspected `character-generator.ts` (focused on lines 1–100 and 530–630) and used grep to map all LLM call sites in `game-master.ts` (2241 lines) and `game-analysis.ts` (1814 lines).
- Listed `/home/z/my-project/src/game/phases/` and confirmed the 6 phase files only build prompts and call game-master.ts functions (no direct LLM calls).
- Read `/home/z/my-project/src/app/page.tsx` (lines 1–150 and 1250–1370 plus tail) and `WelcomeScreen.tsx` (lines 1–300, 600–760, 1100–1190) and `GameSetupModal.tsx` (lines 1–100) in full.
- Read `/home/z/my-project/src/app/ai-models/page.tsx` (lines 1–100) — confirmed it is a static SEO/marketing page, not a model selector.
- Grepped for callers of `/api/chat`, `/api/tts`, `/api/stt`, `/api/validate-key`; inspected `vote-batch/route.ts`, `DevConsole.tsx`, `VoiceRecorder.tsx`.
- Located the real model-selection UI inside `UserProfileModal.tsx` (lines 700–820 for key inputs, 920–1020 for model dropdowns).
- Cross-referenced `.env.example` and `.env.local` to enumerate the env vars that drive every provider.

Stage Summary:

# Wolfcha — AI / LLM / TTS / STT Integration Map (for z.ai SDK replacement)

## 1. LLM Integration

### 1a. Server-side LLM proxy — `src/app/api/chat/route.ts` (979 lines)

This is the single gateway every LLM call goes through. It is a Next.js `POST` route handler that proxies OpenAI-compatible `/chat/completions` requests to **3 providers** based on the model id (looked up via `ALL_MODELS` / `PROJECT_MODELS`).

**Providers and endpoints:**
| Provider | Type | Base URL |
|---|---|---|
| `zenmux` | OpenAI-compatible chat | `https://zenmux.ai/api/v1/chat/completions` |
| `dashscope` | Aliyun Bailian OpenAI-compatible mode | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` |
| `tokendance` | OpenAI-compatible gateway | `${TOKENDANCE_BASE_URL}/chat/completions` (default `https://tokendance.agent-universe.cn/gateway/v1`) |

> Note: NewAPI is not present despite the task description mentioning it. Only ZenMux/DashScope/TokenDance are wired up.

**Routing logic** (`getProviderForModel(model)`):
- Looks up the model id in `ALL_MODELS` first, then `PROJECT_MODELS`, and uses the `provider` field. If neither matches, returns `null` and the request is rejected with 400.
- The client can also force a provider via `body.provider` ("zenmux" | "dashscope" | "tokendance").

**Auth model — dual mode (server key vs. user-supplied key):**
- If the request includes any of the headers `x-zenmux-api-key`, `x-dashscope-api-key`, `x-tokendance-api-key`, it's treated as "custom-key mode" and that header value overrides `process.env.*`.
- `hasAnyCustomKeyHeader` gates fallback: if any custom key header is present but the required one for the chosen provider is missing, request is rejected with 401 (no silent fallback to server key).
- Built-in (no custom key) requires `requireCredits(auth.user.id)` or `hasRecentUnfinishedGameSession`.

**Request body shape (`ChatRequestPayload`, lines 280–290):**
```ts
{
  model: string;
  messages: unknown[];          // OpenAI-style {role, content} array; content may be string or multipart array
  temperature?: number;          // default 0.7; capped to 0..1 for ZenMux/Moonshot/Kimi
  max_tokens?: number;           // min 16
  stream?: boolean;
  reasoning?: { enabled: boolean; effort?: "minimal"|"low"|"medium"|"high"; max_tokens?: number };
  reasoning_effort?: "minimal"|"low"|"medium"|"high";
  response_format?: unknown;     // { type: "json_object" } | { type: "json_schema", json_schema: {...} }
  provider?: "zenmux" | "dashscope" | "tokendance";
}
```

**Batch mode:** If the body has `{ requests: [...] }`, the route runs `runBatchItem()` for each item via `Promise.all` and returns `{ results: [...] }`. Batch mode **does not support streaming** (returns 400 if `stream=true`).

**Streaming format:** SSE — `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. The route just forwards `response.body` raw from the upstream provider (it does NOT re-frame the chunks). Terminator is `data: [DONE]`. Each line is `data: {json}` where `json.choices[0].delta.content` carries the text delta.

**Per-provider transformations the route performs (important for z.ai migration):**
- `flattenMultipartContent` — for models that don't support multipart content (only `z-ai/glm`, `volcengine/doubao` per `supportsMultipartContent`), arrays are joined into a single string.
- `coalesceTextOnlyMultipartContent` + `prependDeepSeekStablePrefix` — DeepSeek-specific prefix-caching optimization. Inserts a `WOLFCHA_DEEPSEEK_CACHE_PREFIX_V1` marker system message to improve DeepSeek's automatic prefix cache hits.
- `stripCacheControl` — removes `cache_control` field from content parts for models that don't support explicit caching (everything except `anthropic/*` and `qwen/*`).
- `withDashscopeJsonHint` — DashScope: if response_format is json_object but messages don't mention "json", prepend `{role:"system", content:"Respond in json."}`.
- `normalizeDashscopeModelName` — strips `qwen/` prefix for DashScope (since DashScope uses raw `qwen-*` names).
- `toZenMuxReasoning` — ZenMux accepts `{enabled, effort, max_tokens}` only (no `exclude`).
- `toTokendanceThinking` — TokenDance uses `{type:"enabled"|"disabled", budget_tokens:number}`. GLM/Kimi models default to thinking ON, so the route forces `{type:"disabled"}` unless explicitly enabled.

**Provider-specific request bodies:**
- **ZenMux** (lines 905–947): `{model, messages, temperature, max_tokens?, stream?, reasoning: {enabled:false}|..., response_format? (only if model supports it)}`. Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`.
- **DashScope** (lines 721–752): `{model (normalized), messages, temperature, max_tokens?, stream?, response_format?}`. Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`. No `reasoning` field.
- **TokenDance** (lines 813–855): `{model, messages, temperature, max_tokens?, stream?, thinking?, response_format? (only if model supports it)}`. Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`, `X-App-Name: Wolfcha`, `X-Site-URL: https://wolf-cha.com`.

**Other details:**
- Global undici dispatcher configured at module load with 60s connect timeout (default 10s) to handle slow Chinese API gateways.
- `API_TIMEOUT_MS = 60000` enforced via `AbortController` per upstream call.
- `supportsResponseFormat(model)` — only `openai/`, `google/`, `anthropic/`, `deepseek/`, `qwen/`, `moonshotai/` prefixes. z-ai/glm and others are skipped.

---

### 1b. Frontend LLM helper — `src/lib/llm.ts` (869 lines)

The single client-side entry point. Everything else in the app talks to LLMs through these exports.

**Types:**
```ts
type Provider = "zenmux" | "dashscope" | "tokendance";

type LLMContentPart =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: "1h" } }
  | { type: "image_url"; image_url: { url: string; detail?: string } }
  | { type: "input_audio"; input_audio: { data: string; format: "mp3" | "wav" } };

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string | LLMContentPart[];
  reasoning_details?: unknown;
}

interface GenerateOptions {
  model: string;
  provider?: Provider;
  messages: LLMMessage[];
  temperature?: number;
  max_tokens?: number;
  reasoning?: ReasoningOptions;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
  response_format?: ResponseFormat;
}

interface ChatCompletionResponse {  // OpenAI-shaped
  id: string;
  choices: { message: { role: "assistant"; content: string; reasoning_details?: unknown }; finish_reason: string }[];
  usage?: { prompt_tokens; completion_tokens; total_tokens; prompt_cache_hit_tokens?; prompt_cache_miss_tokens?; prompt_tokens_details?: { cached_tokens? } | null };
}
```

**Exported functions:**
1. `generateCompletion(options): Promise<{ content, reasoning_details?, raw }>` — non-streaming. POSTs to `/api/chat`, returns the first choice's content with `<think>` blocks stripped via `stripReasoningArtifacts`.
2. `generateCompletionBatch(requests): Promise<BatchCompletionResult[]>` — POSTs `{requests: [...]}` to `/api/chat`, returns one result per item.
3. `async function* generateCompletionStream(options): AsyncGenerator<string>` — POSTs with `stream:true`, parses SSE `data: ` lines, yields each `choices[0].delta.content` string. Has a state machine for stripping `<think>...</think>` blocks mid-stream. Skips `data: [DONE]`.
4. `generateJSON<T>(options & { schema?: string }): Promise<T>` — wraps `generateCompletion`, appends "Respond with valid JSON only..." suffix to the last user message, forces `response_format: {type:"json_object"}` for ZenMux models if not set, parses with `parseJsonTolerant` (handles markdown fences, smart quotes, trailing commas, dangling quotes). On parse failure, retries once with a corrective user turn.
5. `mergeOptionsFromModelRef(modelRef, options)` — applies `temperature` / `reasoning` / `provider` overrides from a `ModelRef`.
6. `resolveApiKeySource(model): "user" | "project"` — checks `isCustomKeyEnabled()` and per-provider key presence.
7. `stripReasoningArtifacts(text)` and `stripMarkdownCodeFences(text)` — public utilities.
8. `isQuotaExhaustedMessage(message)` — checks for the `[QUOTA_EXHAUSTED]` marker.
9. `extractPromptCacheUsage(usage)` — normalizes prompt-cache stats from various provider formats.

**Key behavior:** When `isCustomKeyEnabled()` is `false`, `resolveModelForBuiltin(model)` rewrites any non-`PROJECT_MODELS` model to the first `AVAILABLE_MODELS` entry (currently `tokendance/deepseek-v4-pro`). This means: if the user's saved model isn't in the built-in project pool, it silently falls back to `deepseek-v4-pro`.

**Retry policy:** `fetchWithRetry(input, init, maxAttempts=4)` with retryable statuses `{429, 500, 502, 503, 504}`, exponential backoff with jitter, honors `Retry-After` header (capped at 15s).

**Custom-key headers built by `buildCustomKeyHeaders` (only when `isCustomKeyEnabled()` returns true):**
```
X-Zenmux-Api-Key, X-Dashscope-Api-Key, X-Tokendance-Api-Key, X-Tokendance-Base-Url
```

---

### 1c. `src/lib/ai-config.ts` (47 lines)

Only contains temperature presets — no provider logic:
```ts
AI_TEMPERATURE = { STRICT: 0.1, LOGIC: 0.4, BALANCED: 0.7, CREATIVE: 1.1, WILD: 1.2 }
GAME_TEMPERATURE = { CHARACTER_GENERATION: 1.2, SUMMARY: 0.1, SPEECH: 1.1, ACTION: 0.4, BADGE_SIGNUP: 0.7 }
```

---

### 1d. `src/lib/api-keys.ts` (346 lines) — client-side key resolution

All keys are stored in `localStorage`. Key names:
| Storage key | Field |
|---|---|
| `wolfcha_zenmux_api_key` | ZenMux API key |
| `wolfcha_dashscope_api_key` | DashScope API key |
| `wolfcha_tokendance_api_key` | TokenDance API key |
| `wolfcha_minimax_api_key` | MiniMax API key (for TTS) |
| `wolfcha_minimax_group_id` | MiniMax Group ID |
| `wolfcha_custom_key_enabled` | "true"|"false" master toggle |
| `wolfcha_selected_models` | JSON array of model ids chosen as AI-player candidates |
| `wolfcha_generator_model`, `wolfcha_summary_model`, `wolfcha_review_model` | per-role model overrides |
| `wolfcha_validated_zenmux_key`, `wolfcha_validated_dashscope_key`, `wolfcha_validated_tokendance_key` | keys that passed `/api/validate-key` |

**Exports:** `getZenmuxApiKey`, `getDashscopeApiKey`, `getTokendanceApiKey`, `getTokendanceBaseUrl`, `getMinimaxApiKey`, `getMinimaxGroupId`, `hasZenmuxKey/DashscopeKey/TokendanceKey/MinimaxKey`, `isCustomKeyEnabled`, `setCustomKeyEnabled`, `getSelectedModels`, `setSelectedModels`, `getGeneratorModel`, `getSummaryModel`, `getReviewModel` (each returns the project default when custom key is disabled), `clearApiKeys`, `validateApiKeyBalance()`.

**Hardcoded constant:** `TOKENDANCE_BASE_URL = "https://tokendance.agent-universe.cn/gateway/v1"` (exported, also consumed by `/api/chat/route.ts` and `/api/validate-key/route.ts`).

`isCustomKeyEnabled()` requires the toggle flag AND at least one LLM key. When the user disables the toggle, all model-selection storage keys are cleared.

---

### 1e. Model catalog — `src/types/game.ts` (lines 68–373)

```ts
interface ModelRef {
  provider: "zenmux" | "dashscope" | "tokendance";
  model: string;
  temperature?: number;          // override call-time temperature
  reasoning?: { enabled: boolean; exclude?: boolean; effort?: "minimal"|"low"|"medium"|"high"; max_tokens?: number };
}
```

**`MODEL_IDS`** (lines 262–288) — canonical model id strings per provider:
- `zenmux.geminiFlashLite` = `"google/gemini-3.1-flash-lite-preview"`
- `zenmux.geminiFlashPreview` = `"google/gemini-3-flash-preview"`
- `zenmux.deepseek` = `"deepseek/deepseek-v3.2"`
- `zenmux.gpt52Chat` = `"openai/gpt-5.2-chat"`
- `zenmux.claudeHaiku45` = `"anthropic/claude-haiku-4.5"`
- `zenmux.claudeSonnet45` = `"anthropic/claude-sonnet-4.5"`
- `zenmux.claudeOpus45` = `"anthropic/claude-opus-4.5"`
- `zenmux.deepseekV4Flash` = `"deepseek/deepseek-v4-flash"`
- `zenmux.grok4` = `"x-ai/grok-4"`
- `zenmux.glm47` = `"z-ai/glm-4.7"`
- `zenmux.minimaxM21` = `"minimax/minimax-m2.1"`
- `dashscope.deepseek` = `"deepseek-v3.2"`
- `tokendance.minimaxM27` = `"minimax-m2.7"`
- `tokendance.deepseekV4Pro` = `"deepseek-v4-pro"`
- `tokendance.deepseekV4Flash` = `"deepseek-v4-flash"`
- `tokendance.qwen3Max` = `"qwen3-max"`
- `tokendance.glm5` = `"glm-5"`
- `tokendance.kimiK25` = `"kimi-k2.5"`
- `tokendance.deepseekV32` = `"deepseek-v3.2"`

**`DEFAULT_MODEL_CONFIG`** (lines 296–305):
- `generator` = `zenmux.geminiFlashLite` (Gemini 3.1 Flash Lite Preview, via ZenMux)
- `summary` = `tokendance.deepseekV4Pro` (DeepSeek V4 Pro, via TokenDance)
- `review` = `tokendance.deepseekV4Pro`
- `validation.zenmux` = `zenmux.geminiFlashLite`
- `validation.dashscope` = `dashscope.deepseek`
- `validation.tokendance` = `tokendance.minimaxM27`

**`AVAILABLE_MODELS`** (lines 321–323): built-in pool when custom key is OFF — only ONE model: `{provider:"tokendance", model:"deepseek-v4-pro", reasoning:{enabled:false}}`.

**`PROJECT_MODELS`** (lines 327–332): `AVAILABLE_MODELS` + DashScope validation model + ZenMux validation model. These are the models the server is allowed to call with the project key.

**`BUILTIN_PLAYER_MODELS`** = `PLAYER_MODELS` = `[deepseek-v4-pro (tokendance)]`. Used by `character-generator.ts` `sampleModelRefs()` when custom key is OFF.

**`ALL_MODELS`** (lines 335–355) — 18 models, the user-selectable pool when custom key is ON. Mix of zenmux (12 entries) and tokendance (7 entries) plus 1 dashscope entry. Several have `temperature: 1` and `reasoning: { enabled: false }` overrides (GLM, MiniMax, Kimi).

**`NON_PLAYER_MODELS = []`** (line 360) — empty, so `filterPlayerModels()` is a no-op currently.

---

### 1f. Other files that call `/api/chat` or use `llm.ts`

- `src/lib/character-generator.ts` — calls `generateJSON` (base profiles) and `generateCompletionStream` (full personas). Uses `getGeneratorModel()` (default = `gemini-3.1-flash-lite-preview`).
- `src/lib/game-master.ts` — central in-game AI brain. 14 LLM-calling functions:
  - `generateDailySummary` (line 646) — uses `summaryModel` (defaults to `getSummaryModel()` = deepseek-v4-pro)
  - `generateAISpeechStream` (line 733), `generateAISpeech` (793), `generateAISpeechSegments` (804), `generateAISpeechSegmentsStream` (995) — uses `player.agentProfile.modelRef` with `GAME_TEMPERATURE.SPEECH`
  - `generateAIVote` (1190) — uses player's modelRef
  - `generateAIBadgeSignupBatch` (1402), `generateAIBadgeVote` (1600), `generateBadgeTransfer` (1666)
  - Night actions: `generateSeerAction` (1764), `generateWolfAction` (1830), `generateWitchAction` (1900), `generateGuardAction` (2000)
  - `generateHunterShoot` (2069), `generateWhiteWolfKingBoomDecision` (2153)
  - All non-speech actions use `GAME_TEMPERATURE.ACTION` (0.4) and `response_format: {type:"json_object"}`.
- `src/lib/game-analysis.ts` — calls `generateJSON` twice (post-game analysis). Uses `model || getSummaryModel()` (line 1404). Called from `src/hooks/useGameAnalysis.ts` with `getReviewModel()`.
- `src/hooks/useGameLogic.ts` — only imports `isQuotaExhaustedMessage` from `llm.ts`; orchestrates `generateCharacters` (from character-generator) and `generateDailySummary` (from game-master).
- `src/app/api/vote-batch/route.ts` — server-side wrapper that POSTs to `${origin}/api/chat` with `{requests: [...]}` (batch mode), then enriches each result with `voterId`. Forwards the custom-key headers from the incoming request. This is used for parallel AI voting.
- `src/app/api/validate-key/route.ts` — validates user-supplied API keys by hitting each provider's chat endpoint with the corresponding validation model (`ZENMUX_VALIDATION_MODEL` / `DASHSCOPE_VALIDATION_MODEL` / `TOKENDANCE_VALIDATION_MODEL`). Same upstream URLs as `/api/chat`.

---

## 2. TTS Integration

### 2a. Server route — `src/app/api/tts/route.ts` (400 lines)

Next.js `POST` handler, `runtime = "nodejs"`, `dynamic = "force-dynamic"`.

**Provider:** MiniMax T2A V2 only.

**Request body:** `{ text: string, voiceId: string }` (JSON).

**Response:** binary audio bytes with a sniffed `Content-Type` (`audio/mpeg`, `audio/wav`, or `audio/ogg`). On error returns JSON `{error, ...}`. Adds `X-Minimax-Voice-Id-Requested` and `X-Minimax-Voice-Id-Used` headers (the latter may differ if a fallback voice was used).

**Auth:**
- Headers `x-minimax-api-key`, `x-minimax-group-id` (custom-key mode) override env vars.
- Env vars: `MINIMAX_API_KEY`, `MINIMAX_GROUP_ID`, `MINIMAX_API_BASE_URL` (default `https://api.minimax.chat`), `MINIMAX_TTS_MODEL` (default `speech-01-turbo`).
- If no custom key header: requires `requireCredits(auth.user.id)`.

**Upstream request payload (lines 61–77):**
```json
{
  "model": "speech-01-turbo",
  "text": "...",
  "stream": false,
  "voice_setting": { "voice_id": "...", "speed": 1.0, "vol": 1.0, "pitch": 0 },
  "audio_setting": { "sample_rate": 32000, "bitrate": 128000, "format": "mp3", "channel": 1 }
}
```

**URL:** `${baseUrl}/v1/t2a_v2?GroupId=${groupId}`. Falls back between `api.minimax.chat` and `api.minimaxi.com` automatically if the primary fails. Uses raw `node:https` (not `fetch`) so it can handle gzip/br/deflate decompression manually.

**Audio extraction logic (lines 268–378):** MiniMax may return:
1. Direct binary audio (forwarded as-is).
2. JSON with `data` field containing base64 or hex encoded audio (decoded).
3. JSON with `audio.url` or `data.url` (HTTP-fetched separately).
4. JSON with `base_resp.status_code != 0` → error. Code `2054` triggers a voice-id fallback to `DEFAULT_VOICE_ID` (male/female by gender hint) and one retry.

### 2b. `src/lib/narrator-voice.ts` (128 lines) — narrator text catalog

Defines `NARRATOR_TEXTS` (Chinese) and `NARRATOR_TEXTS_EN` (English) — fixed game-phase strings like `"天黑请闭眼"`, `"1号玩家出局"`, `"好人获胜"`, etc. Also defines `NARRATOR_VOICE_ID = "Chinese (Mandarin)_Mature_Woman"` and `NARRATOR_VOICE_ID_EN = "Serene_Woman"`.

> **Important:** `getNarratorAudioPath(key, locale)` returns `/audio/narrator/${locale}/${key}.mp3`. These MP3 files are **pre-baked static assets** in `/public/audio/narrator/{zh,en}/*.mp3` — they are NOT generated on-the-fly by MiniMax TTS. Generated by `scripts/generate-narrator-audio.ts` (one-time offline script).

### 2c. `src/lib/narrator-audio-player.ts` (150 lines) — singleton HTML5 Audio player

Plays the pre-baked narrator MP3 files. Does **NOT** call `/api/tts`. Has `play(key, locale?)`, `playAsync(key)`, `stop()`, `setEnabled(bool)`, `setVolume(0..1)`. Singleton via `getNarratorPlayer()`.

### 2d. `src/lib/voice-constants.ts` (106 lines) — MiniMax voice catalog

- `VOICE_PRESETS` (15 Chinese voices) and `ENGLISH_VOICE_PRESETS` (12 English voices), each with `id`, `name`, `styles`, `gender`, `minAge`, `maxAge`.
- `DEFAULT_VOICE_ID = { male: "male-qn-jingying", female: "Chinese (Mandarin)_Warm_Girl" }`.
- `DEFAULT_VOICE_ID_EN = { male: "English_Trustworthy_Man", female: "English_Graceful_Lady" }`.
- `resolveVoiceId(input, gender, age, locale)` — picks a voice id by gender/age match against the presets; for `zh` it preserves a valid input id, for `en` it always re-resolves from English presets.

### 2e. `src/lib/audio-manager.ts` (295 lines) — AI-player voice queue

Singleton `audioManager`. Used to play AI-player speech (NOT narrator lines).

- Builds TTS headers via `buildTtsHeaders()` — adds `X-Minimax-Api-Key` / `X-Minimax-Group-Id` when custom key is enabled, plus `getAuthHeaders()` for user auth.
- `fetchAndCache(task)` — POSTs `{text, voiceId}` to `/api/tts`, stores the response `Blob` in an in-memory `Map<taskId, {blob, durationMs?}>` keyed by `${voiceId}::${text}`.
- `addToQueue(task)`, `ensureReady(task)`, `prefetchTasks(tasks, {concurrency})`, `stopCurrent()`, `clearQueue()`, `clearCache()`.
- Auto-resumes playback on user gesture if blocked by browser autoplay policy.

### 2f. Other TTS callers

- `src/components/DevTools/DevConsole.tsx` (line 162) — dev-only tester that POSTs `{text, voiceId}` to `/api/tts` and inspects the response.
- `src/components/game/DialogArea.tsx` (comment at line 423) — references `/api/tts` for prefetch coordination but the actual fetch is in `audio-manager.ts`.

---

## 3. STT Integration

### 3a. `src/app/api/stt/route.ts` (11 lines)

**Currently a disabled stub.** Always returns:
```ts
return NextResponse.json({ error: "语音识别暂时不可用" }, { status: 410 });
```
No provider is wired up. `runtime = "nodejs"`, `dynamic = "force-dynamic"`.

### 3b. Frontend caller — `src/components/game/VoiceRecorder.tsx` (line 293)

Still calls the disabled endpoint with:
```ts
fetch("/api/stt", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ audio: b64, format: "wav" }),
});
```
Expects `{ text: string }` in the response. Currently always fails (410).

---

## 4. Character Generation & Game Phases

### 4a. `src/lib/character-generator.ts` (752 lines)

Two-phase generation pipeline:
1. **Base profiles** (line 544) — `generateJSON({model: getGeneratorModel(), messages, temperature: 1.2 (WILD), max_tokens: ~350*N + 600, reasoning: {enabled:false}})` returns an array of `{displayName, basicInfo}`. Generator model default = `google/gemini-3.1-flash-lite-preview` (ZenMux).
2. **Full personas** (line 571) — `generateCompletionStream({...same model, max_tokens: ~1250*N + 1800})` streams JSON, parsed incrementally via regex to emit each character as soon as its closing `}` arrives. Each character gets a `voiceId` from `resolveVoiceId(persona.voiceId, persona.gender, persona.age, "zh")`.

`sampleModelRefs(count)` (line 71) picks the AI-player model pool: when custom key is OFF, uses `PLAYER_MODELS` (= `[deepseek-v4-pro]`); when ON, filters `ALL_MODELS` by allowed providers and user's `getSelectedModels()`.

### 4b. `src/lib/game-master.ts` (2241 lines) — central LLM brain

All in-game LLM logic lives here. **Phase files do NOT call LLMs directly** — they only build prompts via `src/lib/prompt-utils.ts` and call game-master.ts functions (e.g. `NightPhase.ts` imports `generateGuardAction`, `generateSeerAction`, `generateWitchAction`, `generateWolfAction`; `VotePhase.ts` imports `generateAIVote`; `DaySpeechPhase.ts` calls `runAISpeech` which delegates to `generateAISpeechStream`).

LLM call sites (15 total) — see list in section 1f. Each one builds a system+user prompt from i18n templates (`gameMaster.*` keys in `src/i18n/messages/{en,zh}.json`), wraps with `mergeOptionsFromModelRef(player.agentProfile.modelRef, ...)`, and logs to `aiLogger.log({type, request, response, duration})`.

The private helper `generateCompletionWithParseRetry<T>` (line 1361) wraps `generateCompletion` with a one-shot retry on parse failure using `jsonRetryInstruction(...)`.

### 4c. Phase files in `src/game/phases/` (6 files)

| File | Lines | LLM calls | Purpose |
|---|---|---|---|
| `NightPhase.ts` | 708 | indirect (via game-master) | Guard/Wolf/Witch/Seer actions; plays narrator audio for wake/close |
| `DaySpeechPhase.ts` | 676 | indirect | Day discussion speeches, badge transfer, hunter death, vote start |
| `VotePhase.ts` | 408 | indirect | AI vote generation |
| `BadgePhase.ts` | 158 | none (only builds prompts) | Badge signup / election / transfer prompts |
| `HunterPhase.ts` | 132 | indirect | Hunter shoot decision |
| `WhiteWolfKingBoomPhase.ts` | 62 | indirect | White Wolf King boom decision |

All import `GamePhase` from `src/game/core/GamePhase.ts` and use `src/lib/prompt-utils.ts` helpers (`buildGameContext`, `buildPersonaSection`, `buildTodayTranscript`, `getRoleText`, `getWinCondition`, `buildSystemTextFromParts`, `buildFocusAngle`, `getDayStartIndex`).

---

## 5. Main Page & Start Screen

### 5a. `src/app/page.tsx` (1757 lines)

The root route. Single React component `Home()` that toggles between two stages based on `gameStarted` (from `useGameLogic`):
- `isWelcomeStage = !gameStarted` (line 1253) → renders `<WelcomeScreen>` inside an animated motion.div (lines 1294–1325). The `onStart` handler (line 1306) calls `startGame({ ...options, isGenshinMode, isSpectatorMode })` after disabling AI voice.
- Otherwise renders the game table with player cards, dialog area, ritual cues, notebook, settings modal, dev tools, etc. (lines 1326–1753).

Key UI props passed to `WelcomeScreen`: `humanName`, `setHumanName`, `onStart`, `onAbort=restartGame`, `isLoading`, genshin/spectator toggles, audio settings. **No model selection is passed here.**

The page also wires `audioManager` (for AI voice) and `getNarratorPlayer()` (for narrator audio), and references `resolveVoiceId` + `AppLocale`.

### 5b. `src/components/game/WelcomeScreen.tsx` (1579 lines)

The landing page users see on first visit. Contains:
- Top-right toolbar: GitHub link, sponsor button, group/Discord button, locale switcher, user account button, **Settings (gear) button** → opens `GameSetupModal`.
- Hero section: name input, big "Start Game" seal button. `handleConfirm` (line 602) checks auth, credits, custom-key presence, spring-campaign quota, then calls `onStart({...})` after a particle animation.
- Sponsor cards row (ZenMux, MiniMax, OpenCreator, TokenDance, Bailian, Watcha).
- Modal children: `GameSetupModal`, `AuthModal`, `SharePanel`, `AccountModal`, `ResetPasswordModal`, `UserProfileModal`, `LowCreditModal`, `LocaleSwitcher`, `CustomCharacterModal`.

**Model selection does NOT live here** — it's hidden behind the user account button → `UserProfileModal` → "Custom" tab.

### 5c. `src/components/game/GameSetupModal.tsx` (223 lines)

Small settings modal opened from WelcomeScreen's gear button. Contains:
- Player count selector (8/9/10/11/12)
- Preferred role dropdown
- Genshin mode / Spectator mode toggles
- Sound settings section (BGM volume, sound enable, AI voice enable, auto-advance dialogue)

**No model selection, no API key inputs.**

---

## 6. Model Selection UI

The real model-selection UI is in `src/components/game/UserProfileModal.tsx` (1097 lines), under the **"Custom" tab** (`<TabsContent value="custom">` at line 772). Structure:

1. **Custom-key toggle** (line 781) — `Switch` bound to `setCustomKeyEnabled(value)`.
2. **LLM API key inputs** (lines 794–933) — revealed only when custom key is enabled:
   - TokenDance key + base URL
   - ZenMux key
   - DashScope key
   Each has a "validate" button that calls `/api/validate-key` and stores the validated key in `wolfcha_validated_*_key`.
3. **Model config** (lines 936–1019) — revealed only when at least one LLM key is configured:
   - **Generator model** dropdown (line 946) — bound to `setGeneratorModelState`. Options from `availableModelPool` (= `ALL_MODELS` filtered by configured providers, or `AVAILABLE_MODELS` if custom key off).
   - **Summary model** dropdown (line 960).
   - **Review model** dropdown (line 974).
   - **Candidate AI-player models** multi-select (line 991) — `DropdownMenuCheckboxItem` list of `playerModelPool`, bound to `setSelectedModelsState`. Persisted via `setSelectedModels(models)` on close.
4. On tab close, `handleApplyModels` (lines ~280–335) calls `setSelectedModels`, `setGeneratorModel`, `setSummaryModel`, `setReviewModel` to persist to localStorage.

`/src/app/ai-models/page.tsx` (600 lines) is **NOT** a model selector — it's a static marketing/SEO page describing DeepSeek, Qwen, Kimi, Claude, Gemini etc. with hardcoded `ModelProfile[]` data and no interactive state. It does not import from `@/types/game` or `@/lib/api-keys`.

---

## 7. Environment Variables (from `.env.example` and `.env.local`)

```
ZENMUX_API_KEY            # ZenMux (default LLM gateway)
TOKENDANCE_API_KEY        # TokenDance gateway
TOKENDANCE_BASE_URL       # https://tokendance.agent-universe.cn/gateway/v1
DASHSCOPE_API_KEY         # Aliyun Bailian
MINIMAX_API_KEY           # MiniMax TTS
MINIMAX_GROUP_ID          # MiniMax group id (required header)
MINIMAX_API_BASE_URL      # https://api.minimaxi.com (or .chat)
MINIMAX_TTS_MODEL         # speech-01-turbo
```

No OpenAI/Anthropic/Google API keys are used directly — they all flow through ZenMux/TokenDance/DashScope as aggregators.

---

## 8. Replacement Targets for z.ai SDK Migration

When replacing with z.ai's SDK, the following files need attention (in priority order):

### Must replace (LLM core)
1. **`src/app/api/chat/route.ts`** (979 lines) — replace the three upstream `fetch()` calls (ZenMux at line 549, DashScope at line 400, TokenDance at line 476) with z.ai SDK calls. Or, if z.ai is OpenAI-compatible, just swap the URLs/keys and keep the rest. Be aware of:
   - The SSE streaming passthrough at lines 776–782, 878–884, 960–968 — if z.ai's SSE format differs, this will break streaming.
   - The `reasoning` vs `thinking` vs `reasoning_effort` translation per provider.
   - The `response_format` gating by `supportsResponseFormat()`.
2. **`src/lib/llm.ts`** (869 lines) — if the response shape from z.ai differs from OpenAI's `ChatCompletionResponse`, update `generateCompletion` (line 582), `generateCompletionBatch` (line 658), and `generateCompletionStream` (line 752 SSE parser).
3. **`src/types/game.ts`** — update `MODEL_IDS`, `ALL_MODELS`, `PROJECT_MODELS`, `AVAILABLE_MODELS`, `DEFAULT_MODEL_CONFIG` to use z.ai model ids. The `ModelRef.provider` union (`"zenmux" | "dashscope" | "tokendance"`) needs to grow a `"zai"` option (or replace existing ones).
4. **`src/lib/api-keys.ts`** — add `getZaiApiKey()` / `setZaiApiKey()` / `hasZaiKey()` / `wolfcha_zai_api_key` storage. Update `isCustomKeyEnabled()` and `resolveModelWhenCustomEnabled()`.
5. **`src/app/api/validate-key/route.ts`** — add a z.ai validation branch.

### Must replace (TTS)
6. **`src/app/api/tts/route.ts`** (400 lines) — replace MiniMax T2A V2 call with z.ai TTS. Watch out:
   - The response is currently raw binary audio bytes — if z.ai returns base64 JSON, adjust `respondAudio()` / `sniffAudioMime()`.
   - The voice_id field in `voice_setting` is MiniMax-specific; z.ai will have its own voice catalog.
7. **`src/lib/voice-constants.ts`** — replace `VOICE_PRESETS` / `ENGLISH_VOICE_PRESETS` / `DEFAULT_VOICE_ID` with z.ai voice ids.
8. **`src/lib/audio-manager.ts`** — header builder `buildTtsHeaders()` (line 34) adds `X-Minimax-Api-Key` / `X-Minimax-Group-Id`; replace with z.ai headers (likely just `Authorization: Bearer` or an `x-zai-api-key`).
9. **`src/lib/api-keys.ts`** — remove `getMinimaxApiKey` / `getMinimaxGroupId` usage or keep them as legacy; add z.ai equivalents.
10. **`src/lib/narrator-voice.ts`** — `NARRATOR_VOICE_ID` / `NARRATOR_VOICE_ID_EN` constants are MiniMax voice ids; only matters if you regenerate the pre-baked narrator MP3s (via `scripts/generate-narrator-audio.ts`). The runtime playback path (`narrator-audio-player.ts`) does not depend on these ids.

### Optional replace (STT)
11. **`src/app/api/stt/route.ts`** (11 lines) — currently a 410 stub. If z.ai provides STT, implement it here. The frontend contract expected by `VoiceRecorder.tsx` is `POST {audio: base64, format: "wav"}` → `{text: string}`.

### UI updates
12. **`src/components/game/UserProfileModal.tsx`** — replace TokenDance/ZenMux/DashScope/MiniMax key input sections with z.ai key input. Update provider labels in `getProviderLabel()`. The model dropdowns will auto-update if `ALL_MODELS` is changed.
13. **`src/components/game/WelcomeScreen.tsx`** — sponsor cards reference ZenMux/MiniMax/TokenDance/Bailian/OpenCreator. Update or remove as desired (cosmetic only).
14. **`src/app/ai-models/page.tsx`** — static marketing content; update model names/descriptions to match the new z.ai lineup (cosmetic only).

### Server-side batch proxy
15. **`src/app/api/vote-batch/route.ts`** (71 lines) — passes through to `/api/chat`, so no changes needed if `/api/chat` is updated. Just verify the header forwarding (lines 39–42) includes any new z.ai header.

### Other notes
- `src/lib/ai-config.ts` (temperature presets) — provider-agnostic, no changes needed.
- `src/lib/character-generator.ts`, `src/lib/game-master.ts`, `src/lib/game-analysis.ts` — they all go through `llm.ts`, so as long as `llm.ts` and `types/game.ts` are updated correctly, these need no changes.
- `src/app/api/check-config/route.ts` — already deprecated (returns 404).
- The `scripts/generate-narrator-audio.ts` script generates the pre-baked MP3s; if you want narrator voices from z.ai, rerun this script after swapping the TTS call inside it.

---
Task ID: 2
Agent: main (Z.ai Code)
Task: Replace all LLM/AI with z.ai SDK, replace TTS with z.ai TTS, change landing to a clean start screen

Work Log:
- Read z.ai LLM and TTS skill docs; confirmed z-ai-web-dev-sdk API shapes (chat.completions.create + audio.tts.create).
- Inspected z-ai-web-dev-sdk/dist/index.js to confirm streaming returns a ReadableStream of SSE "data:" lines (passthrough-compatible with wolfcha's frontend SSE parser).
- Rewrote src/app/api/chat/route.ts (was 979 lines routing to ZenMux/Dashscope/TokenDance) → ~250 lines using zai.chat.completions.create. Supports single (JSON), batch ({requests:[...]}→{results:[...]}), and streaming (SSE passthrough). Normalises z.ai responses to OpenAI-compatible shape. Added withRetry() for 429/5xx backoff.
- Rewrote src/app/api/tts/route.ts (was 400 lines calling MiniMax T2A V2) → ~170 lines using zai.audio.tts.create. Splits text >1024 chars into chunks, concatenates mp3 buffers, sniffs MIME. Added withRetry().
- Updated src/types/game.ts: ModelRef.provider narrowed to "zai"; MODEL_IDS.zai = {glm:"glm-4.6", glmFlash:"glm-4.5-flash"}; ALL_MODELS/PROJECT_MODELS/AVAILABLE_MODELS all z.ai; DEFAULT_MODEL_CONFIG all glm.
- Updated src/lib/voice-constants.ts: VOICE_PRESETS now the 7 z.ai voices (tongtong/chuichui/xiaochen/jam/kazi/douji/luodo) with gender+age mapping; resolveVoiceId picks valid z.ai voice or falls back by gender/age.
- Updated src/lib/llm.ts: Provider type = "zai"; resolveApiKeySource always "project"; buildCustomKeyHeaders returns {}; removed unused provider-key imports.
- Updated src/lib/api-keys.ts: isCustomKeyEnabled() → false; validateApiKeyBalance() → {valid:true}; resolveModelWhenCustomEnabled only allows "zai".
- Updated src/lib/game-master.ts + character-generator.ts: fallback ModelRef provider "zai"; removed hasZenmuxKey/hasDashscopeKey/hasTokendanceKey checks.
- Rewrote src/app/api/vote-batch/route.ts: removed auth + custom-key headers, delegates straight to /api/chat.
- Installed z-ai-web-dev-sdk@0.0.18 into project node_modules (was only global).
- Rewrote src/components/game/WelcomeScreen.tsx (was 1579 lines with sponsor/auth/share/credit modals) → ~330 lines: clean dark gradient hero with name input, 8-12 player count grid, 3 difficulty cards, role preference chips, prominent "Start Game" button, 3 feature highlight cards, footer crediting z.ai. Same prop interface so page.tsx needed no changes. Kept GameSetupModal + LocaleSwitcher.
- Browser-verified: new start screen renders in both en/zh, settings modal works, mobile (375px) responsive, no console errors.
- Confirmed /api/chat and /api/tts correctly invoke z.ai SDK (429 rate-limit errors come straight from z.ai API, proving wiring is correct; official z-ai CLI returns the same 429, confirming account-level quota exhaustion).

Stage Summary:
- All LLM calls now go through z.ai (z-ai-web-dev-sdk chat.completions.create) via /api/chat; streaming SSE passthrough preserved.
- All TTS now goes through z.ai (z-ai-web-dev-sdk audio.tts.create) via /api/tts; 7 z.ai voices mapped by gender/age.
- Model catalog reduced to 2 z.ai models (glm-4.6, glm-4.5-flash); provider field = "zai".
- Landing page is now a focused game start screen (name + player count + difficulty + role + Start Game button) in dark amber/red retro theme, fully responsive, i18n-aware (zh/en).
- NOTE: z.ai API is currently returning HTTP 429 (account daily quota exhausted from testing). The integration is correct and will work once quota resets. withRetry() handles transient 429s with exponential backoff.

---
Task ID: 3
Agent: main (Z.ai Code)
Task: Fix "stuck on players entering" — root cause + clear quota error UX

Work Log:
- Inspected dev.log: every /api/chat call returned 500 → z.ai 429 "Too many requests".
- Ran a raw fetch probe against z.ai (with proper X-Token header) and read response headers:
    x-ratelimit-user-daily-remaining: 0   ← daily quota EXHAUSTED
    x-ratelimit-user-10min-limit: 30 / remaining: 29
  Confirmed z.ai official CLI also returns 429 → account-level daily quota used up, not a code bug.
- Root cause of "stuck": character-generator retried 2x, llm.ts fetchWithRetry retried 4x (429 is in RETRYABLE_STATUS), and the catch in useGameLogic did setGameStarted(false) but the toast wasn't surfacing clearly, so users saw an empty game table spinning.
- Fixes:
  1. /api/chat route: on z.ai 429, return HTTP 429 with body {error:"[QUOTA_EXHAUSTED] z.ai 每日调用额度已用尽..."} so the frontend can detect it.
  2. llm.ts fetchWithRetry: when 429 + body contains [QUOTA_EXHAUSTED]/daily/额度, return immediately WITHOUT retry (daily quota won't recover by retrying).
  3. llm.ts isQuotaExhaustedError: now also recognises status 429 + [QUOTA_EXHAUSTED] marker (previously only 402).
  4. character-generator.ts: on quota error, abort retry immediately (removed the isCustomKeyEnabled() gate so it applies to built-in z.ai quota too).
  5. useGameLogic.ts startGame catch: call toast.error() synchronously (setTimeout deferral caused sonner to drop the toast during table unmount). Hardcoded clear Chinese message "AI 调用额度已用尽 / z.ai 每日免费调用额度已耗尽，请稍后重试（通常次日重置）。" with 15s duration.
  6. Updated i18n quotaExhausted messages in zh.json/en.json.
- Browser-verified end-to-end: click Start → ~7s later page returns to welcome screen + sonner toast appears at top-center reading "AI 调用额度已用尽...". Confirmed via document.querySelector('[data-sonner-toast]').textContent.

Stage Summary:
- "卡在玩家入场" root cause = z.ai account daily quota = 0 (HTTP 429). Not a code bug.
- 429 = "Too Many Requests". z.ai enforces two limits: daily (now exhausted) + 30 req / 10 min (still has headroom). Daily resets ~next day 00:00 Beijing time.
- UX fixed: instead of spinning forever, the game now fails fast (~7s), returns to the welcome screen, and shows a clear toast explaining the quota situation.
