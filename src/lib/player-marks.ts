"use client";

import { atomWithStorage } from "jotai/utils";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
// atom not needed, using atomWithStorage only

/**
 * 玩家标记类型 — 涵盖狼人杀常见身份/状态标记
 */
export type PlayerMark =
  | "gold"      // 金水 — 预言家查验的好人
  | "kill"      // 查杀 — 预言家查验的狼人
  | "silver"    // 银水 — 女巫救过的人
  | "iron_wolf" // 铁狼 — 身份坐实为狼人
  | "iron_good" // 铁好人 — 身份坐实为好人
  | "clear_wolf"// 明狼 — 明确是狼人
  | "sus_wolf"  // 疑狼 — 怀疑是狼人
  | "sus_god"   // 疑神 — 怀疑是神职
  | "claim_god" // 跳神 — 跳了神职身份
  | "villager"  // 平民 — 认为是平民
  | "wolf_pit"  // 狼坑 — 在狼坑里
  | "boom_wolf"; // 暴狼 — 暴狼(自爆或被抓)

export interface MarkMeta {
  key: PlayerMark;
  label: string;
  color: string;   // tailwind bg class
  text: string;    // tailwind text class
  short: string;   // 短标签(2字)
}

/** 所有标记定义(颜色参考狼人杀常见 UI) */
export const MARK_DEFS: MarkMeta[] = [
  { key: "gold",       label: "金水",   color: "bg-amber-500",   text: "text-white",   short: "金水" },
  { key: "kill",       label: "查杀",   color: "bg-red-600",     text: "text-white",   short: "查杀" },
  { key: "silver",     label: "银水",   color: "bg-sky-400",     text: "text-white",   short: "银水" },
  { key: "iron_wolf",  label: "铁狼",   color: "bg-red-800",     text: "text-white",   short: "铁狼" },
  { key: "iron_good",  label: "铁好人", color: "bg-emerald-600", text: "text-white",   short: "铁好" },
  { key: "clear_wolf", label: "明狼",   color: "bg-red-700",     text: "text-white",   short: "明狼" },
  { key: "sus_wolf",   label: "疑狼",   color: "bg-orange-500",  text: "text-white",   short: "疑狼" },
  { key: "sus_god",    label: "疑神",   color: "bg-purple-500",  text: "text-white",   short: "疑神" },
  { key: "claim_god",  label: "跳神",   color: "bg-indigo-500",  text: "text-white",   short: "跳神" },
  { key: "villager",   label: "平民",   color: "bg-stone-400",   text: "text-white",   short: "民" },
  { key: "wolf_pit",   label: "狼坑",   color: "bg-rose-400",    text: "text-white",   short: "狼坑" },
  { key: "boom_wolf",  label: "暴狼",   color: "bg-red-900",     text: "text-white",   short: "暴狼" },
];

export function getMarkDef(key: PlayerMark): MarkMeta | undefined {
  return MARK_DEFS.find((m) => m.key === key);
}

/** 标记存储: gameId -> { seat -> mark } */
type GameMarks = Record<number, Record<number, PlayerMark>>;

const marksAtom = atomWithStorage<GameMarks>("wolfcha.player_marks", {});

/** 当前游戏的标记(由组件传入 gameId 筛选) */
export function usePlayerMarks(gameId: string) {
  const allMarks = useAtomValue(marksAtom);
  const setAllMarks = useSetAtom(marksAtom);

  const marks = allMarks[gameId] || {};

  const getMark = useCallback((seat: number): PlayerMark | undefined => {
    return marks[seat];
  }, [marks]);

  const setMark = useCallback((seat: number, mark: PlayerMark | undefined) => {
    setAllMarks((prev) => {
      const gameMarks = { ...(prev[gameId] || {}) };
      if (mark === undefined) {
        delete gameMarks[seat];
      } else {
        gameMarks[seat] = mark;
      }
      return { ...prev, [gameId]: gameMarks };
    });
  }, [gameId, setAllMarks]);

  const toggleMark = useCallback((seat: number, mark: PlayerMark) => {
    setAllMarks((prev) => {
      const gameMarks = { ...(prev[gameId] || {}) };
      if (gameMarks[seat] === mark) {
        delete gameMarks[seat];
      } else {
        gameMarks[seat] = mark;
      }
      return { ...prev, [gameId]: gameMarks };
    });
  }, [gameId, setAllMarks]);

  const clearAll = useCallback(() => {
    setAllMarks((prev) => {
      const next = { ...prev };
      delete next[gameId];
      return next;
    });
  }, [gameId, setAllMarks]);

  return { marks, getMark, setMark, toggleMark, clearAll };
}
