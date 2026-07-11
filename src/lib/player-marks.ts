"use client";

import { atomWithStorage } from "jotai/utils";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

/**
 * 玩家标记类型
 * - 预设角色标记(狼人/预言家等)
 * - 状态标记(金水/银水/好人)
 * - 自定义文本标记(custom_ 前缀)
 */
export type PresetMark =
  | "wolf"       // 狼人
  | "white_wolf" // 白狼王
  | "seer"       // 预言家
  | "witch"      // 女巫
  | "hunter"     // 猎人
  | "guard"      // 守卫
  | "magician"   // 奇迹商人
  | "villager"   // 平民
  | "gold"       // 金水
  | "silver"     // 银水
  | "good";      // 好人

/** 自定义标记用 custom:xxx 格式存储 */
export type PlayerMark = PresetMark | string;

export interface MarkMeta {
  key: string;
  label: string;
  color: string;   // tailwind bg class
  text: string;    // tailwind text class
  short: string;   // 短标签
}

/** 预设标记定义 */
export const MARK_DEFS: MarkMeta[] = [
  // 角色标记
  { key: "wolf",        label: "狼人",     color: "bg-red-600",     text: "text-white",  short: "狼人" },
  { key: "white_wolf",  label: "白狼王",   color: "bg-red-800",     text: "text-white",  short: "白狼王" },
  { key: "seer",        label: "预言家",   color: "bg-indigo-500",  text: "text-white",  short: "预言家" },
  { key: "witch",       label: "女巫",     color: "bg-emerald-600", text: "text-white",  short: "女巫" },
  { key: "hunter",      label: "猎人",     color: "bg-orange-500",  text: "text-white",  short: "猎人" },
  { key: "guard",       label: "守卫",     color: "bg-sky-500",     text: "text-white",  short: "守卫" },
  { key: "magician",    label: "奇迹商人", color: "bg-purple-500",  text: "text-white",  short: "商人" },
  { key: "villager",    label: "平民",     color: "bg-stone-400",   text: "text-white",  short: "平民" },
  // 状态标记
  { key: "gold",        label: "金水",     color: "bg-amber-500",   text: "text-white",  short: "金水" },
  { key: "silver",      label: "银水",     color: "bg-cyan-400",    text: "text-white",  short: "银水" },
  { key: "good",        label: "好人",     color: "bg-green-500",   text: "text-white",  short: "好人" },
];

const CUSTOM_PREFIX = "custom:";

export function isCustomMark(mark: string): boolean {
  return mark.startsWith(CUSTOM_PREFIX);
}

export function getCustomText(mark: string): string {
  return mark.slice(CUSTOM_PREFIX.length);
}

export function makeCustomMark(text: string): string {
  return CUSTOM_PREFIX + text;
}

/** 获取标记的显示信息(预设或自定义) */
export function getMarkDef(key: string): MarkMeta {
  if (isCustomMark(key)) {
    const text = getCustomText(key);
    return {
      key,
      label: text,
      color: "bg-pink-500",
      text: "text-white",
      short: text.length > 4 ? text.slice(0, 4) : text,
    };
  }
  return MARK_DEFS.find((m) => m.key === key) || {
    key,
    label: key,
    color: "bg-stone-500",
    text: "text-white",
    short: key,
  };
}

/** 标记存储: gameId -> { seat -> mark } */
type GameMarks = Record<string, Record<number, string>>;

const marksAtom = atomWithStorage<GameMarks>("wolfcha.player_marks", {});

/** 当前游戏的标记(由组件传入 gameId 筛选) */
export function usePlayerMarks(gameId: string) {
  const allMarks = useAtomValue(marksAtom);
  const setAllMarks = useSetAtom(marksAtom);

  const marks = allMarks[gameId] || {};

  const getMark = useCallback((seat: number): string | undefined => {
    return marks[seat];
  }, [marks]);

  const setMark = useCallback((seat: number, mark: string | undefined) => {
    setAllMarks((prev) => {
      const gameMarks = { ...(prev[gameId] || {}) };
      if (mark === undefined || mark === "") {
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

  return { marks, getMark, setMark, clearAll };
}
