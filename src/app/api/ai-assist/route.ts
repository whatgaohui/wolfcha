import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AI 助手 API — 两类分析:
 *   1. analyze: 场上各角色身份判断及概率(站在用户立场分析局势)
 *   2. speech:  用户发言指导(结合分析 + 用户身份给策略)
 *
 * 请求: { type: "analyze" | "speech", gameContext, analysis? }
 * 响应: { result: string }  (Markdown 文本)
 */

interface PlayerInfo {
  seat: number;
  name: string;
  alive: boolean;
  isHuman: boolean;
}

interface SpeechInfo {
  speaker: string;
  speakerSeat: number;
  content: string;
  day: number;
  phase: string;
}

interface VoteInfo {
  voter: string;
  voterSeat: number;
  targetSeat: number;
  targetName: string;
  day: number;
}

interface GameContext {
  myRole: string;
  mySeat: number;
  myName: string;
  day: number;
  phase: string;
  players: PlayerInfo[];
  speeches: SpeechInfo[];
  votes: VoteInfo[];
  nightDeaths?: Array<{ seat: number; name: string; day: number; reason: string }>;
  seerChecks?: Array<{ targetSeat: number; isWolf: boolean; day: number }>;
}

let zaiPromise: Promise<ZAI> | null = null;
async function getZai(): Promise<ZAI> {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

function buildAnalyzePrompt(ctx: GameContext): string {
  const playerList = ctx.players
    .map((p) => `${p.seat}号 ${p.name}${p.alive ? "" : "(已出局)"}${p.isHuman ? " [你]" : ""}`)
    .join("\n");

  const speeches = ctx.speeches
    .slice(-30)
    .map((s) => `[第${s.day}天 ${s.phase}] ${s.speakerSeat}号${s.speaker}: ${s.content}`)
    .join("\n");

  const votes = ctx.votes
    .map((v) => `[第${v.day}天] ${v.voterSeat}号${v.voter} → ${v.targetSeat}号${v.targetName}`)
    .join("\n");

  const deaths = ctx.nightDeaths
    ?.map((d) => `第${d.day}天 ${d.seat}号${d.name} (${d.reason})`)
    .join("\n");

  const seerChecks = ctx.seerChecks
    ?.map((c) => `第${c.day}天 查验${c.targetSeat}号: ${c.isWolf ? "狼人" : "好人"}`)
    .join("\n");

  return `你是一个资深狼人杀教练,正在帮玩家分析场上局势。

【你的身份】
${ctx.myRole} (${ctx.mySeat}号 ${ctx.myName})

【当前局势】
第${ctx.day}天,阶段:${ctx.phase}

【场上玩家】
${playerList}

【近期发言记录】
${speeches || "(暂无发言)"}

【投票记录】
${votes || "(暂无投票)"}

【夜间死亡记录】
${deaths || "(暂无)"}

${seerChecks ? `【你的查验记录(仅你可见)】\n${seerChecks}` : ""}

【任务】
站在 ${ctx.myName}(${ctx.myRole})的立场,分析场上每个其他玩家的身份可能性。

【输出要求】
必须输出严格的 JSON 对象(不要 markdown 代码块,不要解释文字),格式如下:
{
  "players": [
    {
      "seat": 2,
      "name": "玩家名字",
      "identities": [
        { "role": "村民", "probability": 40 },
        { "role": "狼人", "probability": 35 },
        { "role": "神职", "probability": 25 }
      ],
      "reason": "一句话判断依据,引用具体发言/投票/行为",
      "confidence": "高"
    }
  ],
  "summary": "局势总结:狼人剩余估计、好人优劣、关键悬念(2-3句)"
}

注意:
- players 数组只包含"其他玩家"(不含 ${ctx.mySeat}号 ${ctx.myName} 自己)
- seat 和 name 必须与上面【场上玩家】列表完全一致
- identities 的 probability 之和接近 100
- confidence 只能是 "高"、"中"、"低" 之一
- 如果信息不足,probability 均分,reason 写"信息不足,暂难判断",confidence 写"低"
- 只输出 JSON,不要其他文字`;
}

function buildSpeechPrompt(ctx: GameContext, analysis: string): string {
  const playerList = ctx.players
    .filter((p) => p.alive && !p.isHuman)
    .map((p) => `${p.seat}号 ${p.name}`)
    .join(", ");

  return `你是一个资深狼人杀教练,正在指导 ${ctx.myName}(${ctx.myRole}) 的发言策略。

【你的身份】
${ctx.myRole} (${ctx.mySeat}号 ${ctx.myName})

【当前局势】
第${ctx.day}天,阶段:${ctx.phase}
场上存活的其他玩家: ${playerList}

【局势分析(由AI助手生成)】
${analysis}

【任务】
基于上述局势分析,结合你的身份(${ctx.myRole}),给出本轮发言策略建议。

输出格式(Markdown):
## 发言目标
(一句话:本轮发言要达成什么目的)

## 核心策略
(2-3条具体策略,如:该跳身份/该认狼/该带节奏怀疑谁/该苟/该自保)

## 建议发言要点
(列出3-5个要点,发言时该说什么)

## 注意事项
(1-2条风险提示,如:不要暴露某信息/小心被反打)

注意:
- 策略要符合你的身份(狼人要伪装,好人要找狼,神职要考虑跳身份时机)
- 基于局势分析,不要凭空建议
- 简洁实用,总共不超过200字`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { type, gameContext, analysis } = body as {
      type: "analyze" | "speech";
      gameContext: GameContext;
      analysis?: string;
    };

    if (!type || !gameContext) {
      return NextResponse.json({ error: "Missing type or gameContext" }, { status: 400 });
    }

    const zai = await getZai();

    let prompt: string;
    if (type === "analyze") {
      prompt = buildAnalyzePrompt(gameContext);
    } else {
      prompt = buildSpeechPrompt(gameContext, analysis || "(暂无局势分析)");
    }

    const result = await zai.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      thinking: { type: "disabled" },
      temperature: 0.7,
      max_tokens: type === "analyze" ? 2500 : 1500,
      stream: false,
    });

    const content = result?.choices?.[0]?.message?.content || "(AI 助手未返回内容)";

    // analyze 模式: 尝试解析为 JSON,失败则返回纯文本(前端会 fallback)
    if (type === "analyze") {
      let parsed: unknown = null;
      try {
        // 剥离可能的 markdown code fence
        let cleaned = content.trim();
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
        }
        parsed = JSON.parse(cleaned);
      } catch {
        // 解析失败,保留原文
      }
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { players?: unknown }).players)) {
        return NextResponse.json({ result: parsed });
      }
      return NextResponse.json({ result: content });
    }

    return NextResponse.json({ result: content });
  } catch (error: unknown) {
    console.error("[api/ai-assist] error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    const isRateLimited = message.includes("429") || message.includes("Too many requests");
    if (isRateLimited) {
      return NextResponse.json(
        { error: "[QUOTA_EXHAUSTED] AI 调用额度已用尽,请稍后重试。" },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
