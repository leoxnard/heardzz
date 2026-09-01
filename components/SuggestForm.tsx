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

interface Batch {
  entries: Draft[];
  skipped: number;
  truncated: boolean;
}

const KNOWN_ERRORS = new Set([
  "badLink", "alreadyHere", "alreadyPending", "nothingFound",
  "badPlaylist", "playlistAllKnown",
]);

export function SuggestForm() {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  // A playlist comes back as many drafts, each with a tick beside it.
  const [batch, setBatch] = useState<Batch | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sentCount, setSentCount] = useState(0);
  const [busy, setBusy] = useState<null | "looking" | "sending">(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Ticked and with both fields filled — the server would turn the rest away.
  const readyCount = batch
    ? batch.entries.filter((e) => picked.has(e.youtubeId) && e.artist.trim() && e.song.trim()).length
    : 0;

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
      if (data.playlist) {
        const entries = data.entries as Draft[];
        setBatch({ entries, skipped: data.skipped ?? 0, truncated: Boolean(data.truncated) });
        // Everything that came back with both fields filled starts ticked;
        // the ones the title could not be read from do not.
        setPicked(new Set(entries.filter((e) => e.artist && e.song).map((e) => e.youtubeId)));
        setDraft(null);
      } else {
        setDraft(data as Draft);
        setBatch(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lookup failed");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const chosen = batch
      ? batch.entries.filter(
          (entry) => picked.has(entry.youtubeId) && entry.artist.trim() && entry.song.trim(),
        )
      : draft
        ? [draft]
        : [];
    if (!chosen.length) return;

    setBusy("sending");
    setError(null);
    try {
      const response = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch ? { items: chosen, note } : { ...chosen[0], note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(explain(data.error ?? "Could not send"));
      setSentCount(batch ? Number(data.accepted) || chosen.length : 0);
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send");
    } finally {
      setBusy(null);
    }
  }

  /** Edit one line of a playlist in place. */
  function entryField(youtubeId: string, key: keyof Draft, value: Draft[keyof Draft]) {
    setBatch((current) =>
      current
        ? {
            ...current,
            entries: current.entries.map((entry) =>
              entry.youtubeId === youtubeId ? { ...entry, [key]: value } : entry,
            ),
          }
        : current,
    );
  }

  function toggle(youtubeId: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(youtubeId)) next.add(youtubeId);
      return next;
    });
  }

  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function reset() {
    setUrl("");
    setNote("");
    setDraft(null);
    setBatch(null);
    setPicked(new Set());
    setSentCount(0);
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
            {sentCount ? t("suggest.playlistSent", { n: sentCount }) : t("suggest.thanks")}
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
                placeholder="https://www.youtube.com/watch?v=… or /playlist?list=…"
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

          {batch && (
            <section className="mt-12 border-t border-ink-edge pt-8">
              <h2 className="type-eyebrow text-flame">
                {t("suggest.playlistFound", { n: batch.entries.length })}
              </h2>
              <p className="type-body mt-2 text-sm text-paper-dim">{t("suggest.playlistPick")}</p>
              {batch.skipped > 0 && (
                <p className="type-body mt-1 text-sm text-paper-faint">
                  {t("suggest.playlistSkipped", { n: batch.skipped })}
                </p>
              )}
              {batch.truncated && (
                <p className="type-body mt-1 text-sm text-paper-faint">
                  {t("suggest.playlistTruncated", { n: batch.entries.length + batch.skipped })}
                </p>
              )}

              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setPicked(new Set(batch.entries.map((e) => e.youtubeId)))}
                  className="type-eyebrow border border-paper-faint px-3 py-2 text-xs text-paper transition-colors hover:border-flame hover:text-flame"
                >
                  {t("suggest.playlistSelectAll")}
                </button>
                <button
                  type="button"
                  onClick={() => setPicked(new Set())}
                  className="type-eyebrow border border-paper-faint px-3 py-2 text-xs text-paper transition-colors hover:border-flame hover:text-flame"
                >
                  {t("suggest.playlistSelectNone")}
                </button>
              </div>

              <ul className="mt-6 space-y-5">
                {batch.entries.map((entry) => (
                  <li
                    key={entry.youtubeId}
                    className={`border-l-2 pl-4 ${
                      picked.has(entry.youtubeId) ? "border-flame" : "border-ink-edge opacity-50"
                    }`}
                  >
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={picked.has(entry.youtubeId)}
                        onChange={() => toggle(entry.youtubeId)}
                        className="mt-1 accent-flame"
                      />
                      <span className="type-data text-xs text-paper-faint">{entry.sourceTitle}</span>
                    </label>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field
                        label="Artist"
                        value={entry.artist}
                        onChange={(v) => entryField(entry.youtubeId, "artist", v)}
                      />
                      <Field
                        label="Song"
                        value={entry.song}
                        onChange={(v) => entryField(entry.youtubeId, "song", v)}
                      />
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                <Field label={t("suggest.note")} value={note} onChange={setNote} />
              </div>

              <button
                type="button"
                onClick={send}
                disabled={busy !== null || !readyCount}
                className="type-eyebrow mt-8 w-full bg-flame px-5 py-4 text-ink transition-colors hover:bg-paper disabled:opacity-40"
              >
                {busy === "sending"
                  ? t("suggest.submitting")
                  : readyCount
                    ? t("suggest.playlistSubmit", { n: readyCount })
                    : t("suggest.playlistNothingPicked")}
              </button>
            </section>
          )}

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
