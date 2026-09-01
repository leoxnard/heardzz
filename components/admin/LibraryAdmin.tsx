"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LibraryList } from "./LibraryList";
import { SoloEditor } from "./SoloEditor";
import { SourceWorkbench } from "./SourceWorkbench";
import { SuggestionReview } from "./SuggestionReview";
import { t } from "@/lib/i18n";
import type { Solo, Suggestion } from "@/lib/types";

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
}

type Job =
  /** A link, pasted by hand. */
  | { kind: "single" }
  /** A playlist, one record at a time. */
  | { kind: "queue"; entries: PlaylistEntry[]; index: number; known: number }
  /** Somebody's suggestion, marked up before it is accepted. */
  | { kind: "suggestion"; suggestion: Suggestion }
  /** A record already in the library, being marked again. */
  | { kind: "remark"; solos: Solo[] };

export function LibraryAdmin({
  initial,
  suggestions: initialSuggestions,
  missingAudio,
}: {
  initial: Solo[];
  suggestions: Suggestion[];
  missingAudio: number;
}) {
  const router = useRouter();
  const [solos, setSolos] = useState(initial);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [tab, setTab] = useState<"library" | "suggestions">(
    initialSuggestions.some((s) => s.status === "pending") ? "suggestions" : "library",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(initial.length === 0 ? { kind: "single" } : null);

  const [playlistTarget, setPlaylistTarget] = useState("");
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const unverified = solos.filter((solo) => !solo.verified).length;
  const waiting = suggestions.filter((s) => s.status === "pending").length;
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
      setJob({ kind: "queue", entries, index: 0, known: data.known ?? 0 });
      setPlaylistTarget("");
    } catch (cause) {
      setPlaylistError(cause instanceof Error ? cause.message : "Could not read that playlist");
    } finally {
      setPlaylistBusy(false);
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
              onClick={advanceQueue}
              className="type-eyebrow ml-auto text-paper-faint transition-colors hover:text-flame"
            >
              {t("mark.skip")}
            </button>
          </div>
          <SourceWorkbench
            key={entry.youtubeId}
            seed={{ youtubeId: entry.youtubeId, autoFetch: true }}
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
              {playlistBusy ? t("mark.playlistLoading") : t("mark.playlistLoad")}
            </button>
          </div>
          {playlistError && <p className="type-body mt-3 text-sm text-flame">{playlistError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-ink-edge px-6 py-4 sm:px-10">
        <Link href="/" className="flex items-center gap-3">
          <span className="block h-4 w-4 bg-flame" aria-hidden="true" />
          <span className="type-display text-xl text-paper">{t("brand")}</span>
        </Link>
        <nav className="flex gap-5">
          {(["library", "suggestions"] as const).map((value) => (
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
              {value === "library" ? t("review.tabLibrary") : t("review.tab")}
              {value === "suggestions" && waiting > 0 && (
                <span className="ml-2 bg-flame px-[6px] py-[1px] text-ink">{waiting}</span>
              )}
            </button>
          ))}
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
        <main className="flex-1 p-6 sm:p-10">
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
      ) : (

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[320px_1fr]">
        <aside className="border-b border-ink-edge lg:border-b-0 lg:border-r">
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

        <main className="p-6 sm:p-10">
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
