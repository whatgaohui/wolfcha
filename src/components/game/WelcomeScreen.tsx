"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import {
  PawPrint,
  Sparkle,
  GearSix,
  Users,
  MoonStars,
  Crosshair,
  Eye,
  Drop,
  Shield,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { WerewolfIcon } from "@/components/icons/FlatIcons";
import { Button } from "@/components/ui/button";
import { useAtom } from "jotai";
import { useTranslations } from "next-intl";
import type { DifficultyLevel, Role, StartGameOptions } from "@/types/game";
import { GameSetupModal } from "@/components/game/GameSetupModal";
import { LocaleSwitcher } from "@/components/game/LocaleSwitcher";
import { difficultyAtom, playerCountAtom, preferredRoleAtom } from "@/store/settings";
import { useAppLocale } from "@/i18n/useAppLocale";

interface WelcomeScreenProps {
  humanName: string;
  setHumanName: (name: string) => void;
  onStart: (options?: StartGameOptions) => void | Promise<void>;
  onAbort?: () => void;
  isLoading: boolean;
  isGenshinMode: boolean;
  onGenshinModeChange: (value: boolean) => void;
  isSpectatorMode: boolean;
  onSpectatorModeChange: (value: boolean) => void;
  bgmVolume: number;
  isSoundEnabled: boolean;
  isAiVoiceEnabled: boolean;
  isAutoAdvanceDialogueEnabled: boolean;
  onBgmVolumeChange: (value: number) => void;
  onSoundEnabledChange: (value: boolean) => void;
  onAiVoiceEnabledChange: (value: boolean) => void;
  onAutoAdvanceDialogueEnabledChange: (value: boolean) => void;
}

const PLAYER_COUNT_OPTIONS = [8, 9, 10, 11, 12];

const PLAYER_COUNT_CONFIG: Record<number, string> = {
  8: "3狼 · 3神 · 2民",
  9: "3狼 · 3神 · 3民",
  10: "2狼+白狼王 · 4神 · 3民",
  11: "3狼+白狼王 · 5神 · 2民",
  12: "3狼+白狼王 · 5神 · 3民",
};

const DIFFICULTY_OPTIONS: { value: DifficultyLevel; descKey: string }[] = [
  { value: "easy", descKey: "easyDesc" },
  { value: "normal", descKey: "normalDesc" },
  { value: "hard", descKey: "hardDesc" },
];

const ROLE_OPTIONS: { value: Role; Icon: PhosphorIcon; color: string }[] = [
  { value: "Villager", Icon: Users, color: "text-amber-700" },
  { value: "Werewolf", Icon: WerewolfIcon, color: "text-red-700" },
  { value: "Seer", Icon: Eye, color: "text-indigo-700" },
  { value: "Witch", Icon: Drop, color: "text-emerald-700" },
  { value: "Hunter", Icon: Crosshair, color: "text-orange-700" },
  { value: "Guard", Icon: Shield, color: "text-sky-700" },
];

