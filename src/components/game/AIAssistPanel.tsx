"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Brain, Lightbulb, Spinner, ChatCircleDots, User } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { GameState, Player } from "@/types/game";

interface AIAssistPanelProps {
  isOpen: boolean;
  onClose: () => void;
  gameState: GameState;
  humanPlayer: Player | null;
  humanName: string;
}

type Tab = "analyze" | "speech" | "history";

interface GameContext {
  myRole: string;
  mySeat: number;
  myName: string;
  day: number;
  phase: string;
  players: Array<{ seat: number; name: string; alive: boolean; isHuman: boolean }>;
  speeches: Array<{
    speaker: string;
    speakerSeat: number;
    content: string;
    day: number;
    phase: string;
  }>;
  votes: Array<{
    voter: string;
    voterSeat: number;
    targetSeat: number;
    targetName: string;
    day: number;
  }>;
  nightDeaths?: Array<{ seat: number; name: string; day: number; reason: string }>;
  seerChecks?: Array<{ targetSeat: number; isWolf: boolean; day: number }>;
}

interface IdentityProb {
  role: string;
  probability: number;
}

interface PlayerAnalysis {
  seat: number;
  name: string;
  identities: IdentityProb[];
  reason: string;
  confidence: string;
}

interface AnalysisResult {
  players: PlayerAnalysis[];
  summary: string;
}

// 身份颜色映射(狼人红、神职紫、村民绿)
const IDENTITY_COLORS: Record<string, string> = {
  "狼人": "bg-red-500",
  "狼": "bg-red-500",
  "werewolf": "bg-red-500",
  "白狼王": "bg-red-600",
  "神职": "bg-purple-500",
  "神": "bg-purple-500",
  "预言家": "bg-indigo-500",
  "女巫": "bg-emerald-500",
  "猎人": "bg-orange-500",
  "守卫": "bg-sky-500",
  "白痴": "bg-teal-500",
  "村民": "bg-amber-500",
  "民": "bg-amber-500",
  "villager": "bg-amber-500",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  "高": "text-emerald-400",
  "中": "text-amber-400",
  "低": "text-stone-400",
};

function getIdentityColor(role: string): string {
  return IDENTITY_COLORS[role] || "bg-stone-500";
}

function buildGameContext(
  gameState: GameState,
  humanPlayer: Player | null,
  humanName: string,
  roleLabel: string
): GameContext {
  const players = gameState.players.map((p) => ({
    seat: p.seat,
    name: p.displayName || `玩家${p.seat}`,
    alive: p.alive,
    isHuman: p.isHuman,
  }));

  const speeches = gameState.messages
    .filter((m) => !m.isSystem && m.content?.trim())
    .map((m) => {
      const speaker = gameState.players.find((p) => p.playerId === m.playerId);
      return {
        speaker: m.playerName,
        speakerSeat: speaker?.seat ?? 0,
        content: m.content,
        day: m.day ?? 1,
        phase: m.phase ?? "DAY_SPEECH",
      };
    });

  const votes: Array<{
    voter: string;
    voterSeat: number;
    targetSeat: number;
    targetName: string;
    day: number;
  }> = [];
  for (const [dayStr, voteRecord] of Object.entries(gameState.voteHistory)) {
    const day = Number(dayStr);
    for (const [voterId, targetSeat] of Object.entries(voteRecord)) {
      const voter = gameState.players.find((p) => p.playerId === voterId);
      const target = gameState.players.find((p) => p.seat === targetSeat);
      if (voter && target) {
        votes.push({
          voter: voter.displayName,
          voterSeat: voter.seat,
          targetSeat,
          targetName: target.displayName,
          day,
        });
      }
    }
  }

  const nightDeaths: Array<{ seat: number; name: string; day: number; reason: string }> = [];
  if (gameState.nightHistory) {
    for (const [dayStr, night] of Object.entries(gameState.nightHistory)) {
      const day = Number(dayStr);
      if (night.deaths) {
        for (const d of night.deaths) {
          const player = gameState.players.find((p) => p.seat === d.seat);
          if (player) {
            nightDeaths.push({
              seat: d.seat,
              name: player.displayName,
              day,
              reason: d.reason === "wolf" ? "狼人击杀" : d.reason === "poison" ? "女巫毒杀" : "其他",
            });
          }
        }
      }
    }
  }

  let seerChecks: Array<{ targetSeat: number; isWolf: boolean; day: number }> | undefined;
  if (humanPlayer?.role === "Seer" && gameState.nightActions.seerHistory) {
    seerChecks = gameState.nightActions.seerHistory.map((h) => ({
      targetSeat: h.targetSeat,
      isWolf: h.isWolf,
      day: h.day,
    }));
  }

  return {
    myRole: roleLabel,
    mySeat: humanPlayer?.seat ?? 0,
    myName: humanName,
    day: gameState.day,
    phase: gameState.phase,
    players,
    speeches,
    votes,
    nightDeaths,
    seerChecks,
  };
}

