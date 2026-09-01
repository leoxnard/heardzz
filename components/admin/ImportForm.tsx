"use client";

import { useState } from "react";
import { t } from "@/lib/i18n";
import type { Credit, Solo } from "@/lib/types";

/* ------------------------------------------------------------------
   Adding a record.

   One field to begin with. Paste a link, and the artist, title, album,
   year and the band on the date are filled in before you are asked for
   anything else. Everything found stays editable, and a Discogs link can
   be handed over when the automatic match picks the wrong pressing.
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
  notes: string[];
}

export function ImportForm({ onImported }: { onImported: (solo: Solo) => void }) {
  const [target, setTarget] = useState("");
  const [discogs, setDiscogs] = useState("");
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<null | "looking" | "adding">(null);
  const [error, setError] = useState<string | null>(null);

  async function look(event?: React.FormEvent) {
    event?.preventDefault();
    if (!target.trim()) return;

    setBusy("looking");
    setError(null);
    try {
      const response = await fetch("/api/admin/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), discogs: discogs.trim() || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Lookup failed");
      setDraft(data as Draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lookup failed");
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    if (!draft) return;
    setBusy("adding");
    setError(null);
    try {
      const response = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: `https://www.youtube.com/watch?v=${draft.youtubeId}`,
          artist: draft.artist,
          song: draft.song,
          album: draft.album,
          year: draft.year,
          personnel: draft.personnel,
          discogsReleaseId: draft.discogsReleaseId,
          note: note.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Import failed");
      onImported(data.solo as Solo);
      setTarget("");
      setDiscogs("");
      setNote("");
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <div>
      <h3 className="type-eyebrow text-flame">{t("library.add")}</h3>

      <form onSubmit={look} className="mt-4">
        <Field
          label={t("library.search")}
          value={target}
          onChange={setTarget}
          placeholder="https://www.youtube.com/watch?v=…"
          required
        />

        <div className="mt-4">
          <Field
            label={t("library.discogsLink")}
            value={discogs}
            onChange={setDiscogs}
            placeholder="https://www.discogs.com/release/… (optional)"
          />
          <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
            {t("library.discogsHelp")}
          </p>
        </div>

        <button
          type="submit"
          disabled={busy !== null || !target.trim()}
          className="type-eyebrow mt-5 w-full border border-paper-faint px-5 py-4 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
        >
          {busy === "looking" ? t("library.lookingUp") : t("library.lookUp")}
        </button>
      </form>

      {error && <p className="type-body mt-4 text-sm text-flame">{error}</p>}

      {draft && (
        <section className="mt-10 border-t border-ink-edge pt-8">
          <h4 className="type-eyebrow text-flame">{t("library.found")}</h4>

          <p className="type-data mt-2 text-xs text-paper-faint">
            {draft.sourceTitle} · {Math.floor(draft.sourceDuration / 60)}:
            {String(Math.floor(draft.sourceDuration % 60)).padStart(2, "0")}
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Artist" value={draft.artist} onChange={(v) => field("artist", v)} required />
            <Field label="Song" value={draft.song} onChange={(v) => field("song", v)} required />
            <Field label="Album" value={draft.album} onChange={(v) => field("album", v)} />
            <Field
              label="Year"
              value={draft.year ? String(draft.year) : ""}
              onChange={(v) => field("year", Number(v) || 0)}
            />
          </div>

          <div className="mt-4">
            <Field label="Note shown on reveal" value={note} onChange={setNote} />
          </div>

          <div className="mt-6">
            <span className="type-eyebrow text-paper-faint">
              {t("library.personnelCount", { n: draft.personnel.length })}
            </span>
            {draft.personnel.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {draft.personnel.map((credit) => (
                  <li key={credit.name} className="flex flex-wrap gap-x-3 text-sm">
                    <span className="type-body text-paper">{credit.name}</span>
                    <span className="type-body text-paper-faint">{credit.role}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="type-body mt-2 text-sm text-paper-faint">
                {t("library.noPersonnel")}
              </p>
            )}
          </div>

          {draft.notes.length > 0 && (
            <ul className="mt-6 space-y-2 border-l-2 border-ink-edge pl-4">
              {draft.notes.map((line) => (
                <li key={line} className="type-body text-xs leading-relaxed text-paper-faint">
                  {line}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={add}
            disabled={busy !== null || !draft.artist.trim() || !draft.song.trim()}
            className="type-eyebrow mt-8 w-full bg-flame px-5 py-4 text-ink transition-colors hover:bg-paper disabled:opacity-40"
          >
            {busy === "adding" ? t("library.importing") : t("library.add")}
          </button>

          {busy === "adding" && (
            <p className="type-body mt-3 text-xs text-paper-faint">{t("library.importingHelp")}</p>
          )}
        </section>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="type-eyebrow text-paper-faint">{label}</span>
      <input
        type="text"
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="type-body mt-2 w-full border border-ink-edge bg-ink-raised px-3 py-3 text-sm text-paper focus:border-flame focus:outline-none"
      />
    </label>
  );
}
