"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrackMarker, type TrackMark, type View } from "./TrackMarker";
import { useSoloAudio } from "@/lib/audio";
import { t } from "@/lib/i18n";
import type { Credit, MarkedSolo, Solo } from "@/lib/types";
import type { SourceResult } from "@/app/api/admin/source/route";

/* ------------------------------------------------------------------
   Marking a record up.

   One screen, one recording, one pass. The tune is fetched whole and stays
   whole while it is being worked on: the top of the tune is already marked
   when it opens, every solo is a marker you drop where you hear it, and
   nothing is cut until you say so. What leaves this screen is a set of
   clips; what is left behind is nothing at all.

   The keyboard does the work. Space plays the marker you are on, the arrows
   nudge it, and adding a solo is one button — because the slow part of this
   job was never the typing.
   ------------------------------------------------------------------ */

/** What space plays. Long enough to know, short enough to repeat. */
const PREVIEW = 6;
const PREVIEW_LENGTHS = [2, 6, 15];

const START_ID = "start";

interface Seed {
  target?: string;
  youtubeId?: string;
  artist?: string;
  song?: string;
  album?: string;
  year?: number;
  note?: string;
  personnel?: Credit[];
  discogsReleaseId?: number;
  /** Fetch the moment the screen opens, rather than waiting for a click. */
  autoFetch?: boolean;
}

interface SourceWorkbenchProps {
  seed?: Seed;
  /** Entries this replaces, when an existing record is being re-marked. */
  existing?: Solo[];
  onSaved: (solos: Solo[], removed: string[]) => void;
  onCancel?: () => void;
  /** "2 still to mark", when working through a playlist. */
  queueNote?: string;
  saveLabel?: string;
}

interface Draft {
  artist: string;
  song: string;
  album: string;
  year: number;
  note: string;
  personnel: Credit[];
  discogsReleaseId?: number;
}

interface Mark {
  /** Local while a mark is new; the entry's id once it stands for one. */
  key: string;
  id?: string;
  at: number;
  soloist: string;
  note: string;
}

function timecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

