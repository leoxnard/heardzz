"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LibraryList } from "./LibraryList";
import { ReportsReview } from "./ReportsReview";
import { SoloEditor } from "./SoloEditor";
import { SourceWorkbench } from "./SourceWorkbench";
import { SuggestionReview } from "./SuggestionReview";
import { t } from "@/lib/i18n";
import type { Report, Solo, Suggestion } from "@/lib/types";
import type { SourceResult } from "@/app/api/admin/source/route";

/* ------------------------------------------------------------------
   The library screen.

   Everything that puts a record in the library now goes through one place:
   the marking screen. A pasted link, a playlist worked through track by
   track, a suggestion somebody sent in, or a record already here that wants
   its positions redone — all of them open the same tool, prefilled with
   whatever is already known.
   ------------------------------------------------------------------ */

interface PlaylistEntry {
  youtubeId: string;
  title: string;
  duration: number;
  uploader: string;
  /** Present only on a queue seeded from TIDAL. */
  isrc?: string;
  tidalArtistId?: string;
  /** TIDAL's names for the record, which outrank the upload's own tags. */
  artist?: string;
  song?: string;
}

/** How one entry of an automatically fetched playlist ended up. */
interface AutoResult {
  youtubeId: string;
  title: string;
  status: "waiting" | "working" | "added" | "duplicate" | "skipped" | "failed";
  detail?: string;
}

type Job =
  /** A link, pasted by hand. */
  | { kind: "single" }
  /** A playlist, one record at a time. */
  | { kind: "queue"; entries: PlaylistEntry[]; index: number; known: number }
  /** A playlist being fetched without anybody marking it up. */
  | { kind: "auto"; entries: PlaylistEntry[]; known: number }
  /** Somebody's suggestion, marked up before it is accepted. */
  | { kind: "suggestion"; suggestion: Suggestion }
  /** A record already in the library, being marked again. */
  | { kind: "remark"; solos: Solo[] };

