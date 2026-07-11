"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, PencilSimple } from "@phosphor-icons/react";
import { MARK_DEFS, isCustomMark, getCustomText, makeCustomMark, type MarkMeta } from "@/lib/player-marks";

interface MarkMenuProps {
  isOpen: boolean;
  seat: number | null;
  playerName: string;
  currentMark: string | undefined;
  onSelect: (mark: string | undefined) => void;
  onClose: () => void;
}

export function MarkMenu({ isOpen, seat, playerName, currentMark, onSelect, onClose }: MarkMenuProps) {
  const [customText, setCustomText] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const isCustom = currentMark ? isCustomMark(currentMark) : false;

  return (
    <AnimatePresence>
      {isOpen && seat !== null && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-amber-500/30 bg-[#1a1410] p-5 shadow-2xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-base font-bold text-amber-300">
                  标记 {seat + 1}号 {playerName}
                </div>
                <div className="text-xs text-stone-400">选择标记(再次点击可取消)</div>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-stone-400 hover:bg-white/10 hover:text-white"
                type="button"
                aria-label="关闭"
              >
                <X size={20} />
              </button>
            </div>

            {/* 预设标记网格 */}
            <div className="grid grid-cols-4 gap-2">
              {MARK_DEFS.map((def: MarkMeta) => {
                const active = currentMark === def.key;
                return (
                  <button
                    key={def.key}
                    onClick={() => onSelect(active ? undefined : def.key)}
                    className={`flex items-center justify-center rounded-lg border px-2 py-2.5 text-xs font-semibold transition-all ${
                      active
                        ? `${def.color} ${def.text} border-white/30 shadow-lg scale-105`
                        : "border-white/10 bg-white/5 text-stone-300 hover:border-white/25 hover:bg-white/10"
                    }`}
                    type="button"
                  >
                    {def.short}
                  </button>
                );
              })}
            </div>

            {/* 自定义标记区 */}
            <div className="mt-3 border-t border-white/10 pt-3">
              {!showCustom ? (
                <button
                  onClick={() => setShowCustom(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-stone-300 hover:bg-white/10"
                  type="button"
                >
                  <PencilSimple size={14} />
                  自定义标记
                </button>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value.slice(0, 8))}
                    placeholder="输入自定义标记(最多8字)"
                    className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-stone-500 focus:border-amber-500/50 focus:outline-none"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customText.trim()) {
                        onSelect(makeCustomMark(customText.trim()));
                        setCustomText("");
                        setShowCustom(false);
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (customText.trim()) {
                        onSelect(makeCustomMark(customText.trim()));
                        setCustomText("");
                        setShowCustom(false);
                      }
                    }}
                    disabled={!customText.trim()}
                    className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-400 disabled:opacity-40"
                    type="button"
                  >
                    确定
                  </button>
                  <button
                    onClick={() => { setShowCustom(false); setCustomText(""); }}
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs text-stone-400 hover:bg-white/10"
                    type="button"
                  >
                    取消
                  </button>
                </div>
              )}

              {/* 当前是自定义标记时显示 */}
              {isCustom && currentMark && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded bg-pink-500 px-2 py-0.5 text-xs font-bold text-white">
                    {getCustomText(currentMark)}
                  </span>
                  <button
                    onClick={() => onSelect(undefined)}
                    className="text-xs text-stone-400 hover:text-white"
                    type="button"
                  >
                    清除
                  </button>
                </div>
              )}
            </div>

            {/* 清除按钮 */}
            {currentMark && !isCustom && (
              <button
                onClick={() => onSelect(undefined)}
                className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-stone-400 hover:bg-white/10 hover:text-white"
                type="button"
              >
                清除标记
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