/** 解析 API 返回的 analysis(可能是 JSON 对象或纯文本) */
function parseAnalysis(raw: unknown): AnalysisResult | string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as AnalysisResult).players)) {
    return raw as AnalysisResult;
  }
  return String(raw);
}

export function AIAssistPanel({
  isOpen,
  onClose,
  gameState,
  humanPlayer,
  humanName,
}: AIAssistPanelProps) {
  const [tab, setTab] = useState<Tab>("analyze");
  const [analysis, setAnalysis] = useState<AnalysisResult | string>("");
  const [speechAdvice, setSpeechAdvice] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [selectedHistorySeat, setSelectedHistorySeat] = useState<number | null>(null);
  const t = useTranslations();

  const roleKey = humanPlayer
    ? humanPlayer.role.charAt(0).toLowerCase() + humanPlayer.role.slice(1)
    : "";
  const roleLabel = roleKey ? t(`roles.${roleKey}`) : "未知";

  const gameContext = useMemo(
    () => buildGameContext(gameState, humanPlayer, humanName, roleLabel),
    [gameState, humanPlayer, humanName, roleLabel]
  );

  // 其他玩家(不含自己),按 seat 排序
  const otherPlayers = useMemo(
    () => gameContext.players.filter((p) => p.seat !== gameContext.mySeat).sort((a, b) => a.seat - b.seat),
    [gameContext]
  );

  // 按玩家分组的发言历史
  const speechesBySeat = useMemo(() => {
    const map = new Map<number, Array<{ content: string; day: number; phase: string }>>();
    for (const s of gameContext.speeches) {
      if (s.speakerSeat === gameContext.mySeat) continue;
      if (!map.has(s.speakerSeat)) map.set(s.speakerSeat, []);
      map.get(s.speakerSeat)!.push({ content: s.content, day: s.day, phase: s.phase });
    }
    return map;
  }, [gameContext]);

  const callAPI = useCallback(
    async (type: Tab) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/ai-assist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            gameContext,
            analysis: type === "speech" ? (typeof analysis === "string" ? analysis : JSON.stringify(analysis)) : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (type === "analyze") {
          setAnalysis(parseAnalysis(data.result));
        } else {
          setSpeechAdvice(data.result);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("[QUOTA_EXHAUSTED]")) {
          setError("AI 调用额度已用尽,请稍后重试");
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [gameContext, analysis]
  );

  const phaseLabel = (phase: string) => {
    if (phase.includes("SPEECH")) return "发言";
    if (phase.includes("VOTE")) return "投票";
    if (phase.includes("BADGE")) return "警徽";
    return phase;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="ai-assist-panel"
          initial={{ opacity: 0, x: -24, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: -24, y: 12, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="fixed bottom-20 left-5 z-50 flex h-[min(720px,85vh)] w-[min(560px,94vw)] flex-col overflow-hidden rounded-xl border border-amber-500/30 bg-[#1a1410] shadow-2xl"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-amber-500/20 bg-black/40 px-5 py-3.5">
            <div className="flex items-center gap-2.5 text-amber-300">
              <Brain size={22} weight="fill" />
              <span className="text-base font-bold">AI 助手</span>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                {gameContext.myRole} · {gameContext.mySeat}号
              </span>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-stone-300 hover:bg-white/10 hover:text-white"
              type="button"
              aria-label="关闭"
            >
              <X size={20} />
            </button>
          </div>

          {/* Tab 切换 */}
          <div className="flex border-b border-white/10 bg-black/20">
            {([
              { key: "analyze" as Tab, icon: Brain, label: "局势分析" },
              { key: "speech" as Tab, icon: Lightbulb, label: "发言指导" },
              { key: "history" as Tab, icon: ChatCircleDots, label: "玩家发言" },
            ]).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors ${
                  tab === key
                    ? "border-b-2 border-amber-400 bg-amber-500/10 text-amber-300"
                    : "text-stone-300 hover:bg-white/5 hover:text-white"
                }`}
                type="button"
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>

          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto px-5 py-4 text-[15px] text-stone-100">
            {error && (
              <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2.5 text-sm text-red-300">
                {error}
              </div>
            )}

            {/* === 局势分析 === */}
            {tab === "analyze" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm text-stone-200">
                  第 {gameContext.day} 天 · 发言 {gameContext.speeches.length} 条 · 投票 {gameContext.votes.length} 条
                </div>

                {analysis ? (
                  typeof analysis === "string" ? (
                    <div className="prose prose-invert prose-sm max-w-none text-stone-100">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
                    </div>
                  ) : (
                    <>
                      {/* 可视化:每个玩家的身份概率条 */}
                      <div className="space-y-3">
                        {analysis.players.map((p) => (
                          <div
                            key={p.seat}
                            className="rounded-lg border border-white/15 bg-white/5 p-3.5"
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-300">
                                  {p.seat}
                                </span>
                                <span className="font-semibold text-white">{p.name}</span>
                              </div>
                              <span className={`text-xs font-medium ${CONFIDENCE_COLORS[p.confidence] || "text-stone-400"}`}>
                                可信度: {p.confidence}
                              </span>
                            </div>

                            {/* 概率进度条 */}
                            <div className="space-y-1.5">
                              {p.identities.map((id, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <span className="w-12 shrink-0 text-xs text-stone-300">{id.role}</span>
                                  <div className="h-5 flex-1 overflow-hidden rounded bg-black/40">
                                    <div
                                      className={`h-full ${getIdentityColor(id.role)} flex items-center justify-end pr-2 text-[11px] font-bold text-white transition-all`}
                                      style={{ width: `${Math.max(8, id.probability)}%` }}
                                    >
                                      {id.probability}%
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* 判断依据 */}
                            <div className="mt-2 rounded bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-stone-300">
                              <span className="font-semibold text-amber-400/90">依据:</span> {p.reason}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* 局势总结 */}
                      {analysis.summary && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5">
                          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-amber-300">
                            <Brain size={14} weight="fill" /> 局势总结
                          </div>
                          <p className="text-sm leading-relaxed text-stone-100">{analysis.summary}</p>
                        </div>
                      )}
                    </>
                  )
                ) : (
                  <div className="py-12 text-center text-stone-400">
                    {loading ? "正在分析局势..." : "点击下方按钮开始分析"}
                  </div>
                )}
              </div>
            )}

            {/* === 发言指导 === */}
            {tab === "speech" && (
              <div className="space-y-3">
                <div className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm text-stone-200">
                  结合局势分析 + 你的身份(<span className="font-semibold text-amber-300">{gameContext.myRole}</span>),给出本轮发言策略。
                  {!analysis && (
                    <span className="mt-1 block text-amber-400">
                      建议先做"局势分析"再获取发言指导。
                    </span>
                  )}
                </div>
                {speechAdvice ? (
                  <div className="prose prose-invert prose-sm max-w-none text-stone-100">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{speechAdvice}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="py-12 text-center text-stone-400">
                    {loading ? "正在生成发言建议..." : "点击下方按钮获取发言指导"}
                  </div>
                )}
              </div>
            )}

            {/* === 玩家发言历史 === */}
            {tab === "history" && (
              <div className="space-y-3">
                {/* 玩家选择器 */}
                <div className="flex flex-wrap gap-1.5">
                  {otherPlayers.map((p) => {
                    const count = speechesBySeat.get(p.seat)?.length || 0;
                    const active = selectedHistorySeat === p.seat;
                    return (
                      <button
                        key={p.seat}
                        onClick={() => setSelectedHistorySeat(active ? null : p.seat)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                          active
                            ? "border-amber-400 bg-amber-500/20 text-amber-300"
                            : "border-white/15 bg-white/5 text-stone-300 hover:border-white/30 hover:text-white"
                        } ${!p.alive ? "opacity-50" : ""}`}
                        type="button"
                      >
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black/40 text-[10px]">{p.seat}</span>
                        {p.name}
                        <span className="rounded-full bg-black/40 px-1.5 text-[10px] text-stone-400">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {/* 发言列表 */}
                {selectedHistorySeat !== null ? (
                  (() => {
                    const list = speechesBySeat.get(selectedHistorySeat) || [];
                    const player = otherPlayers.find((p) => p.seat === selectedHistorySeat);
                    if (list.length === 0) {
                      return (
                        <div className="py-10 text-center text-sm text-stone-400">
                          {player?.name}({selectedHistorySeat}号) 暂无发言记录
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-amber-400">
                          {player?.name}({selectedHistorySeat}号) · 共 {list.length} 条发言
                        </div>
                        {list.map((s, i) => (
                          <div key={i} className="rounded-lg border border-white/10 bg-white/5 p-3">
                            <div className="mb-1 flex items-center gap-2 text-xs text-stone-400">
                              <span className="rounded bg-black/40 px-1.5 py-0.5">第{s.day}天</span>
                              <span className="rounded bg-black/40 px-1.5 py-0.5">{phaseLabel(s.phase)}</span>
                            </div>
                            <p className="text-sm leading-relaxed text-stone-100">{s.content}</p>
                          </div>
                        ))}
                      </div>
                    );
                  })()
                ) : (
                  <div className="py-10 text-center text-sm text-stone-400">
                    <User size={32} className="mx-auto mb-2 opacity-40" />
                    选择上方玩家查看其历史发言
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 底部操作(局势分析和发言指导 tab 才显示) */}
          {tab !== "history" && (
            <div className="border-t border-white/10 bg-black/30 px-5 py-3.5">
              <button
                onClick={() => callAPI(tab)}
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-red-600 py-3 text-base font-bold text-white shadow-lg transition-all hover:shadow-amber-700/40 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
              >
                {loading ? (
                  <>
                    <Spinner size={18} className="animate-spin" />
                    分析中...
                  </>
                ) : tab === "analyze" ? (
                  <>
                    <Brain size={18} weight="fill" />
                    分析局势
                  </>
                ) : (
                  <>
                    <Lightbulb size={18} weight="fill" />
                    获取发言指导
                  </>
                )}
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
