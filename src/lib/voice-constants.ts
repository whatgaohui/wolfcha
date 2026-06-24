export type AppLocale = "zh" | "en";

export interface VoicePreset {
  id: string;
  name: string;
  styles: string[]; // 对应的 persona styleLabel 或 traits
  gender: "male" | "female";
  minAge?: number;
  maxAge?: number;
}

// z.ai TTS available voices (from z-ai-web-dev-sdk TTS skill):
//   tongtong  - 温暖亲切 (female)
//   chuichui  - 活泼可爱 (female)
//   xiaochen  - 沉稳专业 (male)
//   jam       - 英音绅士 (male)
//   kazi      - 清晰标准 (male)
//   douji     - 自然流畅 (male)
//   luodo     - 富有感染力 (male)
export const VOICE_PRESETS: VoicePreset[] = [
  // --- 男性音色 ---
  { id: "xiaochen", name: "沉稳男声", styles: ["calm", "logic", "沉稳", "专业"], gender: "male", minAge: 28, maxAge: 45 },
  { id: "jam", name: "绅士男声", styles: ["calm", "balanced", "绅士", "儒雅"], gender: "male", minAge: 25, maxAge: 40 },
  { id: "kazi", name: "清晰男声", styles: ["logic", "balanced", "清晰", "标准"], gender: "male", minAge: 22, maxAge: 35 },
  { id: "douji", name: "自然男声", styles: ["balanced", "safe", "自然", "流畅"], gender: "male", minAge: 18, maxAge: 30 },
  { id: "luodo", name: "感染力男声", styles: ["aggressive", "balanced", "感染力", "激情"], gender: "male", minAge: 30, maxAge: 50 },

  // --- 女性音色 ---
  { id: "tongtong", name: "温暖女声", styles: ["cheerful", "balanced", "温暖", "亲切"], gender: "female", minAge: 22, maxAge: 35 },
  { id: "chuichui", name: "活泼女声", styles: ["cheerful", "aggressive", "活泼", "可爱"], gender: "female", minAge: 18, maxAge: 25 },
];

// English voices reuse the same z.ai voice pool (jam is natively English-sounding).
export const ENGLISH_VOICE_PRESETS: VoicePreset[] = [
  // --- Male Voices ---
  { id: "jam", name: "English Gentleman", styles: ["calm", "balanced", "gentleman", "steady"], gender: "male", minAge: 25, maxAge: 45 },
  { id: "xiaochen", name: "Professional Man", styles: ["logic", "calm", "professional"], gender: "male", minAge: 30, maxAge: 50 },
  { id: "kazi", name: "Clear Narrator", styles: ["balanced", "safe", "clear"], gender: "male", minAge: 25, maxAge: 40 },
  { id: "douji", name: "Natural Man", styles: ["cheerful", "balanced", "natural"], gender: "male", minAge: 18, maxAge: 30 },
  { id: "luodo", name: "Expressive Man", styles: ["aggressive", "balanced", "expressive"], gender: "male", minAge: 30, maxAge: 55 },

  // --- Female Voices ---
  { id: "tongtong", name: "Warm Lady", styles: ["calm", "balanced", "warm", "friendly"], gender: "female", minAge: 22, maxAge: 40 },
  { id: "chuichui", name: "Lively Girl", styles: ["cheerful", "balanced", "lively", "young"], gender: "female", minAge: 18, maxAge: 28 },
];

export const DEFAULT_VOICE_ID = {
  male: "douji",
  female: "tongtong",
};

export const DEFAULT_VOICE_ID_EN = {
  male: "jam",
  female: "tongtong",
};

/**
 * Resolve voice ID based on input, gender, age, and locale.
 * - Always picks from the z.ai voice pool.
 * - If the input ID is a valid z.ai voice, uses it directly.
 * - Otherwise picks by gender + age from the preset list.
 */
export function resolveVoiceId(
  input: string | undefined,
  gender: "male" | "female" | "nonbinary" | undefined,
  age?: number,
  locale: AppLocale = "zh"
): string {
  const normGender: "male" | "female" = gender === "female" ? "female" : "male";

  const presets = locale === "en" ? ENGLISH_VOICE_PRESETS : VOICE_PRESETS;
  const defaults = locale === "en" ? DEFAULT_VOICE_ID_EN : DEFAULT_VOICE_ID;

  // If the input is already a valid z.ai voice, use it directly.
  const trimmed = (input || "").trim();
  const exists = trimmed ? presets.some((p) => p.id === trimmed) : false;
  if (exists) return trimmed;

  // Filter by gender
  const baseCandidates = presets.filter((p) => p.gender === normGender);

  // Filter by age if available
  const hasAge = typeof age === "number" && Number.isFinite(age);
  const ageCandidates = hasAge
    ? baseCandidates.filter((p) => {
        const minOk = typeof p.minAge === "number" ? age >= p.minAge : true;
        const maxOk = typeof p.maxAge === "number" ? age <= p.maxAge : true;
        return minOk && maxOk;
      })
    : baseCandidates;

  const picked = (ageCandidates[0] ?? baseCandidates[0])?.id;
  if (picked) return picked;

  return normGender === "female" ? defaults.female : defaults.male;
}
