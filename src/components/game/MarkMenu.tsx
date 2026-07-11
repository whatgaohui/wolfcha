"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X } from "@phosphor-icons/react";
import { MARK_DEFS, type PlayerMark, type MarkMeta } from "@/lib/player-marks";

interface MarkMenuProps {
  isOpen: boolean;
  seat: number | null;
  playerName: string;
  currentMark: PlayerMark | undefined;
  onSelect: (mark: PlayerMark | undefined) => void;
  onClose: () => void;
}

export function MarkMenu({ isOpen, seat, playerName, currentMark, onSelect, onClose }: MarkMenuProps) {
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
                <div className="text-xs text-stone-400">选择一个标记(再次点击可取消)</div>
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

            <div className="grid grid-cols-4 gap-2">
              {MARK_DEFS.map((def: MarkMeta) => {
                const active = currentMark === def.key;
                return (
                  <button
                    key={def.key}
                    onClick={() => onSelect(active ? undefined : def.key)}
                    className={`flex flex-col items-center justify-center rounded-lg border px-2 py-2.5 text-xs font-semibold transition-all ${
                      active
                        ? `${def.color} ${def.text} border-white/30 shadow-lg scale-105`
                        : "border-white/10 bg-white/5 text-stone-300 hover:border-white/25 hover:bg-white/10"
                    }`}
                    type="button"
                  >
                    <span className="text-sm">{def.short}</span>
                  </button>
                );
              })}
            </div>

            {currentMark && (
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
