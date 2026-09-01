"use client";

import { BandStrip } from "./BandStrip";
import { PlayControl } from "./PlayControl";
import { formatSnippet } from "@/lib/audio";
import { t } from "@/lib/i18n";
import type { Solo } from "@/lib/types";

/* ------------------------------------------------------------------
   The sleeve.

   Its headline is the amount of audio the player has earned, set at sleeve
   scale and running past the left margin the way Reid Miles cropped a
   title. The number grows as the round goes badly, so the cover states the
   score without a scoreboard. When the round closes it turns over and the
   headline becomes the answer.

   The divider between the two halves of the page is treated as the spine
   of the sleeve, with the catalogue number set along it.
   ------------------------------------------------------------------ */

interface SleeveProps {
  solo: Solo;
  ladderMs: number[];
  rung: number;
  revealed: boolean;
  playing: boolean;
  progress: number;
  /** Milliseconds into the solo currently sounding, or null when silent. */
  playheadMs: number | null;
  onPlay: () => void;
  audioReady: boolean;
}

export function Sleeve({
  solo, ladderMs, rung, revealed, playing, progress, playheadMs, onPlay, audioReady,
}: SleeveProps) {
  const unlocked = ladderMs[Math.min(rung, ladderMs.length - 1)];
  const amount = formatSnippet(unlocked).replace(" s", "");

  return (
    <div className="relative flex min-h-full flex-col p-6 sm:p-10 lg:py-12 lg:pl-14 lg:pr-24">
      <Spine catalog={solo.catalog} />

      <div className="flex items-baseline justify-between gap-4">
        <span className="type-eyebrow text-flame">{t("round.eyebrow")}</span>
        <span className="type-data text-xs text-paper-faint lg:hidden">{solo.catalog}</span>
      </div>

      <div className="flex flex-1 items-center py-10">
        {revealed ? (
          <div className="min-w-0">
            <h1 className="type-display-tight break-words text-[clamp(2.5rem,7vw,5.5rem)] text-paper">
              {solo.artist}
            </h1>
            <p className="type-display mt-5 text-[clamp(1.1rem,2.2vw,1.6rem)] text-flame">
              {solo.song}
            </p>
            {solo.album && (
              <p className="type-body mt-3 text-sm text-paper-dim">
                {solo.album}
                {solo.year ? `, ${solo.year}` : ""}
              </p>
            )}
          </div>
        ) : (
          <div className="min-w-0">
            {/* The headline runs past the left margin on purpose. */}
            <div className="flex items-end gap-5">
              <span
                className="type-display-tight -ml-[0.05em] block text-[clamp(6rem,23vw,20rem)] text-paper"
                style={{ fontVariantNumeric: "lining-nums" }}
              >
                {amount}
              </span>
              <span className="type-eyebrow mb-[0.6em] shrink-0 bg-flame px-2 py-1 text-ink">
                sec
              </span>
            </div>

            <p className="type-eyebrow mt-4 text-paper-dim">unlocked so far</p>

          </div>
        )}
      </div>

      <div className="space-y-8">
        <PlayControl
          onPlay={onPlay}
          playing={playing}
          progress={progress}
          disabled={!audioReady}
          label={
            revealed
              ? t("result.listenFull")
              : t("round.unlocked", { ms: formatSnippet(unlocked) })
          }
        />

        <BandStrip
          ladderMs={ladderMs}
          current={Math.min(rung, ladderMs.length - 1)}
          playheadMs={playheadMs}
        />
      </div>
    </div>
  );
}

/** Sleeve spine: vertical type along the divider, reading bottom to top. */
function Spine({ catalog }: { catalog: string }) {
  return (
    <div className="absolute inset-y-12 right-8 hidden items-center lg:flex">
      <span
        className="type-eyebrow whitespace-nowrap text-paper-faint"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
      >
        {t("brand")} <span className="text-flame">·</span> {catalog}
      </span>
    </div>
  );
}
