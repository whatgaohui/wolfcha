import { generateJSON, generateCompletionStream, stripMarkdownCodeFences } from "./llm";
import {
  ALL_MODELS,
  GENERATOR_MODEL,
  PLAYER_MODELS,
  PROJECT_MODELS,
  filterPlayerModels,
  type GameScenario,
  type ModelRef,
  type Persona,
  type PlayerMind,
} from "@/types/game";
import {
  getGeneratorModel,
  getSelectedModels,
  isCustomKeyEnabled,
} from "@/lib/api-keys";
import { aiLogger } from "./ai-logger";
import { GAME_TEMPERATURE } from "./ai-config";
import { getRandomScenario } from "./scenarios";
import { resolveVoiceId, VOICE_PRESETS, type AppLocale } from "./voice-constants";
import { getI18n } from "@/i18n/translator";
import { parseLLMJson } from "./llm-json";

export interface GeneratedCharacter {
  displayName: string;
  persona: Persona;
  playerMind?: PlayerMind;
  avatarSeed?: string;
}

export interface GeneratedCharacters {
  characters: GeneratedCharacter[];
}

export type Gender = "male" | "female" | "nonbinary";

const MODEL_DISPLAY_NAME_MAP: Array<{ match: RegExp; label: string }> = [
  { match: /gemini/i, label: "Gemini" },
  { match: /deepseek/i, label: "DeepSeek" },
  { match: /claude/i, label: "Claude" },
  { match: /qwen/i, label: "Qwen" },
  { match: /doubao/i, label: "Doubao" },
  { match: /bytedance|seed/i, label: "ByteDance" },
  { match: /openai|gpt/i, label: "OpenAI" },
  { match: /kimi|moonshot/i, label: "Kimi" },
];

const CHARACTER_GENERATOR_REASONING = { enabled: false } as const;

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getModelRefForModel(model: string): ModelRef {
  return (
    PROJECT_MODELS.find((ref) => ref.model === model) ??
    ALL_MODELS.find((ref) => ref.model === model) ??
    { provider: "zai" as const, model }
  );
}

export const sampleModelRefs = (count: number): ModelRef[] => {
  // Default pool when custom key is not enabled
  const defaultPool =
    PLAYER_MODELS.length > 0
      ? PLAYER_MODELS
      : [getModelRefForModel(GENERATOR_MODEL)];

  const pool = (() => {
    if (!isCustomKeyEnabled()) return defaultPool;

    // When custom key is enabled, use ALL_MODELS as the full available pool
    const fullPool = ALL_MODELS.length > 0 ? ALL_MODELS : defaultPool;

    const allowedProviders = new Set<ModelRef["provider"]>();
    allowedProviders.add("zai");
    if (allowedProviders.size === 0) return defaultPool;

    // Filter by allowed providers, then exclude non-player models
    const allowedPool = filterPlayerModels(
      fullPool.filter((ref) => allowedProviders.has(ref.provider))
    );
    if (allowedPool.length === 0) return defaultPool;

    // Filter by user's selected models - STRICTLY respect user selection
    const selectedModels = getSelectedModels();
    if (selectedModels.length === 0) return allowedPool;
    
    // Only use models the user explicitly selected
    const selectedPool = allowedPool.filter((ref) => selectedModels.includes(ref.model));
    
    // If user selected models but none are in allowedPool, try to find them in fullPool
    // This handles cases where user selected models from a different provider
    if (selectedPool.length === 0) {
      const fullSelectedPool = filterPlayerModels(
        fullPool.filter((ref) => selectedModels.includes(ref.model) && allowedProviders.has(ref.provider))
      );
      if (fullSelectedPool.length > 0) return fullSelectedPool;
      
      // Last resort: only return models that user actually selected, even if empty
      // This prevents using models the user didn't choose
      console.warn("[sampleModelRefs] User selected models not found in allowed pool:", selectedModels);
    }
    
    // Return only user-selected models, never fall back to all models
    return selectedPool.length > 0 ? selectedPool : allowedPool.slice(0, 1);
  })();

  if (!Number.isFinite(count) || count <= 0) return [];

  if (count <= pool.length) {
    return shuffleArray(pool).slice(0, count);
  }

  const out = shuffleArray(pool);
  while (out.length < count) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
};

