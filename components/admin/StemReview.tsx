"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSoloAudio } from "@/lib/audio";
import { STEMS } from "@/lib/config";
import { t } from "@/lib/i18n";
import type { Solo, StemId, StemVariant } from "@/lib/types";

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
  solo, onSaved, resplit = 0,
}: {
  solo: Solo;
  onSaved: (solo: Solo) => void;
  /**
   * Bumped by the editor when a save invalidated the stems. A count rather
   * than a flag so two saves in a row each start a split, and so this reads
   * as an event rather than as a state that has to be cleared again.
   */
  resplit?: number;
}) {
  const [cut, setCut] = useState<"head" | "solo">(solo.soloClip?.stems ? "solo" : "head");

  const stems = cut === "solo" ? solo.soloClip?.stems : solo.stems;
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
  if (!solo.stems && !solo.soloClip?.stems) {
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

      {solo.soloClip?.stems && solo.stems && (
        <div className="mt-4 flex gap-2">
          {(["head", "solo"] as const).map((which) => (
            <button
              key={which}
              type="button"
              onClick={() => setCut(which)}
              aria-pressed={cut === which}
              className={`type-eyebrow border px-3 py-2 text-xs ${
                cut === which
                  ? "border-flame bg-flame text-ink"
                  : "border-ink-edge text-paper-dim hover:text-paper"
              }`}
            >
              {t(which === "head" ? "stemReview.headCut" : "stemReview.soloCut")}
            </button>
          ))}
        </div>
      )}

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
    </section>
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
function useSplit(id: string, onSaved: (solo: Solo) => void) {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (force: boolean) => {
      setRunning(true);
      setError(null);
      try {
        // Bounded rather than `while (true)`: a route that kept answering
        // "one more" would otherwise spin here for as long as the tab is
        // open. Four is both cuts twice over.
        for (let pass = 0; pass < 4; pass += 1) {
          const response = await fetch("/api/admin/split", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Only the first pass forces: after that the cuts it has already
            // done are the work, and forcing again would redo them forever.
            body: JSON.stringify({ id, force: force && pass === 0 }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Could not split it");
          if (data.solo) onSaved(data.solo as Solo);
          setStep(data.split ?? null);
          if (data.done) break;
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

function SplitButton({
  split, label, force = false,
}: {
  split: ReturnType<typeof useSplit>;
  label: string;
  force?: boolean;
}) {
  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={split.running}
        onClick={() => split.run(force)}
        className="type-eyebrow border border-ink-edge px-4 py-2 text-xs text-paper-dim transition-colors hover:border-flame hover:text-paper disabled:opacity-40"
      >
        {split.running ? t("stemReview.splitting") : label}
      </button>
      {split.running && (
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
  onSaved: (solo: Solo) => void;
}) {
  const audio = useSoloAudio(variant.audio, 0.9);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = STEMS.find((stem) => stem.id === id)?.label ?? id;

  async function rule(approved: boolean | null) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/stems", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: soloId, cut, stem: id, approved }),
      });
      if (!response.ok) throw new Error(await response.text());
      onSaved((await response.json()) as Solo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

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
              : audio.play(leadIn, (audio.buffer?.duration ?? leadIn) - leadIn)
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

      {audio.status === "error" && (
        <p className="type-body mt-2 text-xs text-flame">{t("stemReview.audioFailed")}</p>
      )}
      {error && <p className="type-body mt-2 text-xs text-flame">{error}</p>}
    </li>
  );
}
