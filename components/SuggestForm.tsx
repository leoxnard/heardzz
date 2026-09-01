"use client";

import { useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Credit } from "@/lib/types";

/* ------------------------------------------------------------------
   Putting a record forward.

   The same one-field flow as the library screen, with the expensive half
   left out: this reads the link and asks Discogs, but downloads nothing.
   The audio is only fetched once somebody confirms the suggestion.
   ------------------------------------------------------------------ */

interface Draft {
  youtubeId: string;
  sourceTitle: string;
  sourceDuration: number;
  artist: string;
  song: string;
  album: string;
  year: number;
  personnel: Credit[];
  discogsReleaseId?: number;
  partial?: boolean;
}

const KNOWN_ERRORS = new Set(["badLink", "alreadyHere", "alreadyPending", "nothingFound"]);

export function SuggestForm() {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<null | "looking" | "sending">(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function explain(message: string): string {
    return KNOWN_ERRORS.has(message)
      ? t(`suggest.${message}` as "suggest.badLink")
      : message;
  }

  async function look(event: React.FormEvent) {
    event.preventDefault();
    setBusy("looking");
    setError(null);
    try {
      const response = await fetch("/api/suggest/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(explain(data.error ?? "Lookup failed"));
      setDraft(data as Draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lookup failed");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!draft) return;
    setBusy("sending");
    setError(null);
    try {
      const response = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(explain(data.error ?? "Could not send"));
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send");
    } finally {
      setBusy(null);
    }
  }

  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function reset() {
    setUrl("");
    setNote("");
    setDraft(null);
    setSent(false);
    setError(null);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10 sm:px-10 lg:py-16">
      <Link href="/" className="flex items-center gap-3">
        <span className="block h-4 w-4 bg-flame" aria-hidden="true" />
        <span className="type-display text-xl text-paper">{t("brand")}</span>
      </Link>

      <h1 className="type-display-tight mt-8 text-[clamp(2.5rem,8vw,4.5rem)] text-paper">
        {t("suggest.title")}
      </h1>

      {sent ? (
        <>
          <p className="type-body mt-6 border-l-2 border-flame pl-4 text-paper">
            {t("suggest.thanks")}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={reset}
              className="type-eyebrow bg-flame px-5 py-4 text-ink transition-colors hover:bg-paper"
            >
              {t("suggest.another")}
            </button>
            <Link
              href="/"
              className="type-eyebrow border border-paper-faint px-5 py-4 text-paper transition-colors hover:border-flame hover:text-flame"
            >
              {t("nav.daily")}
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="type-body mt-4 max-w-xl text-sm leading-relaxed text-paper-dim">
            {t("suggest.intro")}
          </p>

          <form onSubmit={look} className="mt-8">
            <label className="block">
              <span className="type-eyebrow text-paper-faint">{t("suggest.link")}</span>
              <input
                type="text"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                className="type-body mt-2 w-full border border-ink-edge bg-ink-raised px-4 py-3 text-paper focus:border-flame focus:outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={busy !== null || !url.trim()}
              className="type-eyebrow mt-4 w-full border border-paper-faint px-5 py-4 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
            >
              {busy === "looking" ? t("suggest.lookingUp") : t("suggest.lookUp")}
            </button>
          </form>

          {error && <p className="type-body mt-4 text-sm text-flame">{error}</p>}

          {draft && (
            <section className="mt-12 border-t border-ink-edge pt-8">
              <h2 className="type-eyebrow text-flame">{t("suggest.found")}</h2>

              {draft.sourceTitle && (
                <p className="type-data mt-2 text-xs text-paper-faint">{draft.sourceTitle}</p>
              )}
              {draft.partial && (
                <p className="type-body mt-3 text-sm text-flame">{t("suggest.nothingFound")}</p>
              )}

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Artist" value={draft.artist} onChange={(v) => field("artist", v)} />
                <Field label="Song" value={draft.song} onChange={(v) => field("song", v)} />
                <Field label="Album" value={draft.album} onChange={(v) => field("album", v)} />
                <Field
                  label="Year"
                  value={draft.year ? String(draft.year) : ""}
                  onChange={(v) => field("year", Number(v) || 0)}
                />
              </div>

              <div className="mt-4">
                <Field label={t("suggest.note")} value={note} onChange={setNote} />
              </div>

              {draft.personnel.length > 0 && (
                <div className="mt-6">
                  <span className="type-eyebrow text-paper-faint">{t("result.personnel")}</span>
                  <ul className="mt-3 space-y-1">
                    {draft.personnel.map((credit) => (
                      <li key={credit.name} className="flex flex-wrap gap-x-3 text-sm">
                        <span className="type-body text-paper">{credit.name}</span>
                        <span className="type-body text-paper-faint">{credit.role}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                onClick={send}
                disabled={busy !== null || !draft.artist.trim() || !draft.song.trim()}
                className="type-eyebrow mt-8 w-full bg-flame px-5 py-4 text-ink transition-colors hover:bg-paper disabled:opacity-40"
              >
                {busy === "sending" ? t("suggest.submitting") : t("suggest.submit")}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Field({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="type-eyebrow text-paper-faint">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="type-body mt-2 w-full border border-ink-edge bg-ink-raised px-3 py-3 text-sm text-paper focus:border-flame focus:outline-none"
      />
    </label>
  );
}
