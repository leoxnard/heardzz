"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Waveform } from "./Waveform";
import { aim, useSoloAudio } from "@/lib/audio";
import { STEMS } from "@/lib/config";
import { t } from "@/lib/i18n";
import type { Solo, StemId, StemSource, StemVariant } from "@/lib/types";

/* ------------------------------------------------------------------
   Listening to the pieces a record was pulled into.

   The separator's own verdict answers "is there anything here", which is a
   question a meter can answer. It cannot answer the one that matters — is
   this the thing the mode says it is. On Autumn Leaves the lead stem is
   louder than the record it came out of; on So What the piano the model
   failed to lift out is sitting in the soloist's stem; on Giant Steps the
   tenor is in the rhythm section. All three measure as healthy.

   So this plays each one from the exact instant a round would open on it,
   half a second at first because that is the rung the ladder starts on, and
   takes a yes or a no. Nothing is dealt until somebody has said yes.
   ------------------------------------------------------------------ */

const STEM_IDS: StemId[] = ["lead", "rhythm", "bass"];

export function StemReview({
  solo, cut, onSaved, resplit = 0,
}: {
  solo: Solo;
  /** Which of the record's two cuts this block is reviewing. */
  cut: "head" | "solo";
  onSaved: (written: Solo[]) => void;
  /**
   * Bumped by the editor when a save invalidated the stems. A count rather
   * than a flag so two saves in a row each start a split, and so this reads
   * as an event rather than as a state that has to be cleared again.
   */
  resplit?: number;
}) {
  const stems = cut === "solo" ? solo.soloClip?.stems : solo.stems;
  const sources = cut === "solo" ? solo.soloClip?.sources : solo.sources;
  const leadIn = cut === "solo" ? (solo.soloClip?.leadIn ?? 0) : solo.leadIn;
  const split = useSplit(solo.id, onSaved);

  /*
   * Run whatever the last save invalidated. Not forced: the save already
   * removed exactly the cuts whose heads changed, and the ones it left
   * alone are still the right audio for the question they answer.
   */
  const started = useRef(0);
  useEffect(() => {
    if (resplit === 0 || started.current === resplit) return;
    started.current = resplit;
    void split.run(false);
  }, [resplit, split]);

  /*
   * A record with no stems is the normal state after a save that changed
   * which heads belong in them — the library screen throws the old audio
   * away rather than keep serving an answer to a question that has moved.
   * So this is where the split is offered rather than only explained.
   */
  if (!stems) {
    return (
      <section className="mt-12 border-t border-ink-edge pt-8">
        <h3 className="type-eyebrow text-flame">{t("stemReview.title")}</h3>
        <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
          {t("stemReview.notSplit")}
        </p>
        <SplitButton split={split} label={t("stemReview.split")} />
      </section>
    );
  }

  return (
    <section className="mt-12 border-t border-ink-edge pt-8">
      <h3 className="type-eyebrow text-flame">{t("stemReview.title")}</h3>
      <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
        {t("stemReview.help")}
      </p>

      <SplitButton split={split} label={t("stemReview.resplit")} force />

      <ul className="mt-4 space-y-3">
        {STEM_IDS.map((id) => {
          const variant = stems?.[id];
          if (!variant) return null;
          return (
            <StemRow
              key={`${cut}:${id}`}
              soloId={solo.id}
              cut={cut}
              id={id}
              variant={variant}
              leadIn={leadIn}
              onSaved={onSaved}
            />
          );
        })}
      </ul>

      {sources && sources.length > 0 && (
        <>
          <h4 className="type-eyebrow mt-8 text-paper-dim">{t("stemReview.sources")}</h4>
          <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
            {t("stemReview.sourcesHelp")}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {sources.map((source) => (
              <SourceRow key={source.head} source={source} leadIn={leadIn} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * One separator head, to be listened to and nothing else.
 *
 * There is no verdict to give here and no marker to set. The question it
 * answers is where a part went when it is not where it should be — the
 * upright that the six-stem model files under `guitar`, the piano smeared
 * through `other` — and the only way to answer it is to hear them.
 */
function SourceRow({ source, leadIn }: { source: StemSource; leadIn: number }) {
  const audio = useSoloAudio(source.audio, 0.9);
  const owner = useRef({});
  useEffect(() => {
    const mine = owner.current;
    return () => aim(mine, null);
  }, []);

  const playFrom = useCallback(
    (from: number) => audio.play(from, (audio.buffer?.duration ?? from) - from),
    [audio],
  );

  return (
    <li className="flex items-center gap-3 border border-ink-edge px-3 py-2">
      <button
        type="button"
        disabled={audio.status !== "ready"}
        onClick={() => (audio.isPlaying ? audio.stop() : playFrom(leadIn))}
        onPointerEnter={() => aim(owner.current, { at: leadIn, play: playFrom })}
        onPointerLeave={() => aim(owner.current, null)}
        className={`type-eyebrow border px-3 py-1 text-xs transition-colors disabled:opacity-30 ${
          audio.isPlaying
            ? "border-flame text-flame"
            : "border-ink-edge text-paper-dim hover:border-flame hover:text-paper"
        }`}
      >
        {audio.isPlaying ? t("stemReview.stop") : source.head}
      </button>
      <span className="type-data text-xs text-paper-faint">
        {source.level === null ? "—" : `${source.level.toFixed(1)} dBFS`}
      </span>
    </li>
  );
}

/**
 * Run the split for one record, a cut at a time.
 *
 * The route does one cut per request because separating is about a minute
 * of CPU on the machine this runs on and a request that does both cuts is a
 * timeout with nothing to show for it. So the loop lives here, where it can
 * say which cut it is on — the alternative is a button that goes quiet for
 * three minutes and gives no way to tell working from hung.
 */
export function useSplit(id: string, onSaved: (written: Solo[]) => void) {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (force: boolean) => {
      setRunning(true);
      setError(null);
      try {
        /*
         * Both cuts by name, rather than asking for "the record" twice and
         * hoping the route picks a different one the second time. A record
         * with no solo marked simply answers that there is nothing to do for
         * that cut.
         */
        for (const cut of ["head", "solo"] as const) {
          const response = await fetch("/api/admin/split", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, force, cut }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Could not split it");
          if (data.written?.length) onSaved(data.written as Solo[]);
          setStep(data.split ?? null);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setRunning(false);
        setStep(null);
      }
    },
    [id, onSaved],
  );

  return { run, running, step, error };
}

export function SplitButton({
  split, label, force = false, compact = false,
}: {
  split: ReturnType<typeof useSplit>;
  label: string;
  force?: boolean;
  /** In a row rather than in a block, where the margin would push it off. */
  compact?: boolean;
}) {
  return (
    <div className={compact ? "" : "mt-4"}>
      <button
        type="button"
        disabled={split.running}
        onClick={() => split.run(force)}
        className="type-eyebrow border border-ink-edge px-4 py-2 text-xs text-paper-dim transition-colors hover:border-flame hover:text-paper disabled:opacity-40"
      >
        {split.running ? t("stemReview.splitting") : label}
      </button>
      {split.running && !compact && (
        <p className="type-body mt-2 text-xs text-paper-faint">
          {split.step ? `${split.step} — ${t("stemReview.splittingSlow")}` : t("stemReview.splittingSlow")}
        </p>
      )}
      {split.error && <p className="type-body mt-2 text-xs text-flame">{split.error}</p>}
    </div>
  );
}

function StemRow({
  soloId, cut, id, variant, leadIn, onSaved,
}: {
  soloId: string;
  cut: "head" | "solo";
  id: StemId;
  variant: StemVariant;
  leadIn: number;
  onSaved: (written: Solo[]) => void;
}) {
  const audio = useSoloAudio(variant.audio, 0.9);
  const owner = useRef({});
  const [busy, setBusy] = useState(false);
  /* Leaving is not the only way the pointer stops being over this — a tab
     change takes the waveform out from under it, and an aim left pointing
     at an unmounted player is a space bar that plays nothing. */
  useEffect(() => {
    const mine = owner.current;
    return () => aim(mine, null);
  }, []);
  const [error, setError] = useState<string | null>(null);

  /*
   * Where this stem starts, held here rather than read back off the record.
   *
   * It used to show the stored value except while a write was in flight,
   * and moved by writing on every pointer event. Both halves of that were
   * wrong: dragging fired a write and a re-judgement per pixel, and the
   * picture flipped between the pointer and whatever the server had last
   * confirmed — which is a marker that shakes and lags under the hand.
   *
   * So the drag is local and free, and the write happens once, when it ends.
   * The row is keyed on the cut and the stem, so switching either remounts
   * it and this starts from the record again.
   */
  const stored = typeof variant.leadIn === "number" ? variant.leadIn : leadIn;
  const [shown, setShown] = useState(stored);

  /*
   * Follow the record when it moves underneath — a re-split writes a freshly
   * detected start, and the row is keyed on the cut and the stem so it is not
   * remounted by one. Only when the stored value actually changes, or this
   * would fight the drag it is meant to leave alone.
   */
  const lastStored = useRef(stored);
  useEffect(() => {
    if (lastStored.current === stored) return;
    lastStored.current = stored;
    setShown(stored);
  }, [stored]);

  const label = STEMS.find((stem) => stem.id === id)?.label ?? id;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/stems", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: soloId, cut, stem: id, ...body }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { written: Solo[] };
      onSaved(data.written);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const rule = (approved: boolean | null) => patch({ approved });

  /*
   * A stem the meters already rejected is shown and can still be played —
   * seeing why it was thrown out is how the thresholds get checked — but it
   * is not offered a yes, because approving it would not deal it anyway.
   */
  const measured = variant.usable;
  const state = !measured ? "empty" : variant.approved === true ? "yes"
    : variant.approved === false ? "no" : "unruled";

  const badge = {
    empty: { text: t("stemReview.empty"), className: "text-paper-faint" },
    yes: { text: t("stemReview.approved"), className: "text-flame" },
    no: { text: t("stemReview.rejected"), className: "text-paper-faint line-through" },
    unruled: { text: t("stemReview.unruled"), className: "text-paper-dim" },
  }[state];

  return (
    <li className="border border-ink-edge p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="type-eyebrow text-paper">{label}</span>
        <span className={`type-eyebrow text-xs ${badge.className}`}>{badge.text}</span>
      </div>

      <p className="type-data mt-1 text-xs text-paper-faint">
        {variant.head ? `${variant.head} · ` : ""}
        {variant.model ? `${variant.model} · ` : ""}
        {t("stemReview.numbers", {
          rel: String(variant.relativeLevel ?? "—"),
          onset: String(variant.onsetRelative ?? "—"),
        })}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {/* One button, and it plays the whole thing. Judging a stem is not
            the game's ladder — it is listening to what is in there. */}
        <button
          type="button"
          disabled={audio.status !== "ready"}
          onClick={() =>
            audio.isPlaying
              ? audio.stop()
              : audio.play(shown, (audio.buffer?.duration ?? shown) - shown)
          }
          className="type-eyebrow border border-ink-edge px-4 py-2 text-xs text-paper-dim hover:border-flame hover:text-paper disabled:opacity-40"
        >
          {audio.isPlaying ? t("stemReview.stop") : t("stemReview.play")}
        </button>

        <span className="flex-1" />

        {measured && (
          <button
            type="button"
            disabled={busy}
            onClick={() => rule(state === "yes" ? null : true)}
            className={`type-eyebrow border px-3 py-2 text-xs disabled:opacity-40 ${
              state === "yes"
                ? "border-flame bg-flame text-ink"
                : "border-ink-edge text-paper-dim hover:border-flame hover:text-paper"
            }`}
          >
            {t("stemReview.approve")}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => rule(state === "no" ? null : false)}
          className={`type-eyebrow border px-3 py-2 text-xs disabled:opacity-40 ${
            state === "no"
              ? "border-paper-faint text-paper"
              : "border-ink-edge text-paper-dim hover:border-paper-faint hover:text-paper"
          }`}
        >
          {t("stemReview.reject")}
        </button>
      </div>

      {/* The start, on the stem's own waveform. Pre-processed when the stem
          is cut — a horn that comes in after a piano pickup is found there
          rather than played over — and adjustable here, because whether a
          faint scrape is the entry or the room is not a thing a meter
          settles. */}
      <div className="mt-3">
        <Waveform
          buffer={audio.buffer}
          height={56}
          marker={shown}
          onMarkerChange={setShown}
          onCommit={(seconds) => void patch({ leadIn: seconds })}
          onAim={(at) =>
            aim(
              owner.current,
              at === null
                ? null
                : { at, play: (from) => audio.play(from, (audio.buffer?.duration ?? from) - from) },
            )
          }
          playhead={
            audio.isPlaying
              ? shown + audio.progress * ((audio.buffer?.duration ?? shown) - shown)
              : null
          }
        />
        <p className="type-data mt-1 text-xs text-paper-faint">
          {t("stemReview.startsAt", { at: shown.toFixed(2) })}
          {Math.abs(shown - leadIn) > 0.005 &&
            ` · ${t("stemReview.trimmed", { by: (shown - leadIn).toFixed(2) })}`}
        </p>
      </div>

      {audio.status === "error" && (
        <p className="type-body mt-2 text-xs text-flame">{t("stemReview.audioFailed")}</p>
      )}
      {error && <p className="type-body mt-2 text-xs text-flame">{error}</p>}
    </li>
  );
}