const getModelDisplayName = (modelRef: ModelRef): string => {
  const raw = modelRef.model ?? "";
  const mapped = MODEL_DISPLAY_NAME_MAP.find((entry) => entry.match.test(raw))?.label;
  if (mapped) return mapped;
  const fallback = raw.split("/").pop() ?? raw;
  return fallback.split("-")[0] || fallback || "AI";
};

const createGenshinPersona = (voiceId?: string): Persona => {
  return {
    styleLabel: "neutral",
    voiceRules: ["concise"],
    mbti: "NA",
    gender: "nonbinary",
    age: 0,
    voiceId,
  };
};

export const buildGenshinModelRefs = (count: number): ModelRef[] => {
  return sampleModelRefs(count);
};

export const generateGenshinModeCharacters = async (
  count: number,
  modelRefs: ModelRef[]
): Promise<GeneratedCharacter[]> => {
  const modelUsageCounts = new Map<string, number>();
  const modelVoiceMap = new Map<string, string>();
  const resolvedRefs = modelRefs.length >= count ? modelRefs : buildGenshinModelRefs(count);

  return resolvedRefs.slice(0, count).map((modelRef) => {
    const modelLabel = getModelDisplayName(modelRef);
    const usageCount = modelUsageCounts.get(modelLabel) ?? 0;
    modelUsageCounts.set(modelLabel, usageCount + 1);
    const preferredName = usageCount === 0 ? modelLabel : `${modelLabel} ${usageCount + 1}`;

    let voiceId = modelVoiceMap.get(modelLabel);
    if (!voiceId) {
      const preset = VOICE_PRESETS[Math.floor(Math.random() * VOICE_PRESETS.length)];
      voiceId = preset?.id;
      if (voiceId) {
        modelVoiceMap.set(modelLabel, voiceId);
      }
    }

    return {
      displayName: preferredName,
      persona: createGenshinPersona(voiceId),
    };
  });
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function hasStringField(value: unknown, field: string): value is Record<string, string> {
  return isRecord(value) && typeof value[field] === "string";
}

const isValidMbti = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{4}$/.test(v.trim());

export interface BaseProfile {
  displayName: string;
  gender: Gender;
  age: number;
  mbti: string;
  basicInfo: string;
}

interface BaseProfilesResponse {
  profiles: BaseProfile[];
}

const normalizeBaseProfiles = (result: unknown): { profiles: BaseProfile[]; raw: unknown } => {
  if (isRecord(result) && Array.isArray(result.profiles)) {
    return { profiles: result.profiles as BaseProfile[], raw: result };
  }

  if (Array.isArray(result)) {
    if (result.length > 0 && hasStringField(result[0], "displayName")) {
      return { profiles: result as BaseProfile[], raw: result };
    }
    return { profiles: [], raw: result };
  }

  return { profiles: [], raw: result };
};

const isValidGender = (g: unknown): g is Gender => g === "male" || g === "female" || g === "nonbinary";

const isValidBaseProfiles = (profiles: unknown, count: number): profiles is BaseProfile[] => {
  if (!Array.isArray(profiles) || profiles.length !== count) return false;
  const ok = profiles.every((p) => {
    if (!isRecord(p)) return false;
    if (typeof p.displayName !== "string" || !p.displayName.trim()) return false;
    if (!isValidGender(p.gender)) return false;
    if (typeof p.age !== "number" || !Number.isFinite(p.age) || p.age < 16 || p.age > 70) return false;
    if (!isValidMbti(p.mbti)) return false;
    if (typeof p.basicInfo !== "string" || !p.basicInfo.trim()) return false;
    return true;
  });

  if (!ok) return false;
  const names = profiles.map((p) => String(p.displayName).trim()).filter(Boolean);
  if (names.length !== count) return false;
  if (new Set(names).size !== count) return false;
  return true;
};

const buildBaseProfilesPrompt = (count: number, scenario: GameScenario) => {
  const { t } = getI18n();
  return t("characterGenerator.baseProfilesPrompt", {
    count,
    title: scenario.title,
    description: scenario.description,
    rolesHint: scenario.rolesHint,
  });
};

const buildCharacterSchemaLine = (p: BaseProfile): string => (
  `  { "displayName": "${p.displayName}", "persona": { "voiceRules": string[], "werewolfExperience": string, "vocabularyStyle": string, "reasoningStyle": string, "wolfDeceptionStyle": string, "mbti": "${p.mbti}", "gender": "${p.gender}", "age": ${p.age} }, "playerMind": { "courage": string, "suspicionThreshold": string, "selfProtection": string } }`
);

const normalizeGeneratedCharacters = (
  result: unknown
): { characters: GeneratedCharacter[]; raw: unknown } => {
  if (result && typeof result === "object" && "displayName" in result && "persona" in result) {
    return { characters: [result as GeneratedCharacter], raw: result };
  }

  if (isRecord(result) && Array.isArray(result.characters)) {
    return { characters: result.characters as GeneratedCharacter[], raw: result };
  }

  if (Array.isArray(result)) {
    if (result.length > 0 && hasStringField(result[0], "displayName")) {
      return { characters: result as GeneratedCharacter[], raw: result };
    }
    return { characters: [], raw: result };
  }

  return { characters: [], raw: result };
};

const isValidPersona = (p: unknown): p is Persona => {
  if (!isRecord(p)) return false;
  // styleLabel is now optional
  if (p.styleLabel !== undefined && typeof p.styleLabel !== "string") return false;
  if (!Array.isArray(p.voiceRules) || p.voiceRules.filter((x): x is string => typeof x === "string" && x.trim().length > 0).length === 0) return false;
  if (!isValidMbti(p.mbti)) return false;
  if (!isValidGender(p.gender)) return false;
  if (typeof p.age !== "number" || !Number.isFinite(p.age) || p.age < 16 || p.age > 70) return false;
  if (p.relationships !== undefined) {
    if (!Array.isArray(p.relationships)) return false;
    if (p.relationships.some((x) => typeof x !== "string")) return false;
  }
  return true;
};

const isValidPersonaForProfile = (p: unknown, profile: BaseProfile): p is Persona => {
  if (!isValidPersona(p)) return false;
  if (p.gender !== profile.gender) return false;
  if (p.age !== profile.age) return false;
  if (String(p.mbti).trim() !== profile.mbti) return false;
  return true;
};

const PLAYER_MIND_REQUIRED_FIELDS: Array<keyof PlayerMind> = [
  "courage",
  "memoryBias",
  "suspicionThreshold",
  "selfProtection",
  "logicDepth",
  "tablePresence",
];

const isValidPlayerMind = (mind: unknown): mind is PlayerMind => {
  if (!mind || typeof mind !== "object") return false;
  const record = mind as Record<string, unknown>;
  if (PLAYER_MIND_REQUIRED_FIELDS.some((key) => {
    const value = record[key];
    return typeof value !== "string" || !value.trim();
  })) {
    return false;
  }
  return true;
};

const PERSONA_TEXT_FIELDS = [
  "werewolfExperience",
  "vocabularyStyle",
  "reasoningStyle",
  "speechLengthHabit",
  "pressureStyle",
  "uncertaintyStyle",
  "mistakePattern",
  "wolfDeceptionStyle",
 ] as const satisfies ReadonlyArray<
  "werewolfExperience" |
  "vocabularyStyle" |
  "reasoningStyle" |
  "speechLengthHabit" |
  "pressureStyle" |
  "uncertaintyStyle" |
  "mistakePattern" |
  "wolfDeceptionStyle"
>;

const OPTIONAL_PERSONA_STRING_FIELDS = ["logicStyle", "socialHabit", "humorStyle"] as const satisfies ReadonlyArray<
  "logicStyle" | "socialHabit" | "humorStyle"
>;

const PLAYER_MIND_FALLBACKS: Record<keyof PlayerMind, string> = {
  courage: "Usually avoids flashy risks, but will commit when the table direction becomes clear.",
  memoryBias: "Remembers voting patterns and obvious contradictions first, then tone and timing.",
  suspicionThreshold: "Needs more than one clue before fully changing sides, with votes and incentives carrying the most weight.",
  selfProtection: "Tends to explain their logic first, then push back if pressure keeps building.",
  logicDepth: "Can connect a few players and vote relationships, but still prefers concrete table evidence.",
  tablePresence: "Speaks in measured turns, not loud by default, and becomes firmer in key moments.",
};

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function normalizePlayerMind(mind: unknown): PlayerMind {
  const record = mind && typeof mind === "object" ? (mind as Record<string, unknown>) : {};
  return {
    courage: typeof record.courage === "string" && record.courage.trim() ? record.courage.trim() : PLAYER_MIND_FALLBACKS.courage,
    memoryBias:
      typeof record.memoryBias === "string" && record.memoryBias.trim()
        ? record.memoryBias.trim()
        : PLAYER_MIND_FALLBACKS.memoryBias,
    suspicionThreshold:
      typeof record.suspicionThreshold === "string" && record.suspicionThreshold.trim()
        ? record.suspicionThreshold.trim()
        : PLAYER_MIND_FALLBACKS.suspicionThreshold,
    selfProtection:
      typeof record.selfProtection === "string" && record.selfProtection.trim()
        ? record.selfProtection.trim()
        : PLAYER_MIND_FALLBACKS.selfProtection,
    logicDepth:
      typeof record.logicDepth === "string" && record.logicDepth.trim()
        ? record.logicDepth.trim()
        : PLAYER_MIND_FALLBACKS.logicDepth,
    tablePresence:
      typeof record.tablePresence === "string" && record.tablePresence.trim()
        ? record.tablePresence.trim()
        : PLAYER_MIND_FALLBACKS.tablePresence,
  };
}

function normalizePersonaForProfile(persona: unknown, profile: BaseProfile): Persona {
  const record = isRecord(persona) ? persona : {};
  const voiceRules = normalizeStringArray(record.voiceRules);
  const normalized: Persona = {
    styleLabel: typeof record.styleLabel === "string" && record.styleLabel.trim() ? record.styleLabel.trim() : undefined,
    voiceRules: voiceRules.length > 0 ? voiceRules : ["speaks in a natural, table-focused way"],
    mbti: profile.mbti,
    gender: profile.gender,
    age: profile.age,
    voiceId: typeof record.voiceId === "string" && record.voiceId.trim() ? record.voiceId.trim() : undefined,
    relationships: undefined,
    basicInfo: profile.basicInfo,
  };

  for (const field of PERSONA_TEXT_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      normalized[field] = value.trim();
    }
  }

  for (const field of OPTIONAL_PERSONA_STRING_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      normalized[field] = value.trim();
    }
  }

  const triggerTopics = normalizeStringArray(record.triggerTopics);
  if (triggerTopics.length > 0) {
    normalized.triggerTopics = triggerTopics;
  }

  return normalized;
}

