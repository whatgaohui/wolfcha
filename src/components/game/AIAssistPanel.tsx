"use client";

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Brain, Lightbulb, Spinner } from "@phosphor-icons/react";
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

type Tab = "analyze" | "speech";

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

  // 收集发言记录
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

  // 收集投票记录
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

  // 夜间死亡记录
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

  // 预言家查验记录(仅当用户是预言家时提供)
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

export function AIAssistPanel({
  isOpen,
  onClose,
  gameState,
  humanPlayer,
  humanName,
}: AIAssistPanelProps) {
  const [tab, setTab] = useState<Tab>("analyze");
  const [analysis, setAnalysis] = useState<string>("");
  const [speechAdvice, setSpeechAdvice] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const t = useTranslations();

  // role 是 PascalCase (如 "WhiteWolfKing"), i18n key 是 camelCase ("whiteWolfKing")
  const roleKey = humanPlayer
    ? humanPlayer.role.charAt(0).toLowerCase() + humanPlayer.role.slice(1)
    : "";
  const roleLabel = roleKey ? t(`roles.${roleKey}`) : "未知";

  const gameContext = useMemo(
    () => buildGameContext(gameState, humanPlayer, humanName, roleLabel),
    [gameState, humanPlayer, humanName, roleLabel]
  );

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
            analysis: type === "speech" ? analysis : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (type === "analyze") {
          setAnalysis(data.result);
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

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="ai-assist-panel"
          initial={{ opacity: 0, x: -24, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: -24, y: 12, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="fixed bottom-20 left-5 z-50 flex h-[520px] w-[380px] max-w-[92vw] flex-col overflow-hidden rounded-lg border shadow-2xl glass-panel glass-panel--strong"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2 text-amber-300">
              <Brain size={20} weight="fill" />
              <span className="text-sm font-semibold">AI 助手</span>
            </div>
            <button
              onClick={onClose}
              className="text-stone-400 hover:text-white"
              type="button"
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </div>

          {/* Tab 切换 */}
          <div className="flex border-b border-white/10">
            <button
              onClick={() => setTab("analyze")}
              className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
                tab === "analyze"
                  ? "border-b-2 border-amber-400 text-amber-300"
                  : "text-stone-400 hover:text-stone-200"
              }`}
              type="button"
            >
              <Brain size={14} />
              局势分析
            </button>
            <button
              onClick={() => setTab("speech")}
              className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
                tab === "speech"
                  ? "border-b-2 border-amber-400 text-amber-300"
                  : "text-stone-400 hover:text-stone-200"
              }`}
              type="button"
            >
              <Lightbulb size={14} />
              发言指导
            </button>
          </div>

          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto px-4 py-3 text-sm text-stone-200">
            {error && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {tab === "analyze" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-stone-400">
                  分析场上每个玩家的身份概率和判断依据,帮你理清局势。
                  <br />
                  当前:第 {gameContext.day} 天 · {gameContext.myRole} · 发言 {gameContext.speeches.length} 条
                </div>
                {analysis ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="py-8 text-center text-stone-500">
                    {loading ? "正在分析局势..." : "点击下方按钮开始分析"}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-stone-400">
                  结合局势分析 + 你的身份({gameContext.myRole}),给出本轮发言策略。
                  {!analysis && (
                    <span className="mt-1 block text-amber-400/80">
                      建议先做"局势分析"再获取发言指导。
                    </span>
                  )}
                </div>
                {speechAdvice ? (
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{speechAdvice}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="py-8 text-center text-stone-500">
                    {loading ? "正在生成发言建议..." : "点击下方按钮获取发言指导"}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 底部操作 */}
          <div className="border-t border-white/10 px-4 py-3">
            <button
              onClick={() => callAPI(tab)}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-red-600 py-2.5 text-sm font-semibold text-white shadow-lg transition-all hover:shadow-amber-700/40 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              {loading ? (
                <>
                  <Spinner size={16} className="animate-spin" />
                  分析中...
                </>
              ) : tab === "analyze" ? (
                <>
                  <Brain size={16} weight="fill" />
                  分析局势
                </>
              ) : (
                <>
                  <Lightbulb size={16} weight="fill" />
                  获取发言指导
                </>
              )}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
