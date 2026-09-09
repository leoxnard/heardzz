"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Waveform } from "./Waveform";
import { SplitButton, StemReview, useSplit } from "./StemReview";
import { aim, pressSpace, useSoloAudio } from "@/lib/audio";
import { t } from "@/lib/i18n";
import type { Credit, Solo } from "@/lib/types";

/* ------------------------------------------------------------------
   One recording, after it has been cut.

   A tune with three soloists on it is three entries in the library, and
   almost everything about them is one thing said three times: the same
   credits, the same album, the same twenty seconds off the top pulled apart
   the same way. Only the solo differs — who, where, and the cut taken from
   it. Editing them one at a time meant saying it three times and letting the
   shared half drift apart in between.

   So this edits the recording. The opening and each solo are tabs, because
   they are the things you actually move between; credits and metadata sit
   outside them, because they belong to all of it.
   ------------------------------------------------------------------ */

/** Below this the marker is sitting in silence, not in a solo. */
const SILENT_RMS = 0.004;

/**
 * Loudness of the stretch the round would actually play, measured straight
 * off the buffer the waveform is already using. A marker in a silent gap is
 * the one kind of wrong timestamp that does not need an ear to spot.
 */
function rmsAfter(buffer: AudioBuffer | null, from: number, seconds: number): number | null {
  if (!buffer) return null;
  const data = buffer.getChannelData(0);
  const start = Math.floor(Math.max(0, from) * buffer.sampleRate);
  const end = Math.min(data.length, start + Math.floor(seconds * buffer.sampleRate));
  if (end <= start) return 0;

  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (end - start));
}

function timecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

/** Everything except the stems, which no form owns. */
function comparable(solos: Solo[]) {
  return JSON.stringify(
    solos.map((solo) => ({
      ...solo,
      stems: undefined,
      sources: undefined,
      soloClip: solo.soloClip
        ? { ...solo.soloClip, stems: undefined, sources: undefined }
        : undefined,
    })),
  );
}

interface SoloEditorProps {
  /** Every entry cut from this recording, the one on screen included. */
  siblings: Solo[];
  onRemark: (group: Solo[]) => void;
  onSaved: (written: Solo[]) => void;
  onDeleted: (id: string) => void;
  /** Names already in the library, offered as completions. */
  known: { artists: string[]; songs: string[]; albums: string[] };
}