function normalizeGeneratedCharacterForProfile(char: unknown, profile: BaseProfile): GeneratedCharacter | null {
  if (!char || typeof char !== "object") return null;
  const record = char as Record<string, unknown>;
  const rawName = typeof record.displayName === "string" ? record.displayName.trim() : "";
  if (!rawName) return null;

  return {
    displayName: rawName,
    persona: normalizePersonaForProfile(record.persona, profile),
    playerMind: normalizePlayerMind(record.playerMind),
    avatarSeed: typeof record.avatarSeed === "string" && record.avatarSeed.trim() ? record.avatarSeed.trim() : undefined,
  };
}

const alignCharactersToProfiles = (
  chars: unknown,
  profiles: BaseProfile[]
): GeneratedCharacter[] | null => {
  if (!Array.isArray(chars)) {
    console.error("[alignCharacters] chars is not an array:", chars);
    return null;
  }
  if (chars.length !== profiles.length) {
    console.error(`[alignCharacters] length mismatch: ${chars.length} chars vs ${profiles.length} profiles`);
    return null;
  }
  const byName = new Map<string, GeneratedCharacter>();
  for (const c of chars as GeneratedCharacter[]) {
    if (!c || typeof c !== "object") {
      console.error("[alignCharacters] invalid character object:", c);
      return null;
    }
    const name = typeof c.displayName === "string" ? c.displayName.trim() : "";
    if (!name) {
      console.error("[alignCharacters] missing displayName:", c);
      return null;
    }
    if (byName.has(name)) {
      console.error("[alignCharacters] duplicate name:", name);
      return null;
    }
    byName.set(name, c);
  }
  const ordered: GeneratedCharacter[] = [];
  for (const profile of profiles) {
    const key = profile.displayName.trim();
    const rawCharacter = byName.get(key);
    if (!rawCharacter) {
      console.error(`[alignCharacters] character not found for profile: ${key}, available names:`, Array.from(byName.keys()));
      return null;
    }
    const c = normalizeGeneratedCharacterForProfile(rawCharacter, profile);
    if (!c || !isValidPersonaForProfile(c.persona, profile) || !isValidPlayerMind(c.playerMind)) {
      const p = isRecord(rawCharacter) ? rawCharacter.persona : undefined;
      console.error(`[alignCharacters] invalid persona for ${key}:`, {
        rawCharacter,
        normalizedCharacter: c,
        profile: { gender: profile.gender, age: profile.age, mbti: profile.mbti },
        isValid: c ? isValidPersona(c.persona) : false,
        isValidPlayerMind: c ? isValidPlayerMind(c.playerMind) : false,
        genderMatch: p?.gender === profile.gender,
        ageMatch: p?.age === profile.age,
        mbtiMatch: isRecord(p) ? String(p.mbti || "").trim() === profile.mbti : false,
      });
      return null;
    }
    ordered.push(c);
  }
  return ordered;
};

