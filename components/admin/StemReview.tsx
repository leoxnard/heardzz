"use client";

import { useState } from "react";
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

/** The rungs offered here: the opening the round starts on, then context. */
const AUDITION_SECONDS = [0.5, 2, 20];

export function StemReview({ solo, onSaved }: { solo: Solo; onSaved: (solo: Solo) => void }) {
  const [cut, setCut] = useState<"head" | "solo">(solo.soloClip?.stems ? "solo" : "head");

  const stems = cut === "solo" ? solo.soloClip?.stems : solo.stems;
  const leadIn = cut === "solo" ? (solo.soloClip?.leadIn ?? 0) : solo.leadIn;

  if (!solo.stems && !solo.soloClip?.stems) {
    return (
      <section className="mt-12 border-t border-ink-edge pt-8">
        <h3 className="type-eyebrow text-flame">{t("stemReview.title")}</h3>
        <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
          {t("stemReview.notSplit")}
        </p>
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
        {AUDITION_SECONDS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            disabled={audio.status !== "ready"}
            onClick={() => audio.play(leadIn, seconds)}
            className="type-data border border-ink-edge px-3 py-2 text-xs text-paper-dim hover:border-flame hover:text-paper disabled:opacity-40"
          >
            {seconds} s
          </button>
        ))}
        {audio.isPlaying && (
          <button
            type="button"
            onClick={audio.stop}
            className="type-data border border-ink-edge px-3 py-2 text-xs text-paper-dim hover:text-paper"
          >
            {t("stemReview.stop")}
          </button>
        )}

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