export function SoloEditor({ siblings, onRemark, onSaved, onDeleted, known }: SoloEditorProps) {
  const ordered = useMemo(
    () => [...siblings].sort((a, b) => a.catalog.localeCompare(b.catalog)),
    [siblings],
  );

  const [draft, setDraft] = useState<Solo[]>(ordered);
  const [tab, setTab] = useState<"opening" | string>("opening");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discogsLink, setDiscogsLink] = useState("");
  const [creditsBusy, setCreditsBusy] = useState(false);
  /** Bumped when a save invalidates the stems, to set the split going. */
  const [resplit, setResplit] = useState(0);

  /*
   * The recording is one thing, so the first entry carries whatever the whole
   * of it shares. Which entry is arbitrary and deliberately so: the save
   * writes those fields onto every one of them.
   */
  const shared = draft[0];
  const entry = draft.find((solo) => solo.id === tab) ?? null;

  const dirty = comparable(draft) !== comparable(ordered);

  function editShared<K extends keyof Solo>(key: K, value: Solo[K]) {
    setDraft((current) => current.map((solo) => ({ ...solo, [key]: value })));
  }

  function editEntry<K extends keyof Solo>(id: string, key: K, value: Solo[K]) {
    patchEntry(id, (solo) => ({ ...solo, [key]: value }));
  }

  /**
   * Change several of an entry's fields at once.
   *
   * The marker on a solo cut needs it: where it sits in the clip and where
   * it sits in the recording are the same instant from two origins, so the
   * second is derived from how far the first moved. Two separate updates
   * read that distance off a render that the first has already invalidated,
   * and a fast drag walks the source timestamp away from the marker.
   */
  function patchEntry(id: string, change: (solo: Solo) => Solo) {
    setDraft((current) => current.map((solo) => (solo.id === id ? change(solo) : solo)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/recording", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...shared,
          entries: draft.map((solo) => ({
            id: solo.id,
            soloist: solo.soloist,
            soloAt: solo.soloAt,
            soloClip: solo.soloClip,
            verified: solo.verified,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Save failed");

      /*
       * The save may have thrown stems away, because what went into them
       * changed — a different soloist takes a different instrument out of
       * the rhythm mix. Noticing it here rather than in `StemReview` is the
       * difference between "these were just invalidated" and "these were
       * never made", and only the first should start an hour of separating.
       */
      const written = data.written as Solo[];
      const dropped = written.some((next) => {
        const was = draft.find((solo) => solo.id === next.id);
        return (
          (Boolean(was?.stems) && !next.stems) ||
          (Boolean(was?.soloClip?.stems) && !next.soloClip?.stems)
        );
      });

      setDraft(written);
      onSaved(written);
      if (dropped) setResplit((n) => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function fetchCredits() {
    setCreditsBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artist: shared.artist,
          song: shared.song,
          discogs: discogsLink.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Lookup failed");
      // A link pasted by hand is a correction, not a fallback — it overwrites
      // whatever is here, including a year or an album that were wrong.
      setDraft((current) =>
        current.map((solo) => ({
          ...solo,
          personnel: data.personnel,
          discogsReleaseId: data.discogsReleaseId,
          year: data.year || solo.year,
          album: data.album || solo.album,
        })),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lookup failed");
    } finally {
      setCreditsBusy(false);
    }
  }

  async function remove(solo: Solo) {
    const last = draft.length === 1;
    if (!window.confirm(t("library.deleteConfirm", { song: solo.song, artist: solo.artist }))) {
      return;
    }
    await fetch(`/api/admin/solos?id=${encodeURIComponent(solo.id)}`, { method: "DELETE" });
    onDeleted(solo.id);
    if (!last) setDraft((current) => current.filter((one) => one.id !== solo.id));
    if (tab === solo.id) setTab("opening");
  }

  /**
   * Approvals, trims and splits are written by the review block, not by this
   * form, so the form takes them back rather than posting its stale copy
   * over them on the next save.
   *
   * Only the stems, and only for the records the route says it touched — a
   * ruling on the head clip reaches every sibling, and it names them all
   * rather than leaving this to guess which of them moved.
   */
  const absorbStems = useCallback((written: Solo[]) => {
    const byId = new Map(written.map((solo) => [solo.id, solo]));
    setDraft((current) =>
      current.map((solo) => {
        const next = byId.get(solo.id);
        if (!next) return solo;
        return {
          ...solo,
          stems: next.stems,
          sources: next.sources,
          soloClip: solo.soloClip
            ? { ...solo.soloClip, stems: next.soloClip?.stems, sources: next.soloClip?.sources }
            : solo.soloClip,
        };
      }),
    );
    onSaved(written);
  }, [onSaved]);

  return (
    <div>
      <Header
        shared={shared}
        entries={draft}
        onRemark={() => onRemark(draft)}
        onVerified={(value) => setDraft((current) =>
          current.map((solo) => ({ ...solo, verified: value })),
        )}
      />

      <Overview draft={draft} onPick={setTab} onSaved={absorbStems} />

      <Tabs draft={draft} tab={tab} onPick={setTab} />

      {tab === "opening" ? (
        <OpeningTab
          shared={shared}
          saved={ordered[0]}
          onEdit={editShared}
          onSaved={absorbStems}
          resplit={resplit}
        />
      ) : entry ? (
        <SoloTab
          entry={entry}
          onEdit={(key, value) => editEntry(entry.id, key, value)}
          onPatch={(change) => patchEntry(entry.id, change)}
          onSaved={absorbStems}
          onRemove={() => remove(entry)}
          resplit={resplit}
        />
      ) : null}

      {/* Outside the tabs, because none of it belongs to one solo. */}
      <Credits
        personnel={shared.personnel}
        onChange={(personnel) => editShared("personnel", personnel)}
        discogsLink={discogsLink}
        onDiscogsLink={setDiscogsLink}
        onFetch={fetchCredits}
        busy={creditsBusy}
        releaseId={shared.discogsReleaseId}
      />

      <Metadata shared={shared} onEdit={editShared} known={known} />

      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-12 border-t border-ink-edge bg-ink px-6 py-4 sm:-mx-10 sm:-mb-10 sm:px-10">
        <div className="flex flex-wrap items-center gap-3">
          {/* Lit only when there is something to save. A button that is
              always the loudest thing on screen stops saying anything. */}
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className={`type-eyebrow px-5 py-3 transition-colors ${
              dirty
                ? "bg-flame text-ink hover:bg-paper"
                : "border border-ink-edge text-paper-faint"
            } disabled:opacity-40`}
          >
            {busy ? t("library.saving") : dirty ? t("library.save") : t("library.saved")}
          </button>
          {/* Never lit. Throwing work away is not the thing to reach for. */}
          <button
            type="button"
            onClick={() => setDraft(ordered)}
            disabled={busy || !dirty}
            className="type-eyebrow border border-ink-edge px-5 py-3 text-paper-dim transition-colors hover:border-paper-faint hover:text-paper disabled:opacity-30"
          >
            {t("library.revert")}
          </button>
          <span className="type-body ml-auto text-xs text-paper-faint">
            {t("library.spaceHint")}
          </span>
        </div>
        {error && <p className="type-body mt-3 text-sm text-flame">{error}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   The parts.
   ------------------------------------------------------------------ */

function Header({
  shared, entries, onRemark, onVerified,
}: {
  shared: Solo;
  entries: Solo[];
  onRemark: () => void;
  onVerified: (value: boolean) => void;
}) {
  const solos = entries.filter((entry) => entry.soloClip);
  /* The list on the left calls a recording confirmed when every entry on it
     is, so this asks and answers the same question rather than a per-entry
     one nothing else reads. */
  const verified = entries.every((entry) => entry.verified);
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <span className="type-data text-xs text-paper-faint">
          {entries.map((entry) => entry.catalog).join(" · ")}
        </span>
        <h2 className="type-display mt-1 text-3xl text-paper">{shared.artist}</h2>
        <p className="type-body text-sm text-paper-dim">
          {shared.song}
          {shared.album && ` · ${shared.album}`}
        </p>
        <p className="type-body mt-2 text-xs text-paper-faint">
          {solos.length === 0
            ? t("library.extractedNone")
            : solos.length === 1
              ? t("library.extractedOne")
              : t("library.extractedMany", { n: solos.length })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {/* A chip that was only ever a readout, and the one thing the second
            save button used to exist to set. Clicking it is the setting now,
            and the save below writes it with everything else. */}
        <button
          type="button"
          onClick={() => onVerified(!verified)}
          aria-pressed={verified}
          title={t("library.verifiedHint")}
          className={`type-eyebrow px-3 py-2 transition-colors ${
            verified
              ? "bg-flame text-ink hover:bg-paper"
              : "border border-paper-faint text-paper-dim hover:border-flame hover:text-flame"
          }`}
        >
          {verified ? t("library.verified") : "unverified"}
        </button>
        <button
          type="button"
          onClick={onRemark}
          className="type-eyebrow border border-paper-faint px-4 py-2 text-paper transition-colors hover:border-flame hover:text-flame"
        >
          {t("mark.remark")}
        </button>
      </div>
    </div>
  );
}

/**
 * What this recording has been pulled into, and what state each piece is in.
 *
 * The tabs below say where you can go; this says what is there when you get
 * there — which cuts have been separated, how many of their layers survived
 * the meters, and how many a person has ruled on. Without it, finding out
 * meant opening three tabs and reading three badges.
 */
function Overview({
  draft, onPick, onSaved,
}: {
  draft: Solo[];
  onPick: (tab: string) => void;
  onSaved: (written: Solo[]) => void;
}) {
  const rows = [
    { key: "opening", label: t("library.tabOpening"), stems: draft[0].stems, solo: draft[0] },
    ...draft.map((entry, index) => ({
      key: entry.id,
      label: `${t("library.tabSolo", { n: index + 1 })} · ${entry.soloist}`,
      stems: entry.soloClip?.stems,
      solo: entry,
    })),
  ];

  return (
    <ul className="mt-6 divide-y divide-ink-edge border border-ink-edge">
      {rows.map((row) => {
        const variants = Object.values(row.stems ?? {});
        const usable = variants.filter((variant) => variant.usable);
        const ruled = usable.filter((variant) => variant.approved !== undefined);
        return (
          <li key={row.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => onPick(row.key)}
              className="type-eyebrow text-xs text-paper transition-colors hover:text-flame"
            >
              {row.label}
            </button>
            <span className="type-data text-xs text-paper-faint">
              {row.stems
                ? t("library.overviewSplit", { ok: usable.length, ruled: ruled.length })
                : t("library.overviewUnsplit")}
            </span>
            <span className="ml-auto">
              <SplitAction solo={row.solo} onSaved={onSaved} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The one control the overview offers: separate this record again. */
function SplitAction({ solo, onSaved }: { solo: Solo; onSaved: (written: Solo[]) => void }) {
  const split = useSplit(solo.id, onSaved);
  return <SplitButton split={split} label={t("stemReview.resplit")} force compact />;
}

/**
 * The opening and each solo, side by side and pinned.
 *
 * One row rather than two. Choosing "the solo cut" and then choosing which
 * solo describes the same thing twice, and on a record with three of them it
 * left you a click away from knowing which one you were looking at.
 */
function Tabs({
  draft, tab, onPick,
}: {
  draft: Solo[];
  tab: string;
  onPick: (tab: string) => void;
}) {
  const chip = (active: boolean) =>
    `type-eyebrow whitespace-nowrap border px-4 py-2 text-xs transition-colors ${
      active
        ? "border-flame bg-flame text-ink"
        : "border-ink-edge text-paper-dim hover:border-paper-faint hover:text-paper"
    }`;

  return (
    <div className="sticky top-0 z-10 -mx-6 mt-8 overflow-x-auto border-b border-ink-edge bg-ink px-6 py-3 sm:-mx-10 sm:px-10">
      <div className="flex gap-2">
        <button type="button" onClick={() => onPick("opening")} className={chip(tab === "opening")}>
          {t("library.tabOpening")}
        </button>
        {draft.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onPick(entry.id)}
            className={chip(tab === entry.id)}
            title={entry.catalog}
          >
            {t("library.tabSolo", { n: index + 1 })}
            <span className={`ml-2 ${tab === entry.id ? "text-ink/70" : "text-paper-faint"}`}>
              {entry.soloist}
              {entry.soloAt !== undefined && ` · ${timecode(entry.soloAt)}`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function OpeningTab({
  shared, saved, onEdit, onSaved, resplit,
}: {
  shared: Solo;
  /** As stored, so a moved marker can say where it now lands in the source. */
  saved: Solo;
  onEdit: <K extends keyof Solo>(key: K, value: Solo[K]) => void;
  onSaved: (written: Solo[]) => void;
  resplit: number;
}) {
  return (
    <>
      <Cut
        audioUrl={shared.audio}
        marker={shared.leadIn}
        onMarker={(seconds) => onEdit("leadIn", seconds)}
        sourceTime={saved.soloStart + (shared.leadIn - saved.leadIn)}
        note={t("library.openingHelp")}
      />

      <section className="mt-10 border-t border-ink-edge pt-8">
        <h3 className="type-eyebrow text-flame">{t("library.melody")}</h3>
        <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
          {t("library.melodyHelp")}
        </p>
        {/* Every credited player, because who states a theme is not a thing
            the instrument decides — the horns usually have it, the piano
            often doubles it, and on a trio it is the piano alone. */}
        <ul className="mt-4 flex flex-wrap gap-2">
          {shared.personnel.map((credit) => {
            const on = (shared.melody ?? []).includes(credit.name);
            return (
              <li key={credit.name}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onEdit(
                      "melody",
                      on
                        ? (shared.melody ?? []).filter((name) => name !== credit.name)
                        : [...(shared.melody ?? []), credit.name],
                    )
                  }
                  className={`type-eyebrow border px-3 py-2 text-xs transition-colors ${
                    on
                      ? "border-flame bg-flame text-ink"
                      : "border-ink-edge text-paper-dim hover:border-flame hover:text-paper"
                  }`}
                >
                  {credit.name}
                  <span className={`ml-2 ${on ? "text-ink/70" : "text-paper-faint"}`}>
                    {credit.role}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {(shared.melody ?? []).length === 0 && (
          <p className="type-body mt-3 text-xs text-paper-faint">
            {t("library.melodyGuessed")}
          </p>
        )}
      </section>

      <StemReview solo={shared} cut="head" resplit={resplit} onSaved={onSaved} />
    </>
  );
}

function SoloTab({
  entry, onEdit, onPatch, onSaved, onRemove, resplit,
}: {
  entry: Solo;
  onEdit: <K extends keyof Solo>(key: K, value: Solo[K]) => void;
  onPatch: (change: (solo: Solo) => Solo) => void;
  onSaved: (written: Solo[]) => void;
  onRemove: () => void;
  resplit: number;
}) {
  const clip = entry.soloClip;

  if (!clip) {
    return (
      <div className="mt-8 border border-ink-edge p-6">
        <p className="type-body text-sm text-paper-dim">{t("library.noSoloCut")}</p>
      </div>
    );
  }

  return (
    <>
      <Cut
        audioUrl={clip.audio}
        marker={clip.leadIn}
        onMarker={(seconds) =>
          /* The marker inside the clip and the timestamp in the recording
             describe the same instant, so they move together — and in one
             step, off the same starting value. */
          onPatch((solo) => {
            const was = solo.soloClip?.leadIn ?? 0;
            return {
              ...solo,
              soloClip: solo.soloClip ? { ...solo.soloClip, leadIn: seconds } : undefined,
              soloAt:
                solo.soloAt === undefined
                  ? undefined
                  : Number((solo.soloAt + (seconds - was)).toFixed(3)),
            };
          })
        }
        sourceTime={entry.soloAt ?? clip.start}
        note={t("library.soloHelp")}
      />

      <section className="mt-10 border-t border-ink-edge pt-8">
        <h3 className="type-eyebrow text-flame">{t("library.soloist")}</h3>
        <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
          {t("library.soloistHelp")}
        </p>
        {/* A native select ignores padding on macOS unless its own appearance
            is dropped, which is why this one used to sit half the height of
            every field around it. */}
        <select
          value={entry.soloist || entry.artist}
          onChange={(event) => onEdit("soloist", event.target.value)}
          className="type-body mt-4 w-full appearance-none border border-ink-edge bg-ink-raised bg-[length:10px] bg-[right_1rem_center] bg-no-repeat px-3 py-3 pr-10 text-sm text-paper focus:border-flame focus:outline-none"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath fill='%239c9382' d='M0 0h10L5 6z'/%3E%3C/svg%3E\")",
          }}
        >
          {/* The leader is always offered, even when the credits omit them. */}
          {[
            ...new Set(
              [
                entry.soloist,
                entry.artist,
                ...entry.personnel.map((credit) => credit.name).filter(Boolean),
              ].filter(Boolean),
            ),
          ].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {entry.soloistRole && (
          <p className="type-data mt-2 text-xs text-paper-faint">
            {t("library.soloistPlays", { role: entry.soloistRole })}
          </p>
        )}
      </section>

      <StemReview solo={entry} cut="solo" resplit={resplit} onSaved={onSaved} />

      <div className="mt-8 flex">
        <button
          type="button"
          onClick={onRemove}
          className="type-eyebrow ml-auto border border-ink-edge px-4 py-2 text-xs text-paper-faint transition-colors hover:border-flame hover:text-flame"
        >
          {t("library.deleteSolo")}
        </button>
      </div>
    </>
  );
}

/** One cut's waveform, its marker, and what it sounds like. */
function Cut({
  audioUrl, marker, onMarker, sourceTime, note,
}: {
  audioUrl: string;
  marker: number;
  onMarker: (seconds: number) => void;
  sourceTime: number;
  note: string;
}) {
  const audio = useSoloAudio(audioUrl, 0.9);
  const owner = useRef({});
  useEffect(() => {
    const mine = owner.current;
    return () => aim(mine, null);
  }, []);
  const [playedFrom, setPlayedFrom] = useState<number | null>(null);
  const [playedLength, setPlayedLength] = useState(0);

  const level = useMemo(() => rmsAfter(audio.buffer, marker, 2), [audio.buffer, marker]);

  const playFrom = useCallback(
    (from: number) => {
      const rest = (audio.buffer?.duration ?? from) - from;
      setPlayedFrom(from);
      setPlayedLength(rest);
      audio.play(from, rest);
    },
    [audio],
  );

  /* Space: stop what is sounding, else play whatever the pointer is over,
     else this clip from its marker. The order is in `pressSpace`. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.code !== "Space" && event.key !== " ") return;
      event.preventDefault();
      pressSpace(() => playFrom(marker));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playFrom, marker]);

  const playhead =
    audio.isPlaying && playedFrom !== null ? playedFrom + audio.progress * playedLength : null;

  return (
    <>
      <p className="type-body mt-8 text-xs leading-relaxed text-paper-faint">{note}</p>

      <div className="mt-4">
        <Waveform
          buffer={audio.buffer}
          marker={marker}
          onMarkerChange={onMarker}
          playhead={playhead}
          onAim={(at) => aim(owner.current, at === null ? null : { at, play: playFrom })}
        />
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <span className="type-eyebrow text-paper-faint">{t("library.inClip")}</span>
          <div className="type-data mt-2 text-2xl text-paper">{timecode(marker)}</div>
        </div>
        <div>
          <span className="type-eyebrow text-paper-faint">{t("library.inSource")}</span>
          <div className="type-data mt-2 text-2xl text-paper">{timecode(sourceTime)}</div>
        </div>
      </div>

      {level !== null && level < SILENT_RMS && (
        <p className="type-body mt-6 border-l-2 border-flame pl-4 text-sm text-flame">
          {t("library.silentWarning")}
        </p>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={() => (audio.isPlaying ? audio.stop() : playFrom(marker))}
          disabled={audio.status !== "ready"}
          className="type-eyebrow border border-ink-edge px-5 py-2 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-30"
        >
          {audio.isPlaying ? t("library.stop") : t("library.preview")}
        </button>
      </div>
    </>
  );
}

function Credits({
  personnel, onChange, discogsLink, onDiscogsLink, onFetch, busy, releaseId,
}: {
  personnel: Credit[];
  onChange: (personnel: Credit[]) => void;
  discogsLink: string;
  onDiscogsLink: (value: string) => void;
  onFetch: () => void;
  busy: boolean;
  releaseId?: number | string;
}) {
  return (
    <section className="mt-12 border-t border-ink-edge pt-8">
      <h3 className="type-eyebrow text-flame">
        {t("library.personnelCount", { n: personnel.length })}
      </h3>

      <ul className="mt-4 space-y-2">
        {personnel.map((credit, i) => (
          <li key={i} className="flex gap-2">
            <input
              type="text"
              value={credit.name}
              onChange={(event) =>
                onChange(personnel.map((c, j) => (i === j ? { ...c, name: event.target.value } : c)))
              }
              placeholder="Name"
              className="type-body min-w-0 flex-1 border border-ink-edge bg-ink-raised px-3 py-2 text-sm text-paper focus:border-flame focus:outline-none"
            />
            <input
              type="text"
              value={credit.role}
              onChange={(event) =>
                onChange(personnel.map((c, j) => (i === j ? { ...c, role: event.target.value } : c)))
              }
              placeholder="Instrument"
              className="type-body min-w-0 flex-1 border border-ink-edge bg-ink-raised px-3 py-2 text-sm text-paper focus:border-flame focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onChange(personnel.filter((_, j) => j !== i))}
              className="type-eyebrow border border-ink-edge px-3 text-paper-faint transition-colors hover:border-flame hover:text-flame"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => onChange([...personnel, { name: "", role: "" }])}
        className="type-eyebrow mt-4 w-full border border-ink-edge py-3 text-paper-dim transition-colors hover:border-flame hover:text-flame"
      >
        {t("library.addCredit")}
      </button>

      <div className="mt-6 flex flex-wrap gap-3">
        <input
          type="text"
          value={discogsLink}
          onChange={(event) => onDiscogsLink(event.target.value)}
          placeholder="https://www.discogs.com/release/… (optional)"
          className="type-body min-w-0 flex-1 border border-ink-edge bg-ink-raised px-3 py-3 text-sm text-paper focus:border-flame focus:outline-none"
        />
        <button
          type="button"
          onClick={onFetch}
          disabled={busy}
          className="type-eyebrow border border-paper-faint px-5 py-3 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
        >
          {busy ? t("library.lookingUp") : t("library.fetchCredits")}
        </button>
      </div>
      {releaseId && (
        <p className="type-data mt-2 text-xs text-paper-faint">discogs release {releaseId}</p>
      )}
    </section>
  );
}

function Metadata({
  shared, onEdit, known,
}: {
  shared: Solo;
  onEdit: <K extends keyof Solo>(key: K, value: Solo[K]) => void;
  known: { artists: string[]; songs: string[]; albums: string[] };
}) {
  return (
    <section className="mt-12 border-t border-ink-edge pt-8">
      <h3 className="type-eyebrow text-flame">{t("library.metadata")}</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Text
          label="Artist — the answer"
          value={shared.artist}
          onChange={(v) => onEdit("artist", v)}
          options={known.artists}
        />
        <Text
          label="Song"
          value={shared.song}
          onChange={(v) => onEdit("song", v)}
          options={known.songs}
        />
        <Text
          label="Album"
          value={shared.album}
          onChange={(v) => onEdit("album", v)}
          options={known.albums}
        />
        <Text
          label="Year"
          value={shared.year ? String(shared.year) : ""}
          onChange={(v) => onEdit("year", Number(v) || 0)}
        />
      </div>
      <div className="mt-4">
        <Text
          label="Note shown on reveal"
          value={shared.note ?? ""}
          onChange={(v) => onEdit("note", v)}
        />
      </div>
    </section>
  );
}

/**
 * A metadata field, with the names already in the library behind it.
 *
 * The artist is the answer the game checks, so two spellings of one player
 * are two players — "Cannonball Adderley" and "Cannonball Adderly" group
 * apart in the list, and a round dealt from one will not accept the other.
 * A datalist rather than anything cleverer: it suggests without insisting,
 * which is right for a field whose whole job is that new names are allowed.
 */
function Text({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: string[];
}) {
  const listId = useId();
  return (
    <label className="block">
      <span className="type-eyebrow text-paper-faint">{label}</span>
      <input
        type="text"
        value={value}
        list={options && options.length > 0 ? listId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="type-body mt-2 w-full border border-ink-edge bg-ink-raised px-3 py-3 text-sm text-paper focus:border-flame focus:outline-none"
      />
      {options && options.length > 0 && (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </label>
  );
}