const buildFullPersonasPrompt = (scenario: GameScenario, allProfiles: BaseProfile[]) => {
  const { t } = getI18n();
  const roster = allProfiles
    .map((p, i) =>
      t("characterGenerator.rosterLine", {
        index: i + 1,
        name: p.displayName,
        gender: p.gender,
        age: p.age,
        basicInfo: p.basicInfo,
      })
    )
    .join("\n");

  const schema = allProfiles.map(buildCharacterSchemaLine).join(",\n");

  return t("characterGenerator.fullPersonasPrompt", {
    title: scenario.title,
    description: scenario.description,
    roster,
    count: allProfiles.length,
    schema,
  });
};

/** 合并版 prompt：一次生成完整角色（base info + persona + playerMind） */
// HMR trigger
const buildMergedPrompt = (count: number, scenario: GameScenario) => {
  const isZh = getI18n().locale === "zh";
  if (isZh) {
    return `你是狼人杀游戏的角色设计师。

【当前剧本背景】
标题：${scenario.title}
背景：${scenario.description}
角色建议：${scenario.rolesHint}

【任务】
生成 ${count} 个玩家角色，每个角色包含基础信息和完整人设。这些是"玩狼人杀的普通人"，不是悬疑剧本的角色。

【重要：字段值用短语(5-15字)，不要完整句子】
例如：werewolfExperience 写"信息博弈视角"而非"这个人认为狼人杀是信息博弈关键在于控制信息流"

【persona 字段】（只生成以下 4 个）
- werewolfExperience：短语，怎么理解狼人杀
- vocabularyStyle：短语，常用词和术语密度
- reasoningStyle：短语，最先注意什么
- wolfDeceptionStyle：短语，拿狼时怎么伪装

【playerMind 字段】（只生成以下 3 个）
- courage：短语，敢不敢诈/硬推
- suspicionThreshold：短语，几条线索改站边
- selfProtection：短语，被攻击时怎么应对

【voiceRules】每项 2-4 字短语，1-2 个，如 ["冷静","数据流"]

【输出格式】
输出 JSON 数组（共 ${count} 个），每个对象严格匹配以下 schema：
[{"displayName":"中文名2-3字","gender":"male或female","age":25,"mbti":"INTJ","basicInfo":"一句话职业","persona":{"voiceRules":["短语"],"werewolfExperience":"短语","vocabularyStyle":"短语","reasoningStyle":"短语","wolfDeceptionStyle":"短语"},"playerMind":{"courage":"短语","suspicionThreshold":"短语","selfProtection":"短语"}}]

【重要】
- 名字各不相同，符合场景名字风格
- 年龄 20-55，mbti 是 4 字母
- 只输出 JSON 数组，不要 markdown 代码块、不要解释文字
- 每个字段一句话短语，不要长篇大论`;
  }
  return `You are a character designer for a Werewolf game.

[Scene]
${scenario.title} - ${scenario.description}
Role hints: ${scenario.rolesHint}
Note: scene only flavors identity and names; gameplay stays on Werewolf itself.

[Task]
Generate ${count} player characters, each with base info and full persona. These are "ordinary people playing Werewolf", not mystery characters.

[IMPORTANT: field values must be SHORT PHRASES (3-10 words), NOT full sentences]
e.g. werewolfExperience: "info-game perspective" NOT "this person thinks Werewolf is about controlling information flow"

[persona fields] (generate ONLY these 4)
- werewolfExperience: short phrase, how they view Werewolf
- vocabularyStyle: short phrase, jargon density
- reasoningStyle: short phrase, what they notice first
- wolfDeceptionStyle: short phrase, wolf disguise approach

[playerMind fields] (generate ONLY these 3)
- courage: short phrase, bluff/push willingness
- suspicionThreshold: short phrase, clues needed to switch
- selfProtection: short phrase, defense when attacked

[voiceRules] each 2-4 word phrase, 1-2 items, e.g. ["calm","analytical"]

[Output format]
JSON array (${count} objects), each matching this schema:
[{"displayName":"Name","gender":"male or female","age":25,"mbti":"INTJ","basicInfo":"one-line job","persona":{"voiceRules":["phrase"],"werewolfExperience":"phrase","vocabularyStyle":"phrase","reasoningStyle":"phrase","wolfDeceptionStyle":"phrase"},"playerMind":{"courage":"phrase","suspicionThreshold":"phrase","selfProtection":"phrase"}}]

[Important]
- Unique names, age 20-55, mbti 4 letters
- Output ONLY the JSON array, no markdown, no explanation
- One short phrase per field, keep it concise`;
};