export function LibraryAdmin({
  initial,
  suggestions: initialSuggestions,
  reports: initialReports,
  missingAudio,
}: {
  initial: Solo[];
  suggestions: Suggestion[];
  reports: Report[];
  missingAudio: number;
}) {
  const router = useRouter();
  const [solos, setSolos] = useState(initial);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [reports, setReports] = useState(initialReports);
  const [tab, setTab] = useState<"library" | "suggestions" | "reports">(
    initialSuggestions.some((s) => s.status === "pending") ? "suggestions" : "library",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(initial.length === 0 ? { kind: "single" } : null);

  const [playlistTarget, setPlaylistTarget] = useState("");
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  /** Ticked: fetch the whole playlist unattended and verify it afterwards. */
  const [playlistAuto, setPlaylistAuto] = useState(false);
  const [tidalTarget, setTidalTarget] = useState("");
  const [tidalBusy, setTidalBusy] = useState(false);
  const [tidalError, setTidalError] = useState<string | null>(null);
  /** Tunes TIDAL listed that no YouTube upload could be confirmed against. */
  const [tidalMisses, setTidalMisses] = useState(0);

  const [autoResults, setAutoResults] = useState<AutoResult[]>([]);
  const [autoRunning, setAutoRunning] = useState(false);
  const autoStopped = useRef(false);

  /*
   * Recordings fetched ahead of their turn.
   *
   * The queue used to download the next tune only once the previous one was
   * saved, so every record in a playlist began with the same wait. There is
   * nothing to wait for: the marking of one record and the download of the
   * next have no reason to happen in sequence.
   */
  const [preloaded, setPreloaded] = useState<Record<string, SourceResult>>({});
  const preloading = useRef<Set<string>>(new Set());
  const [preloadingIds, setPreloadingIds] = useState<string[]>([]);

  const unverified = solos.filter((solo) => !solo.verified).length;
  const waiting = suggestions.filter((s) => s.status === "pending").length;
  const openReports = reports.filter((r) => r.status === "open").length;
  const [missing, setMissing] = useState(missingAudio);
  const [fetching, setFetching] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  /** Walk the missing clips one request at a time so progress is visible. */
  async function fetchMissing() {
    setFetchError(null);
    setFetching("starting");
    try {
      for (;;) {
        const response = await fetch("/api/admin/fetch-missing", { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not fetch it");
        setMissing(data.remaining);
        if (data.done || data.remaining === 0) break;
        setFetching(data.fetched ?? "working");
      }
      router.refresh();
    } catch (cause) {
      setFetchError(cause instanceof Error ? cause.message : "Could not fetch it");
    } finally {
      setFetching(null);
    }
  }

  const selected = useMemo(
    () => solos.find((solo) => solo.id === selectedId) ?? null,
    [solos, selectedId],
  );

  function replace(updated: Solo) {
    setSolos((current) => {
      const index = current.findIndex((solo) => solo.id === updated.id);
      if (index === -1) return [...current, updated];
      const next = [...current];
      next[index] = updated;
      return next;
    });
  }

  function absorb(written: Solo[], removed: string[]) {
    setSolos((current) => {
      const dropped = new Set([...removed, ...written.map((solo) => solo.id)]);
      return [...current.filter((solo) => !dropped.has(solo.id)), ...written];
    });
  }

  async function loadPlaylist() {
    setPlaylistBusy(true);
    setPlaylistError(null);
    setPreloaded({});
    discarded.current = new Set();
    try {
      const response = await fetch("/api/admin/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: playlistTarget.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not read that playlist");
      const entries = data.entries as PlaylistEntry[];
      if (entries.length === 0) {
        throw new Error(t("mark.playlistAllKnown", { n: data.known ?? 0 }));
      }
      if (playlistAuto) {
        setJob({ kind: "auto", entries, known: data.known ?? 0 });
        setPlaylistTarget("");
        void runAuto(entries);
      } else {
        setJob({ kind: "queue", entries, index: 0, known: data.known ?? 0 });
        setPlaylistTarget("");
      }
    } catch (cause) {
      setPlaylistError(cause instanceof Error ? cause.message : "Could not read that playlist");
    } finally {
      setPlaylistBusy(false);
    }
  }

  /**
   * The same queue, seeded from TIDAL instead of a pasted playlist.
   *
   * The route answers in the playlist's shape on purpose, so everything from
   * here down — the marking queue, the unattended run, the duplicate check —
   * cannot tell the difference and does not need to.
   */
  async function loadTidal() {
    setTidalBusy(true);
    setTidalError(null);
    setTidalMisses(0);
    setPreloaded({});
    discarded.current = new Set();
    try {
      const response = await fetch("/api/admin/tidal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: tidalTarget.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not read that artist");
      const entries = data.entries as PlaylistEntry[];
      setTidalMisses(Array.isArray(data.misses) ? data.misses.length : 0);
      if (playlistAuto) {
        setJob({ kind: "auto", entries, known: data.known ?? 0 });
        setTidalTarget("");
        void runAuto(entries);
      } else {
        setJob({ kind: "queue", entries, index: 0, known: data.known ?? 0 });
        setTidalTarget("");
      }
    } catch (cause) {
      setTidalError(cause instanceof Error ? cause.message : "Could not read that artist");
    } finally {
      setTidalBusy(false);
    }
  }

  /** Swap a fresh recording for the entries it would have duplicated. */
  function openExisting(ids: string[]) {
    const group = solos.filter((solo) => ids.includes(solo.id));
    if (group.length === 0) return;
    setJob({ kind: "remark", solos: group });
  }

  /** Next in the queue, or done. Skipping and saving both land here. */
  function advanceQueue() {
    setJob((current) => {
      if (current?.kind !== "queue") return null;
      const index = current.index + 1;
      return index < current.entries.length ? { ...current, index } : null;
    });
  }

  /**
   * Skip this one and throw its download away.
   *
   * Saving drops the recording and so does discarding; skipping used to
   * leave it, which was a hundred megabytes a press. It matters more now
   * that the next record is fetched ahead of its turn — a run through a
   * playlist otherwise fills the disk with tunes nobody kept.
   */
  function skipCurrent(youtubeId: string) {
    discarded.current.add(youtubeId);
    void fetch(`/api/admin/source?id=${encodeURIComponent(youtubeId)}`, { method: "DELETE" })
      .catch(() => {});
    advanceQueue();
  }

  /*
   * Fetch the next record in the queue while this one is being marked.
   *
   * The download is the slow half of adding a record and the marking is the
   * half that needs a person, so they are run against each other: by the
   * time one record is saved the next is already on disk and its screen
   * opens on the waveform rather than on "Fetching".
   *
   * One at a time. Two downloads and a Discogs lookup at once is how the
   * Discogs throttle turns into everyone waiting.
   */
  useEffect(() => {
    if (job?.kind !== "queue") return;
    const next = job.entries[job.index + 1];
    if (!next) return;
    if (preloaded[next.youtubeId] || preloading.current.has(next.youtubeId)) return;
    if (preloading.current.size > 0) return;

    preloading.current.add(next.youtubeId);
    setPreloadingIds([...preloading.current]);

    let dropped = false;
    void (async () => {
      try {
        const response = await fetch("/api/admin/source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ youtubeId: next.youtubeId }),
        });
        const data = await response.json();
        // A failure here is not worth reporting: the record's own screen
        // will fetch it again when its turn comes, and say so then.
        if (response.ok && !dropped) {
          setPreloaded((current) => ({ ...current, [next.youtubeId]: data as SourceResult }));
        }
      } catch {
        /* same */
      } finally {
        preloading.current.delete(next.youtubeId);
        setPreloadingIds([...preloading.current]);
      }
    })();

    return () => {
      dropped = true;
    };
  }, [job, preloaded]);

  /*
   * Fetched but never used — a queue abandoned halfway, or a record skipped
   * after its download had already finished. Whole recordings are big and
   * the sources directory is not storage, so they go when the queue does.
   *
   * Which ids have been thrown away is a ref rather than state: nothing on
   * the screen depends on it, and the map itself is emptied when the next
   * playlist is listed.
   */
  const discarded = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (job?.kind === "queue") return;
    for (const id of Object.keys(preloaded)) {
      if (discarded.current.has(id)) continue;
      discarded.current.add(id);
      void fetch(`/api/admin/source?id=${encodeURIComponent(id)}`, { method: "DELETE" })
        .catch(() => {});
    }
  }, [job, preloaded]);

  /*
   * Work through a playlist without stopping at each record.
   *
   * Every entry gets its opening cut and nothing else — no solo is marked,
   * because marking one means hearing it — and lands unverified. What comes
   * out is a list to listen through, not a list to type into, which is a
   * different and much shorter job.
   */
  async function runAuto(entries: PlaylistEntry[]) {
    autoStopped.current = false;
    setAutoRunning(true);
    setAutoResults(
      entries.map((entry) => ({
        youtubeId: entry.youtubeId,
        title: entry.title,
        status: "waiting" as const,
      })),
    );

    const mark = (youtubeId: string, patch: Partial<AutoResult>) =>
      setAutoResults((current) =>
        current.map((row) => (row.youtubeId === youtubeId ? { ...row, ...patch } : row)),
      );

    for (const entry of entries) {
      if (autoStopped.current) break;
      mark(entry.youtubeId, { status: "working" });

      try {
        const response = await fetch("/api/admin/playlist/auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            youtubeId: entry.youtubeId,
            isrc: entry.isrc,
            tidalArtistId: entry.tidalArtistId,
            artist: entry.artist,
            song: entry.song,
          }),
        });
        const data = await response.json();

        if (!response.ok) {
          mark(entry.youtubeId, { status: "failed", detail: data.error ?? "Could not add it" });
          continue;
        }

        if (data.status === "added") {
          absorb([data.solo as Solo], []);
          mark(entry.youtubeId, {
            status: "added",
            detail: `${data.artist} — ${data.song}`,
          });
        } else if (data.status === "duplicate") {
          mark(entry.youtubeId, { status: "duplicate", detail: t("mark.autoDuplicate") });
        } else {
          mark(entry.youtubeId, { status: "skipped", detail: data.reason });
        }
      } catch (cause) {
        mark(entry.youtubeId, {
          status: "failed",
          detail: cause instanceof Error ? cause.message : "Could not add it",
        });
      }
    }

    setAutoRunning(false);
    router.refresh();
  }

  function workbench() {
    if (!job) return null;

    if (job.kind === "queue") {
      const entry = job.entries[job.index];
      const remaining = job.entries.length - job.index - 1;
      return (
        <div>
          <div className="mb-6 flex flex-wrap items-baseline gap-x-4 border-b border-ink-edge pb-4">
            <h3 className="type-eyebrow text-flame">{t("mark.queueTitle")}</h3>
            <span className="type-data text-xs text-paper-faint">{entry.title}</span>
            {job.known > 0 && (
              <span className="type-data text-xs text-paper-faint">
                {t("mark.playlistKnown", { n: job.known })}
              </span>
            )}
            <button
              type="button"
              onClick={() => skipCurrent(entry.youtubeId)}
              className="type-eyebrow ml-auto text-paper-faint transition-colors hover:text-flame"
            >
              {t("mark.skip")}
            </button>
          </div>
          <SourceWorkbench
            key={entry.youtubeId}
            seed={{ youtubeId: entry.youtubeId, autoFetch: true }}
            preloaded={preloaded[entry.youtubeId] ?? null}
            preloading={preloadingIds.includes(entry.youtubeId)}
            library={solos}
            queueNote={t("mark.queue", { n: remaining })}
            saveLabel={remaining > 0 ? t("mark.saveAndNext") : t("mark.save")}
            onSaved={(written, removed) => {
              absorb(written, removed);
              advanceQueue();
            }}
            onOpenExisting={openExisting}
            onCancel={advanceQueue}
          />
        </div>
      );
    }

    if (job.kind === "auto") {
      const done = autoResults.filter((row) => row.status !== "waiting" && row.status !== "working");
      const added = autoResults.filter((row) => row.status === "added").length;
      return (
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-baseline gap-x-4 border-b border-ink-edge pb-4">
            <h3 className="type-eyebrow text-flame">{t("mark.autoTitle")}</h3>
            <span className="type-data text-xs text-paper-faint">
              {t("mark.autoProgress", { done: done.length, n: autoResults.length })}
            </span>
            {autoRunning ? (
              <button
                type="button"
                onClick={() => {
                  autoStopped.current = true;
                }}
                className="type-eyebrow ml-auto text-paper-faint transition-colors hover:text-flame"
              >
                {t("mark.autoStop")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setJob(null)}
                className="type-eyebrow ml-auto text-paper-faint transition-colors hover:text-flame"
              >
                {t("mark.autoDone")}
              </button>
            )}
          </div>

          <p className="type-body mt-4 text-xs leading-relaxed text-paper-faint">
            {t("mark.autoHelp")}
          </p>

          <ul className="mt-6 divide-y divide-ink-edge border-y border-ink-edge">
            {autoResults.map((row) => (
              <li key={row.youtubeId} className="flex flex-wrap items-baseline gap-x-3 px-1 py-3">
                <span
                  className={`block h-2 w-2 shrink-0 rounded-full ${
                    row.status === "added"
                      ? "bg-flame"
                      : row.status === "working"
                        ? "bg-paper animate-pulse"
                        : row.status === "failed"
                          ? "bg-flame-deep"
                          : "bg-ink-edge"
                  }`}
                  aria-hidden="true"
                />
                <span className="type-body min-w-0 flex-1 truncate text-sm text-paper">
                  {row.detail ?? row.title}
                </span>
                <span className="type-eyebrow text-xs text-paper-faint">
                  {t(`mark.auto.${row.status}`)}
                </span>
              </li>
            ))}
          </ul>

          {!autoRunning && added > 0 && (
            <p className="type-body mt-5 text-sm text-paper-dim">
              {t("mark.autoFinished", { n: added })}
            </p>
          )}
        </div>
      );
    }

    if (job.kind === "suggestion") {
      const suggestion = job.suggestion;
      return (
        <SourceWorkbench
          key={suggestion.id}
          seed={{
            youtubeId: suggestion.youtubeId,
            artist: suggestion.artist,
            song: suggestion.song,
            album: suggestion.album,
            year: suggestion.year,
            note: suggestion.note,
            personnel: suggestion.personnel,
            discogsReleaseId: suggestion.discogsReleaseId,
            autoFetch: true,
          }}
          library={solos}
          onSaved={async (written, removed) => {
            absorb(written, removed);
            // The clips exist already; this only settles the suggestion.
            const response = await fetch("/api/admin/suggestions", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: suggestion.id, action: "approve", alreadyCut: true }),
            });
            const data = await response.json();
            if (response.ok) {
              setSuggestions((current) =>
                current.map((s) => (s.id === suggestion.id ? (data.suggestion as Suggestion) : s)),
              );
            }
            setJob(null);
            setSelectedId(written[0]?.id ?? null);
            setTab("library");
          }}
          onOpenExisting={openExisting}
          onCancel={() => setJob(null)}
        />
      );
    }

    if (job.kind === "remark") {
      const [first] = job.solos;
      return (
        <SourceWorkbench
          key={first.id}
          existing={job.solos}
          seed={{
            youtubeId: first.youtubeId,
            artist: first.artist,
            song: first.song,
            album: first.album,
            year: first.year,
            note: first.note,
            personnel: first.personnel,
            discogsReleaseId: first.discogsReleaseId,
            autoFetch: true,
          }}
          onSaved={(written, removed) => {
            absorb(written, removed);
            setSelectedId(written[0]?.id ?? null);
            setJob(null);
          }}
          onCancel={() => setJob(null)}
        />
      );
    }

    return (
      <div>
        <SourceWorkbench
          library={solos}
          onSaved={(written, removed) => {
            absorb(written, removed);
            setSelectedId(written[0]?.id ?? null);
            setJob(null);
          }}
          onOpenExisting={openExisting}
          onCancel={solos.length > 0 ? () => setJob(null) : undefined}
        />

        <div className="mt-12 max-w-2xl border-t border-ink-edge pt-8">
          <h3 className="type-eyebrow text-flame">{t("mark.queueTitle")}</h3>
          <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
            {t("mark.queueHelp")}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <input
              type="text"
              value={playlistTarget}
              onChange={(event) => setPlaylistTarget(event.target.value)}
              placeholder="https://www.youtube.com/playlist?list=…"
              className="type-body min-w-0 flex-1 border border-ink-edge bg-ink-raised px-4 py-3 text-sm text-paper focus:border-flame focus:outline-none"
            />
            <button
              type="button"
              onClick={loadPlaylist}
              disabled={playlistBusy || !playlistTarget.trim()}
              className="type-eyebrow border border-paper-faint px-5 py-3 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
            >
              {playlistBusy
                ? t("mark.playlistLoading")
                : playlistAuto
                  ? t("mark.playlistFetchAll")
                  : t("mark.playlistLoad")}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <input
              type="text"
              value={tidalTarget}
              onChange={(event) => setTidalTarget(event.target.value)}
              placeholder="https://tidal.com/artist/1072"
              className="type-body min-w-0 flex-1 border border-ink-edge bg-ink-raised px-4 py-3 text-sm text-paper focus:border-flame focus:outline-none"
            />
            <button
              type="button"
              onClick={loadTidal}
              disabled={tidalBusy || !tidalTarget.trim()}
              className="type-eyebrow border border-paper-faint px-5 py-3 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
            >
              {tidalBusy ? t("mark.tidalLoading") : t("mark.tidalLoad")}
            </button>
          </div>
          <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
            {t("mark.tidalHelp")}
          </p>
          {tidalMisses > 0 && (
            <p className="type-body mt-2 text-xs text-paper-faint">
              {t("mark.tidalMisses", { n: tidalMisses })}
            </p>
          )}
          {tidalError && <p className="type-body mt-3 text-sm text-flame">{tidalError}</p>}

          {/* Two ways to spend a playlist: an evening marking every solo, or
              a run of openings to listen through afterwards. */}
          <label className="mt-4 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={playlistAuto}
              onChange={(event) => setPlaylistAuto(event.target.checked)}
              className="mt-[3px] h-4 w-4 shrink-0 accent-flame"
            />
            <span>
              <span className="type-eyebrow block text-paper">{t("mark.playlistAuto")}</span>
              <span className="type-body mt-1 block text-xs leading-relaxed text-paper-faint">
                {t("mark.playlistAutoHelp")}
              </span>
            </span>
          </label>

          {playlistError && <p className="type-body mt-3 text-sm text-flame">{playlistError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <header className="shrink-0 flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-ink-edge px-6 py-4 sm:px-10">
        <Link href="/" className="flex items-center gap-3">
          <span className="block h-4 w-4 bg-flame" aria-hidden="true" />
          <span className="type-display text-xl text-paper">{t("brand")}</span>
        </Link>
        <nav className="flex gap-5">
          {(["library", "suggestions", "reports"] as const).map((value) => {
            const badge = value === "suggestions" ? waiting : value === "reports" ? openReports : 0;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`type-eyebrow border-b-2 pb-[2px] transition-colors ${
                  tab === value
                    ? "border-flame text-paper"
                    : "border-transparent text-paper-dim hover:text-paper"
                }`}
              >
                {value === "library"
                  ? t("review.tabLibrary")
                  : value === "suggestions"
                    ? t("review.tab")
                    : t("reports.tab")}
                {badge > 0 && <span className="ml-2 bg-flame px-[6px] py-[1px] text-ink">{badge}</span>}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <span className="type-data hidden text-xs text-paper-faint sm:block">
            {unverified > 0 ? t("library.unverified", { n: unverified }) : t("library.allVerified")}
          </span>
          <Link href="/" className="type-eyebrow text-paper-dim transition-colors hover:text-flame">
            {t("nav.daily")}
          </Link>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/login", { method: "DELETE" });
              router.replace("/");
              router.refresh();
            }}
            className="type-eyebrow text-paper-dim transition-colors hover:text-flame"
          >
            {t("login.signOut")}
          </button>
        </div>
      </header>

      {tab === "suggestions" && !job ? (
        <main className="flex-1 overflow-y-auto p-6 sm:p-10 lg:min-h-0">
          <div className="mx-auto w-full max-w-3xl">
            <SuggestionReview
              suggestions={suggestions}
              onMark={(suggestion) => setJob({ kind: "suggestion", suggestion })}
              onResolved={(suggestion) =>
                setSuggestions((current) =>
                  current.map((s) => (s.id === suggestion.id ? suggestion : s)),
                )
              }
            />
          </div>
        </main>
      ) : tab === "reports" && !job ? (
        <main className="flex-1 overflow-y-auto p-6 sm:p-10 lg:min-h-0">
          <div className="mx-auto w-full max-w-3xl">
            <ReportsReview
              reports={reports}
              onOpen={(soloId) => {
                setSelectedId(soloId);
                setTab("library");
              }}
              onResolved={(report) =>
                setReports((current) => current.map((r) => (r.id === report.id ? report : r)))
              }
            />
          </div>
        </main>
      ) : (

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[320px_1fr] lg:min-h-0">
        <aside className="flex flex-col border-b border-ink-edge lg:border-b-0 lg:border-r lg:min-h-0 lg:overflow-hidden">
          <LibraryList
            solos={solos}
            selectedId={job ? null : (selected?.id ?? null)}
            onSelect={(solo) => {
              setSelectedId(solo.id);
              setJob(null);
            }}
            onAdd={() => {
              setJob({ kind: "single" });
              setSelectedId(null);
            }}
          />
        </aside>

        <main className="p-6 sm:p-10 lg:overflow-y-auto">
          {missing > 0 && !job && (
            <div className="mb-8 border border-flame p-5">
              <p className="type-body text-sm text-paper">
                {t("library.missingAudio", { n: missing })}
              </p>
              <button
                type="button"
                onClick={fetchMissing}
                disabled={fetching !== null}
                className="type-eyebrow mt-4 bg-flame px-5 py-3 text-ink transition-colors hover:bg-paper disabled:opacity-40"
              >
                {fetching ? t("library.fetchingAudio", { n: missing }) : t("library.fetchAudio")}
              </button>
              {fetchError && <p className="type-body mt-3 text-sm text-flame">{fetchError}</p>}
            </div>
          )}

          {job ? (
            workbench()
          ) : selected ? (
            <SoloEditor
              key={selected.id}
              solo={selected}
              // Everything cut from the same recording is marked together.
              siblings={solos.filter((solo) => solo.youtubeId === selected.youtubeId)}
              onSelectSibling={setSelectedId}
              onRemark={(group) => setJob({ kind: "remark", solos: group })}
              onSaved={replace}
              onDeleted={(id) => {
                setSolos((current) => current.filter((solo) => solo.id !== id));
                setSelectedId(null);
              }}
            />
          ) : (
            <p className="type-body max-w-2xl text-sm text-paper-dim">{t("library.intro")}</p>
          )}
        </main>
      </div>
      )}
    </div>
  );
}