export function WelcomeScreen({
  humanName,
  setHumanName,
  onStart,
  isLoading,
  isGenshinMode,
  onGenshinModeChange,
  isSpectatorMode,
  onSpectatorModeChange,
  bgmVolume,
  isSoundEnabled,
  isAiVoiceEnabled,
  isAutoAdvanceDialogueEnabled,
  onBgmVolumeChange,
  onSoundEnabledChange,
  onAiVoiceEnabledChange,
  onAutoAdvanceDialogueEnabledChange,
}: WelcomeScreenProps) {
  const t = useTranslations();
  const { locale } = useAppLocale();
  const [playerCount, setPlayerCount] = useAtom(playerCountAtom);
  const [difficulty, setDifficulty] = useAtom(difficultyAtom);
  const [preferredRole, setPreferredRole] = useAtom(preferredRoleAtom);
  const [showSetup, setShowSetup] = useState(false);

  const handleStart = () => {
    onStart({
      playerCount,
      difficulty,
      preferredRole: preferredRole || undefined,
    });
  };

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-gradient-to-b from-[#1a1410] via-[#2a1f17] to-[#0f0c0a] text-stone-100">
      {/* Ambient decorative glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 top-10 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-red-700/10 blur-3xl" />
        <div className="absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-indigo-500/5 blur-3xl" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-8">
        <div className="flex items-center gap-2">
          <PawPrint weight="fill" className="h-7 w-7 text-amber-400" />
          <span className="text-lg font-bold tracking-tight">Wolfcha</span>
          <span className="ml-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            z.ai
          </span>
        </div>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <Button
            variant="ghost"
            size="sm"
            className="text-stone-300 hover:bg-white/10 hover:text-white"
            onClick={() => setShowSetup(true)}
          >
            <GearSix className="mr-1 h-4 w-4" />
            {t("settings.title")}
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-4 pb-12 pt-4 sm:pb-16 sm:pt-10">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="flex flex-col items-center text-center"
        >
          <div className="mb-3 flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1 text-xs text-amber-200 sm:mb-4">
            <Sparkle weight="fill" className="h-3.5 w-3.5" />
            <span>AI Werewolf · 一个人也能玩的狼人杀</span>
          </div>

          <h1 className="bg-gradient-to-b from-white to-stone-300 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-5xl">
            猹杀 · Wolfcha
          </h1>
          <p className="mt-2 hidden max-w-xl text-sm leading-relaxed text-stone-400 sm:mt-3 sm:block sm:text-base">
            全 AI 对手实时发言、怀疑、带节奏与投票。双层 AI 扮演机制，每一局都充满不确定性。
            由 z.ai 大模型驱动，打开浏览器即可开局。
          </p>
        </motion.div>

        {/* Setup card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
          className="mt-5 w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm sm:mt-8 sm:p-6"
        >
          {/* Name input */}
          <div className="mb-4 sm:mb-5">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-stone-400">
              {locale === "zh" ? "你的名字" : "Your Name"}
            </label>
            <input
              type="text"
              value={humanName}
              onChange={(e) => setHumanName(e.target.value.slice(0, 20))}
              placeholder={locale === "zh" ? "给自己起个名字…" : "Enter your name…"}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-base text-white placeholder:text-stone-500 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
          </div>

          {/* Player count */}
          <div className="mb-4 sm:mb-5">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-stone-400">
              {t("gameSetup.playerCountLabel")}
            </label>
            <div className="grid grid-cols-5 gap-2">
              {PLAYER_COUNT_OPTIONS.map((count) => {
                const active = playerCount === count;
                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setPlayerCount(count)}
                    className={`flex flex-col items-center justify-center rounded-lg border px-2 py-2.5 transition-all ${
                      active
                        ? "border-amber-500 bg-amber-500/15 text-amber-200"
                        : "border-white/10 bg-black/20 text-stone-400 hover:border-white/20 hover:text-stone-200"
                    }`}
                  >
                    <span className="text-lg font-bold">{count}</span>
                    <span className="text-[10px] leading-tight opacity-70">人</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-center text-xs text-stone-500">
              {PLAYER_COUNT_CONFIG[playerCount]}
            </p>
          </div>

          {/* Difficulty */}
          <div className="mb-4 sm:mb-5">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-stone-400">
              {t("gameSetup.difficultyLabel")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DIFFICULTY_OPTIONS.map((opt) => {
                const active = difficulty === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDifficulty(opt.value)}
                    className={`rounded-lg border px-3 py-2.5 text-center transition-all ${
                      active
                        ? "border-amber-500 bg-amber-500/15 text-amber-200"
                        : "border-white/10 bg-black/20 text-stone-400 hover:border-white/20 hover:text-stone-200"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{t(`difficulty.${opt.value}`)}</span>
                    <span className="mt-0.5 block text-[10px] leading-tight opacity-70">
                      {t(`gameSetup.difficulty.${opt.descKey}`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preferred role */}
          <div className="mb-5 sm:mb-6">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-stone-400">
              {locale === "zh" ? "身份偏好" : "Role Preference"}
              <span className="ml-2 normal-case text-stone-500">
                {locale === "zh" ? "（可选，随机则留空）" : "(optional, leave empty for random)"}
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPreferredRole("")}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                  preferredRole === ""
                    ? "border-amber-500 bg-amber-500/15 text-amber-200"
                    : "border-white/10 bg-black/20 text-stone-400 hover:border-white/20 hover:text-stone-200"
                }`}
              >
                {locale === "zh" ? "随机" : "Random"}
              </button>
              {ROLE_OPTIONS.map(({ value, Icon, color }) => {
                const active = preferredRole === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPreferredRole(value)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                      active
                        ? "border-amber-500 bg-amber-500/15 text-amber-200"
                        : "border-white/10 bg-black/20 text-stone-400 hover:border-white/20 hover:text-stone-200"
                    }`}
                  >
                    <Icon weight="fill" className={`h-3.5 w-3.5 ${active ? "text-amber-300" : color}`} />
                    {t(`roles.${value.toLowerCase()}`)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Start button */}
          <Button
            onClick={handleStart}
            disabled={isLoading || !humanName.trim()}
            className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-amber-500 to-red-600 py-4 text-base font-bold text-white shadow-lg shadow-amber-900/30 transition-all hover:shadow-amber-700/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white"
                />
                {locale === "zh" ? "正在开局…" : "Starting…"}
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <MoonStars weight="fill" className="h-5 w-5" />
                {locale === "zh" ? "开始游戏" : "Start Game"}
              </span>
            )}
          </Button>

          {!humanName.trim() && (
            <p className="mt-2 text-center text-xs text-stone-500">
              {locale === "zh" ? "请先输入你的名字" : "Please enter your name first"}
            </p>
          )}
        </motion.div>

        {/* Feature highlights */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
          className="mt-6 hidden w-full grid-cols-1 gap-3 sm:mt-8 sm:grid sm:grid-cols-3"
        >
          {[
            {
              icon: Sparkle,
              title: locale === "zh" ? "双层 AI 扮演" : "Dual-layer AI",
              desc: locale === "zh" ? "虚拟人设 × 游戏身份，发言自然" : "Persona × role, natural speech",
            },
            {
              icon: Users,
              title: locale === "zh" ? "真实博弈压力" : "Real reasoning",
              desc: locale === "zh" ? "AI 会怀疑、伪装、跟票与反水" : "AI suspects, bluffs & votes",
            },
            {
              icon: MoonStars,
              title: locale === "zh" ? "沉浸复古体验" : "Immersive retro",
              desc: locale === "zh" ? "天黑眨眼转场 + 语音旁白" : "Night blink + voice narration",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
            >
              <Icon weight="fill" className="mb-2 h-5 w-5 text-amber-400" />
              <h3 className="text-sm font-semibold text-stone-100">{title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-stone-400">{desc}</p>
            </div>
          ))}
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 mt-auto border-t border-white/5 px-4 py-4 text-center text-xs text-stone-500">
        <p>
          Powered by <span className="font-semibold text-amber-400">z.ai</span> · GLM · TTS ·
          Wolfcha is an open-source project.
        </p>
      </footer>

      {/* Settings modal */}
      <GameSetupModal
        open={showSetup}
        onOpenChange={setShowSetup}
        playerCount={playerCount}
        onPlayerCountChange={setPlayerCount}
        preferredRole={preferredRole}
        onPreferredRoleChange={setPreferredRole}
        isGenshinMode={isGenshinMode}
        onGenshinModeChange={onGenshinModeChange}
        isSpectatorMode={isSpectatorMode}
        onSpectatorModeChange={onSpectatorModeChange}
        bgmVolume={bgmVolume}
        isSoundEnabled={isSoundEnabled}
        isAiVoiceEnabled={isAiVoiceEnabled}
        isAutoAdvanceDialogueEnabled={isAutoAdvanceDialogueEnabled}
        onBgmVolumeChange={onBgmVolumeChange}
        onSoundEnabledChange={onSoundEnabledChange}
        onAiVoiceEnabledChange={onAiVoiceEnabledChange}
        onAutoAdvanceDialogueEnabledChange={onAutoAdvanceDialogueEnabledChange}
      />
    </div>
  );
}
