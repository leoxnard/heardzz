"use client";

import { useState } from "react";
import { t } from "@/lib/i18n";
import type { Solo, Suggestion } from "@/lib/types";

/* ------------------------------------------------------------------
   Reviewing what people have put forward.

   Confirming is the moment the server does any work: it downloads the
   source, cuts the opening and adds the record. Everything up to here has
   cost a few hundred bytes on disk.
   ------------------------------------------------------------------ */

function when(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

interface SuggestionReviewProps {
  suggestions: Suggestion[];
  onResolved: (suggestion: Suggestion, solo?: Solo) => void;
}

export function SuggestionReview({ suggestions, onResolved }: SuggestionReviewProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = suggestions.filter((s) => s.status === "pending");
  const settled = suggestions.filter((s) => s.status !== "pending").slice(-10).reverse();

  async function act(suggestion: Suggestion, action: "approve" | "reject") {
    setBusyId(suggestion.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: suggestion.id, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not do that");
      onResolved(data.suggestion as Suggestion, data.solo as Solo | undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not do that");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h2 className="type-display text-3xl text-paper">{t("review.title")}</h2>
      <p className="type-data mt-2 text-xs text-paper-faint">
        {pending.length > 0 ? t("review.pending", { n: pending.length }) : t("review.none")}
      </p>

      {error && <p className="type-body mt-4 text-sm text-flame">{error}</p>}

      <ul className="mt-8 space-y-6">
        {pending.map((suggestion) => (
          <li key={suggestion.id} className="border border-ink-edge p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="type-display text-2xl text-paper">
                {suggestion.artist} — {suggestion.song}
              </h3>
              <span className="type-data text-xs text-paper-faint">
                {t("review.submitted", { when: when(suggestion.submittedAt) })}
              </span>
            </div>

            <p className="type-body mt-1 text-sm text-paper-dim">
              {suggestion.album}
              {suggestion.year ? `, ${suggestion.year}` : ""}
            </p>

            {suggestion.sourceTitle && (
              <p className="type-data mt-2 text-xs text-paper-faint">{suggestion.sourceTitle}</p>
            )}

            {suggestion.note && (
              <p className="type-body mt-3 border-l-2 border-flame pl-3 text-sm text-paper-dim">
                {suggestion.note}
              </p>
            )}

            {suggestion.personnel.length > 0 && (
              <ul className="mt-4 space-y-1">
                {suggestion.personnel.map((credit) => (
                  <li key={credit.name} className="flex flex-wrap gap-x-3 text-sm">
                    <span className="type-body text-paper">{credit.name}</span>
                    <span className="type-body text-paper-faint">{credit.role}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => act(suggestion, "approve")}
                disabled={busyId !== null}
                className="type-eyebrow bg-flame px-5 py-3 text-ink transition-colors hover:bg-paper disabled:opacity-40"
              >
                {busyId === suggestion.id ? t("review.approving") : t("review.approve")}
              </button>
              <a
                href={`https://www.youtube.com/watch?v=${suggestion.youtubeId}`}
                target="_blank"
                rel="noreferrer"
                className="type-eyebrow border border-ink-edge px-5 py-3 text-paper-dim transition-colors hover:border-paper-faint hover:text-paper"
              >
                {t("review.openVideo")}
              </a>
              <button
                type="button"
                onClick={() => act(suggestion, "reject")}
                disabled={busyId !== null}
                className="type-eyebrow ml-auto border border-ink-edge px-5 py-3 text-paper-faint transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
              >
                {t("review.reject")}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {settled.length > 0 && (
        <ul className="mt-12 border-t border-ink-edge pt-6">
          {settled.map((suggestion) => (
            <li
              key={suggestion.id}
              className="flex flex-wrap items-baseline gap-x-3 border-b border-ink-edge py-3"
            >
              <span className="type-body text-sm text-paper-dim">
                {suggestion.artist} — {suggestion.song}
              </span>
              <span className="type-eyebrow ml-auto text-paper-faint">
                {suggestion.status === "approved" ? t("review.approved") : t("review.rejected")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