export function SourceWorkbench({
  seed, existing, onSaved, onCancel, queueNote, saveLabel,
}: SourceWorkbenchProps) {
  const [target, setTarget] = useState(seed?.target ?? seed?.youtubeId ?? "");
  const [discogs, setDiscogs] = useState("");
  const [source, setSource] = useState<SourceResult | null>(null);
  const [busy, setBusy] = useState<null | "fetching" | "saving">(null);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<Draft>({
    artist: seed?.artist ?? "",
    song: seed?.song ?? "",
    album: seed?.album ?? "",
    year: seed?.year ?? 0,
    note: seed?.note ?? "",
    personnel: seed?.personnel ?? [],
    discogsReleaseId: seed?.discogsReleaseId,
  });

  const [start, setStart] = useState(0);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [activeId, setActiveId] = useState<string>(START_ID);
  const [view, setView] = useState<View>({ start: 0, length: 30 });
  const [playedFrom, setPlayedFrom] = useState<number | null>(null);
  const [playedLength, setPlayedLength] = useState(0);

  const audio = useSoloAudio(source?.previewUrl ?? null, 0.9);

  const playhead = useMemo(() => {
    if (!audio.isPlaying || playedFrom === null) return null;
    return playedFrom + audio.progress * playedLength;
  }, [audio.isPlaying, audio.progress, playedFrom, playedLength]);

  const duration = source?.duration ?? 0;

  /* ---------------- fetching ---------------- */

  const fetchSource = useCallback(
    async (link: string, discogsLink?: string) => {
      if (!link.trim()) return;
      setBusy("fetching");
      setError(null);
      try {
        const response = await fetch("/api/admin/source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: link.trim(), discogs: discogsLink?.trim() || undefined }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not fetch that recording");

        const held = data as SourceResult;
        setSource(held);
        setDraft((current) => ({
          artist: current.artist || held.artist,
          song: current.song || held.song,
          album: current.album || held.album,
          year: current.year || held.year,
          note: current.note,
          personnel: current.personnel.length ? current.personnel : held.personnel,
          discogsReleaseId: current.discogsReleaseId ?? held.discogsReleaseId,
        }));

        // Existing entries come back as marks, so re-marking a record starts
        // from where it already is rather than from nothing.
        const known = existing ?? [];
        const opening = known[0]?.soloStart ?? held.audibleStart;
        setStart(opening);
        setMarks(
          known
            .filter((solo) => solo.soloAt !== undefined)
            .map((solo) => ({
              key: solo.id,
              id: solo.id,
              at: solo.soloAt as number,
              soloist: solo.soloist,
              note: solo.note ?? "",
            })),
        );
        setActiveId(START_ID);
        setView({
          start: Math.max(0, opening - 4),
          length: Math.min(30, held.duration || 30),
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not fetch that recording");
      } finally {
        setBusy(null);
      }
    },
    [existing],
  );

  const started = useRef(false);
  useEffect(() => {
    if (started.current || !seed?.autoFetch) return;
    started.current = true;
    void fetchSource(seed.target ?? seed.youtubeId ?? "");
  }, [seed, fetchSource]);

  /* ---------------- marks ---------------- */

  const trackMarks: TrackMark[] = useMemo(
    () => [
      { id: START_ID, at: start, kind: "start" as const, label: t("mark.start") },
      ...marks.map((mark) => ({
        id: mark.key,
        at: mark.at,
        kind: "solo" as const,
        label: mark.soloist || t("mark.unnamed"),
      })),
    ],
    [start, marks],
  );

  const activeAt = trackMarks.find((mark) => mark.id === activeId)?.at ?? start;

  const moveMark = useCallback((id: string, at: number) => {
    if (id === START_ID) setStart(at);
    else setMarks((current) => current.map((mark) => (mark.key === id ? { ...mark, at } : mark)));
  }, []);

  const nudge = useCallback(
    (delta: number) => {
      moveMark(activeId, Number(Math.max(0, Math.min(duration, activeAt + delta)).toFixed(3)));
    },
    [activeAt, activeId, duration, moveMark],
  );

  const play = useCallback(
    (seconds: number, from = activeAt) => {
      setPlayedFrom(from);
      setPlayedLength(seconds);
      audio.play(from, seconds);
    },
    [activeAt, audio],
  );

  function addSolo() {
    const at = playhead ?? view.start + view.length / 2;
    const key = `m${Date.now()}`;
    setMarks((current) =>
      [...current, { key, at: Number(at.toFixed(3)), soloist: "", note: "" }]
        .sort((a, b) => a.at - b.at),
    );
    setActiveId(key);
  }

  /* Space plays, the arrows nudge — unless you are typing, when they do the
     obvious thing instead. */
  useEffect(() => {
    if (!source) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        if (audio.isPlaying) audio.stop();
        else play(PREVIEW);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 0.1;
        nudge(event.key === "ArrowLeft" ? -step : step);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [source, audio, play, nudge]);

  /* ---------------- saving ---------------- */

  async function save() {
    if (!source) return;
    setBusy("saving");
    setError(null);
    try {
      const solos: MarkedSolo[] = marks
        .slice()
        .sort((a, b) => a.at - b.at)
        .map((mark) => ({
          id: mark.id,
          at: mark.at,
          soloist: mark.soloist.trim() || draft.artist.trim(),
          note: mark.note.trim() || undefined,
        }));

      const response = await fetch("/api/admin/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeId: source.youtubeId,
          artist: draft.artist,
          song: draft.song,
          album: draft.album,
          year: draft.year,
          note: draft.note || undefined,
          personnel: draft.personnel,
          discogsReleaseId: draft.discogsReleaseId,
          start,
          solos,
          replaces: (existing ?? []).map((solo) => solo.id),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not cut the clips");
      audio.stop();
      onSaved(data.solos as Solo[], (data.removed as string[]) ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cut the clips");
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    audio.stop();
    if (source) {
      await fetch(`/api/admin/source?id=${encodeURIComponent(source.youtubeId)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
    onCancel?.();
  }

  /* ---------------- the screen ---------------- */

  // A seeded record fetches itself; showing the paste form while that runs
  // offers a decision nobody is being asked to make.
  if (!source && seed?.autoFetch && (busy === "fetching" || !error)) {
    return (
      <div className="max-w-2xl">
        <h3 className="type-eyebrow text-flame">{t("mark.fetching")}</h3>
        <p className="type-body mt-3 text-sm leading-relaxed text-paper-dim">
          {t("mark.fetchingHelp")}
        </p>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="type-eyebrow mt-6 text-paper-faint transition-colors hover:text-flame"
          >
            {t("mark.cancel")}
          </button>
        )}
      </div>
    );
  }

  if (!source) {
    return (
      <div className="max-w-2xl">
        <h3 className="type-eyebrow text-flame">{t("mark.add")}</h3>
        <p className="type-body mt-3 text-sm leading-relaxed text-paper-dim">
          {t("mark.addHelp")}
        </p>

        <form
          className="mt-6"
          onSubmit={(event) => {
            event.preventDefault();
            void fetchSource(target, discogs);
          }}
        >
          <input
            type="text"
            value={target}
            autoFocus
            onChange={(event) => setTarget(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            className="type-body w-full border border-ink-edge bg-ink-raised px-4 py-4 text-sm text-paper focus:border-flame focus:outline-none"
          />
          <input
            type="text"
            value={discogs}
            onChange={(event) => setDiscogs(event.target.value)}
            placeholder="https://www.discogs.com/release/… (optional)"
            className="type-body mt-3 w-full border border-ink-edge bg-ink-raised px-4 py-3 text-sm text-paper-dim focus:border-flame focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy !== null || !target.trim()}
            className="type-eyebrow mt-4 w-full bg-flame px-5 py-4 text-ink transition-colors hover:bg-paper disabled:opacity-40"
          >
            {busy === "fetching" ? t("mark.fetching") : t("mark.fetch")}
          </button>
        </form>

        {busy === "fetching" && (
          <p className="type-body mt-3 text-xs text-paper-faint">{t("mark.fetchingHelp")}</p>
        )}
        {error && <p className="type-body mt-4 text-sm text-flame">{error}</p>}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="type-eyebrow mt-6 text-paper-faint transition-colors hover:text-flame"
          >
            {t("mark.cancel")}
          </button>
        )}
      </div>
    );
  }

  const names = [
    ...new Set([draft.artist, ...draft.personnel.map((credit) => credit.name)].filter(Boolean)),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="type-data text-xs text-paper-faint">{source.sourceTitle}</span>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={draft.artist}
              onChange={(event) => setDraft({ ...draft, artist: event.target.value })}
              placeholder="Artist"
              className="type-display border-b border-ink-edge bg-transparent pb-1 text-2xl text-paper focus:border-flame focus:outline-none"
            />
            <input
              type="text"
              value={draft.song}
              onChange={(event) => setDraft({ ...draft, song: event.target.value })}
              placeholder="Song"
              className="type-display border-b border-ink-edge bg-transparent pb-1 text-2xl text-paper focus:border-flame focus:outline-none"
            />
          </div>
        </div>
        {queueNote && <span className="type-data text-xs text-paper-faint">{queueNote}</span>}
      </div>

      <div className="mt-8">
        <TrackMarker
          buffer={audio.buffer}
          duration={duration}
          marks={trackMarks}
          activeId={activeId}
          onActivate={setActiveId}
          onMove={moveMark}
          playhead={playhead}
          view={view}
          onView={setView}
          loading={audio.status === "loading"}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="type-eyebrow text-paper-faint">{t("mark.preview")}</span>
        {PREVIEW_LENGTHS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            onClick={() => play(seconds)}
            disabled={audio.status !== "ready"}
            className={`type-data border px-4 py-2 text-sm transition-colors disabled:opacity-30 ${
              seconds === PREVIEW
                ? "border-flame text-flame"
                : "border-ink-edge text-paper hover:border-flame hover:text-flame"
            }`}
          >
            {seconds}s
          </button>
        ))}
        {audio.isPlaying && (
          <button type="button" onClick={audio.stop} className="type-eyebrow px-3 py-2 text-flame">
            {t("library.stop")}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {[-1, -0.1, 0.1, 1].map((delta) => (
            <button
              key={delta}
              type="button"
              onClick={() => nudge(delta)}
              className="type-data border border-ink-edge px-3 py-1 text-xs text-paper-dim transition-colors hover:border-flame hover:text-flame"
            >
              {delta > 0 ? `+${delta}` : delta}s
            </button>
          ))}
        </div>
      </div>

      <p className="type-body mt-3 text-xs leading-relaxed text-paper-faint">{t("mark.keys")}</p>

      {/* One row per position. The dot is the same colour as the dot on the
          waveform, which is what ties a name to a point on the record. */}
      <ul className="mt-8 divide-y divide-ink-edge border-y border-ink-edge">
        <li>
          <Row
            active={activeId === START_ID}
            onSelect={() => setActiveId(START_ID)}
            dot="bg-paper"
            title={t("mark.start")}
            at={start}
            onPlay={() => play(PREVIEW, start)}
          >
            <p className="type-body text-xs leading-relaxed text-paper-faint">
              {t("mark.startHelp")}
            </p>
          </Row>
        </li>

        {marks.map((mark) => (
          <li key={mark.key}>
            <Row
              active={activeId === mark.key}
              onSelect={() => setActiveId(mark.key)}
              dot="bg-flame"
              title={mark.soloist || t("mark.unnamed")}
              at={mark.at}
              onPlay={() => play(PREVIEW, mark.at)}
              onRemove={() => {
                setMarks((current) => current.filter((entry) => entry.key !== mark.key));
                if (activeId === mark.key) setActiveId(START_ID);
              }}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="type-eyebrow text-paper-faint">{t("mark.soloist")}</span>
                  <input
                    type="text"
                    list="workbench-personnel"
                    value={mark.soloist}
                    onChange={(event) =>
                      setMarks((current) =>
                        current.map((entry) =>
                          entry.key === mark.key
                            ? { ...entry, soloist: event.target.value }
                            : entry,
                        ),
                      )
                    }
                    placeholder={draft.artist || "who is playing"}
                    className="type-body mt-1 w-full border border-ink-edge bg-ink-raised px-3 py-2 text-sm text-paper focus:border-flame focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="type-eyebrow text-paper-faint">{t("mark.note")}</span>
                  <input
                    type="text"
                    value={mark.note}
                    onChange={(event) =>
                      setMarks((current) =>
                        current.map((entry) =>
                          entry.key === mark.key ? { ...entry, note: event.target.value } : entry,
                        ),
                      )
                    }
                    className="type-body mt-1 w-full border border-ink-edge bg-ink-raised px-3 py-2 text-sm text-paper-dim focus:border-flame focus:outline-none"
                  />
                </label>
              </div>
            </Row>
          </li>
        ))}
      </ul>

      <datalist id="workbench-personnel">
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <button
        type="button"
        onClick={addSolo}
        className="type-eyebrow mt-4 w-full border border-ink-edge py-3 text-paper-dim transition-colors hover:border-flame hover:text-flame"
      >
        {t("mark.addSolo")}
      </button>

      <details className="mt-8 border-t border-ink-edge pt-6">
        <summary className="type-eyebrow cursor-pointer text-paper-dim">
          {t("mark.details", { n: draft.personnel.length })}
        </summary>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Album" value={draft.album} onChange={(v) => setDraft({ ...draft, album: v })} />
          <Field
            label="Year"
            value={draft.year ? String(draft.year) : ""}
            onChange={(v) => setDraft({ ...draft, year: Number(v) || 0 })}
          />
        </div>
        <div className="mt-4">
          <Field
            label="Note shown on reveal"
            value={draft.note}
            onChange={(v) => setDraft({ ...draft, note: v })}
          />
        </div>

        {draft.personnel.length > 0 && (
          <ul className="mt-5 space-y-1">
            {draft.personnel.map((credit, i) => (
              <li key={`${credit.name}-${i}`} className="flex flex-wrap gap-x-3 text-sm">
                <span className="type-body text-paper">{credit.name}</span>
                <span className="type-body text-paper-faint">{credit.role}</span>
              </li>
            ))}
          </ul>
        )}

        {source.notes.length > 0 && (
          <ul className="mt-5 space-y-2 border-l-2 border-ink-edge pl-4">
            {source.notes.map((line) => (
              <li key={line} className="type-body text-xs leading-relaxed text-paper-faint">
                {line}
              </li>
            ))}
          </ul>
        )}
      </details>

      {error && <p className="type-body mt-6 text-sm text-flame">{error}</p>}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy !== null || !draft.artist.trim() || !draft.song.trim()}
          className="type-eyebrow bg-flame px-6 py-4 text-ink transition-colors hover:bg-paper disabled:opacity-40"
        >
          {busy === "saving" ? t("mark.saving") : saveLabel ?? t("mark.save")}
        </button>
        <span className="type-body text-xs text-paper-faint">
          {t("mark.saveHelp", { n: marks.length || 1 })}
        </span>
        <button
          type="button"
          onClick={discard}
          disabled={busy !== null}
          className="type-eyebrow ml-auto border border-ink-edge px-5 py-4 text-paper-faint transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
        >
          {t("mark.discard")}
        </button>
      </div>
    </div>
  );
}

function Row({
  active, onSelect, dot, title, at, onPlay, onRemove, children,
}: {
  active: boolean;
  onSelect: () => void;
  dot: string;
  title: string;
  at: number;
  onPlay: () => void;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onPointerDown={onSelect}
      className={`px-4 py-4 transition-colors ${active ? "bg-ink-raised" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className={`block h-3 w-3 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
        <span className="type-body min-w-0 flex-1 truncate text-sm text-paper">{title}</span>
        <span className="type-data text-sm text-paper-dim">{timecode(at)}</span>
        <button
          type="button"
          onClick={onPlay}
          className="type-eyebrow border border-ink-edge px-3 py-1 text-paper-dim transition-colors hover:border-flame hover:text-flame"
        >
          ▶ 6s
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove this position"
            className="type-data px-2 text-paper-faint transition-colors hover:text-flame"
          >
            ×
          </button>
        )}
      </div>
      <div className="mt-3 pl-6">{children}</div>
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
