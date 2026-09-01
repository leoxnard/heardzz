"use client";

import { Overlay, Toggle } from "./Overlay";
import { formatSnippet } from "@/lib/audio";
import { CLIP_SECONDS, LADDER_PRESETS, type GameConfig } from "@/lib/config";
import { t } from "@/lib/i18n";

interface SettingsPanelProps {
  config: GameConfig;
  onPatch: (changes: Partial<GameConfig>) => void;
  onReset: () => void;
  onClose: () => void;
}

export function SettingsPanel({ config, onPatch, onReset, onClose }: SettingsPanelProps) {
  function setRung(index: number, ms: number) {
    const next = [...config.ladderMs];
    next[index] = ms;
    onPatch({ ladderMs: next });
  }

  function addRung() {
    const last = config.ladderMs[config.ladderMs.length - 1] ?? 1000;
    onPatch({ ladderMs: [...config.ladderMs, Math.min(last * 2, CLIP_SECONDS * 1000)] });
  }

  function removeRung(index: number) {
    if (config.ladderMs.length <= 1) return;
    onPatch({ ladderMs: config.ladderMs.filter((_, i) => i !== index) });
  }

  return (
    <Overlay title={t("settings.title")} onClose={onClose}>
      <p className="type-body text-sm text-paper-dim">{t("settings.intro")}</p>

      <Section title={t("settings.presets")}>
        <div className="flex flex-wrap gap-2">
          {LADDER_PRESETS.map((preset) => {
            const active = preset.ladderMs.join() === config.ladderMs.join();
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onPatch({ ladderMs: preset.ladderMs })}
                className={`type-eyebrow border px-3 py-2 transition-colors duration-150 ${
                  active
                    ? "border-flame bg-flame text-ink"
                    : "border-ink-edge text-paper-dim hover:border-paper-faint hover:text-paper"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t("settings.ladder")} help={t("settings.ladderHelp")}>
        <ul className="space-y-2">
          {config.ladderMs.map((ms, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="type-data w-7 text-xs text-paper-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <input
                type="number"
                min={10}
                max={CLIP_SECONDS * 1000}
                step={10}
                value={ms}
                onChange={(event) => setRung(i, Number(event.target.value))}
                className="type-data w-28 border border-ink-edge bg-ink-raised px-3 py-2 text-sm text-paper focus:border-flame focus:outline-none"
              />
              <span className="type-data text-xs text-paper-faint">ms</span>
              <span className="type-body ml-auto text-xs text-paper-dim">
                {formatSnippet(ms)}
              </span>
              <button
                type="button"
                onClick={() => removeRung(i)}
                disabled={config.ladderMs.length <= 1}
                aria-label={`${t("settings.removeRung")} ${i + 1}`}
                className="type-data px-2 text-paper-faint transition-colors hover:text-flame disabled:opacity-30"
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={addRung}
          className="type-eyebrow mt-4 w-full border border-ink-edge py-3 text-paper-dim transition-colors duration-150 hover:border-flame hover:text-flame"
        >
          {t("settings.addRung")}
        </button>
      </Section>

      <Section title={t("round.eyebrow")}>
        <Toggle
          label={t("settings.guessSong")}
          checked={config.guessSong}
          onChange={(value) => onPatch({ guessSong: value })}
        />
        <Toggle
          label={t("settings.skipCosts")}
          checked={config.skipCostsAttempt}
          onChange={(value) => onPatch({ skipCostsAttempt: value })}
        />
        <Toggle
          label={t("settings.verifiedOnly")}
          checked={config.verifiedOnly}
          onChange={(value) => onPatch({ verifiedOnly: value })}
        />
      </Section>

      <Section title={t("settings.leadIn")} help={t("settings.leadInHelp")}>
        <Slider
          value={config.leadInMs}
          min={0}
          max={5000}
          step={100}
          display={config.leadInMs === 0 ? "none" : formatSnippet(config.leadInMs)}
          onChange={(value) => onPatch({ leadInMs: value })}
        />
      </Section>

      <Section title={t("settings.volume")}>
        <Slider
          value={Math.round(config.volume * 100)}
          min={0}
          max={100}
          step={1}
          display={`${Math.round(config.volume * 100)}%`}
          onChange={(value) => onPatch({ volume: value / 100 })}
        />
      </Section>

      <button
        type="button"
        onClick={onReset}
        className="type-eyebrow mt-10 w-full border border-paper-faint py-3 text-paper-dim transition-colors duration-150 hover:border-flame hover:text-flame"
      >
        {t("settings.reset")}
      </button>
    </Overlay>
  );
}

function Section({
  title, help, children,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-ink-edge pt-6">
      <h3 className="type-eyebrow text-flame">{title}</h3>
      {help && <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">{help}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Slider({
  value, min, max, step, display, onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 flex-1 appearance-none bg-ink-edge accent-[var(--color-flame)]"
      />
      <span className="type-data w-14 text-right text-xs text-paper-dim">{display}</span>
    </div>
  );
}