export async function generateCharacters(
  count: number,
  scenario?: GameScenario,
  options?: {
    onBaseProfiles?: (profiles: BaseProfile[]) => void;
    onCharacter?: (index: number, character: GeneratedCharacter) => void;
  }
): Promise<GeneratedCharacter[]> {
  const usedScenario = scenario ?? getRandomScenario();
  const runOnce = async () => {
    const startTime = Date.now();
    // 合并两阶段：一次调用生成完整角色（base info + persona + playerMind），
    // 省掉单独的 base profiles 调用（~7s），总耗时减半。
    const mergedPrompt = buildMergedPrompt(count, usedScenario);

    // 流式生成：每解析出一个完整角色就立即回调
    const finalizedCharacters: GeneratedCharacter[] = [];
    const emittedIndices = new Set<number>();
    const emittedBaseProfiles: BaseProfile[] = [];
    let accumulatedContent = "";

    // 精简字段后每角色约 400 tokens
    const fullMaxTokens = Math.max(3500, count * 450 + 600);

    const stream = generateCompletionStream({
      model: getGeneratorModel(),
      messages: [{ role: "user", content: mergedPrompt }],
      temperature: GAME_TEMPERATURE.CHARACTER_GENERATION,
      max_tokens: fullMaxTokens,
      reasoning: CHARACTER_GENERATOR_REASONING,
    });

    for await (const chunk of stream) {
      accumulatedContent += chunk;

      // 提取完整的角色对象（含 displayName + persona + playerMind + base info）
      const cleaned = stripMarkdownCodeFences(accumulatedContent);
      const characterPattern = /\{\s*"displayName"\s*:\s*"[^"]+"\s*,\s*"gender"\s*:\s*"[^"]+"\s*,\s*"age"\s*:\s*\d+[^}]*"persona"\s*:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\s*,\s*"playerMind"\s*:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\s*\}/g;
      const matches = cleaned.match(characterPattern);

      if (matches) {
        for (const match of matches) {
          try {
            const c = parseLLMJson<GeneratedCharacter & { gender?: string; age?: number; mbti?: string; basicInfo?: string }>(match);
            if (!c || !c.displayName) continue;

            // 用 displayName 去重（合并模式下没有预生成的 baseProfiles 数组）
            const existingIndex = finalizedCharacters.findIndex(
              (fc) => fc?.displayName === c.displayName
            );
            if (existingIndex !== -1) continue; // 已处理

            const index = emittedBaseProfiles.length;
            emittedBaseProfiles.push({
              displayName: c.displayName,
              gender: (c.gender === "female" ? "female" : "male") as "male" | "female",
              age: typeof c.age === "number" ? c.age : 25,
              mbti: c.mbti || "INTJ",
              basicInfo: c.basicInfo || "",
            });

            // 名字一出就触发 baseProfiles 回调（让前端先显示名字）
            options?.onBaseProfiles?.([...emittedBaseProfiles]);

            // 构建完整角色
            const persona = c.persona;
            if (!persona || !Array.isArray(persona.voiceRules) || persona.voiceRules.length === 0) continue;

            const voiceId = resolveVoiceId(
              persona.voiceId,
              persona.gender,
              persona.age,
              "zh" as AppLocale
            );

            const character: GeneratedCharacter = {
              displayName: c.displayName,
              persona: {
                ...persona,
                gender: persona.gender || (emittedBaseProfiles[index].gender as "male" | "female" | "nonbinary"),
                age: persona.age || emittedBaseProfiles[index].age,
                mbti: persona.mbti || emittedBaseProfiles[index].mbti,
                basicInfo: emittedBaseProfiles[index].basicInfo,
                voiceId,
                relationships: undefined,
              },
              playerMind: c.playerMind,
            };

            finalizedCharacters[index] = character;
            options?.onCharacter?.(index, character);
            console.log(`[character-gen] emitted character ${index}: ${character.displayName}`);
          } catch {
            // 解析失败是正常的
          }
        }
      }
    }

    // 流式结束后，检查是否所有角色都已生成
    if (finalizedCharacters.filter(Boolean).length < count) {
      // 回退到完整解析
      const cleaned = stripMarkdownCodeFences(accumulatedContent);
      const fullResult = parseLLMJson<unknown>(cleaned);
      if (!fullResult) {
        throw new Error("Character generation returned invalid JSON");
      }

      const normalized = normalizeGeneratedCharacters(fullResult);
      const chars = normalized.characters;

      // 补充未生成的角色（合并模式下无 baseProfiles，直接用生成结果）
      for (let i = 0; i < chars.length; i++) {
        if (finalizedCharacters[i]) continue;

        const c = chars[i];
        if (!c?.persona) continue;

        const voiceId = resolveVoiceId(
          c.persona.voiceId,
          c.persona.gender,
          c.persona.age,
          "zh" as AppLocale
        );

        const character: GeneratedCharacter = {
          displayName: c.displayName,
          persona: {
            ...c.persona,
            voiceId,
            relationships: undefined,
          },
          playerMind: c.playerMind,
        };

        finalizedCharacters[i] = character;
        options?.onCharacter?.(i, character);
      }
    }

    await aiLogger.log({
      type: "character_generation",
      request: { 
        model: getGeneratorModel(),
        messages: [{ role: "user", content: mergedPrompt }],
      },
      response: { 
        content: JSON.stringify(finalizedCharacters.map((c) => ({
          displayName: c.displayName,
          hiddenCommunicationProfile: {
            werewolfExperience: c.persona.werewolfExperience,
            vocabularyStyle: c.persona.vocabularyStyle,
            reasoningStyle: c.persona.reasoningStyle,
            speechLengthHabit: c.persona.speechLengthHabit,
            pressureStyle: c.persona.pressureStyle,
            uncertaintyStyle: c.persona.uncertaintyStyle,
            mistakePattern: c.persona.mistakePattern,
            wolfDeceptionStyle: c.persona.wolfDeceptionStyle,
          },
          playerMind: c.playerMind,
        }))),
        duration: Date.now() - startTime 
      },
    });

    return finalizedCharacters;
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      console.log(
        `[character-gen] Attempt ${attempt + 1}/2, customKeyEnabled: ${isCustomKeyEnabled()}`
      );
      return await runOnce();
    } catch (error) {
      lastError = error;
      console.error(`[character-gen] Attempt ${attempt + 1} failed:`, error);

      const errorMsg = String(error);
      const isQuotaError = errorMsg.includes("[QUOTA_EXHAUSTED]") ||
                          errorMsg.includes("402") ||
                          errorMsg.includes("insufficient") ||
                          errorMsg.includes("余额");

      // Quota exhaustion is not recoverable by retrying — abort immediately
      // (applies to both built-in z.ai quota and custom-key quota).
      if (isQuotaError) {
        console.error("[character-gen] Quota exhausted, aborting retry");
        throw error;
      }
      
      if (attempt === 0) {
        continue;
      }
      console.error("Character generation failed:", error);
      await aiLogger.log({
        type: "character_generation",
        request: { 
          model: GENERATOR_MODEL,
          messages: [{ role: "user", content: "(two-stage generation)" }],
        },
        response: { content: "[]", duration: 0 },
        error: String(error),
      });
    }
  }

  throw lastError;
}
