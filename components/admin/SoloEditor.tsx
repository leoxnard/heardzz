"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Waveform } from "./Waveform";
import { useSoloAudio } from "@/lib/audio";
import { t } from "@/lib/i18n";
import type { Solo } from "@/lib/types";

/* ------------------------------------------------------------------
   One entry, after it has been cut.

   Everything structural — where the tune starts, where each solo is, who is
   playing them — belongs to the marking screen, which works on the whole
   recording. What is left here is the fine tuning that only needs the clip:
   nudging the entry point inside it, fixing a name, confirming it.
   ------------------------------------------------------------------ */

/** What space plays, here and on the marking screen. */
const PREVIEW = 6;
const PREVIEW_LENGTHS = [0.5, 2, PREVIEW];

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

interface SoloEditorProps {
  solo: Solo;
  /** Every entry cut from the same recording, this one included. */
  siblings: Solo[];
  onRemark: (group: Solo[]) => void;
  onSaved: (solo: Solo) => void;
  onDeleted: (id: string) => void;
}

export function SoloEditor({ solo, siblings, onRemark, onSaved, onDeleted }: SoloEditorProps) {
  const [draft, setDraft] = useState<Solo>(solo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discogsLink, setDiscogsLink] = useState("");
  const [creditsBusy, setCreditsBusy] = useState(false);
  const [playedFrom, setPlayedFrom] = useState<number | null>(null);
  const [playedLength, setPlayedLength] = useState(0);
  /** Which of the two cuts is on the waveform: the head, or the solo. */
  const [side, setSide] = useState<"head" | "solo">(solo.soloClip ? "solo" : "head");

  // No reset effect here: LibraryAdmin keys this component on the solo id,
  // so selecting a different entry remounts it with fresh state.

  const clip = side === "solo" && draft.soloClip ? draft.soloClip : null;
  const audio = useSoloAudio(clip ? clip.audio : draft.audio, 0.9);
  const marker = clip ? clip.leadIn : draft.leadIn;

  const level = useMemo(
    () => rmsAfter(audio.buffer, marker, 2),
    [audio.buffer, marker],
  );

  const playhead = useMemo(() => {
    if (!audio.isPlaying || playedFrom === null) return null;
    return playedFrom + audio.progress * playedLength;
  }, [audio.isPlaying, audio.progress, playedFrom, playedLength]);

  const preview = useCallback(
    (seconds: number) => {
      setPlayedFrom(marker);
      setPlayedLength(seconds);
      audio.play(marker, seconds);
    },
    [audio, marker],
  );

  /* Space plays six seconds of whichever cut is on screen. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.code !== "Space" && event.key !== " ") return;
      event.preventDefault();
      if (audio.isPlaying) audio.stop();
      else preview(PREVIEW);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audio, preview]);

  function field<K extends keyof Solo>(key: K, value: Solo[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  /** Moving the marker on the solo cut moves that clip's entry point. */
  function moveMarker(seconds: number) {
    if (clip) {
      setDraft((current) => ({
        ...current,
        soloClip: current.soloClip ? { ...current.soloClip, leadIn: seconds } : undefined,
        soloAt: current.soloAt !== undefined
          ? Number((current.soloAt + (seconds - clip.leadIn)).toFixed(3))
          : undefined,
      }));
      return;
    }
    field("leadIn", seconds);
  }

  async function save(extra: Partial<Solo> = {}) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/solos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, ...extra, id: draft.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Save failed");
      setDraft(data);
      onSaved(data);
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
          artist: draft.artist,
          song: draft.song,
          discogs: discogsLink.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Lookup failed");
      setDraft((current) => ({
        ...current,
        personnel: data.personnel,
        discogsReleaseId: data.discogsReleaseId,
        year: current.year || data.year,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lookup failed");
    } finally {
      setCreditsBusy(false);
    }
  }

  function setCredit(index: number, key: "name" | "role", value: string) {
    setDraft((current) => {
      const personnel = [...current.personnel];
      personnel[index] = { ...personnel[index], [key]: value };
      return { ...current, personnel };
    });
  }

  async function remove() {
    if (!window.confirm(t("library.deleteConfirm", { song: draft.song, artist: draft.artist }))) {
      return;
    }
    await fetch(`/api/admin/solos?id=${encodeURIComponent(draft.id)}`, { method: "DELETE" });
    onDeleted(draft.id);
  }

  // The marker's position in the clip and its position in the recording
  // describe the same instant; showing both keeps the two connected.
  const sourceTime = clip
    ? (draft.soloAt ?? clip.start)
    : solo.soloStart + (draft.leadIn - solo.leadIn);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <span className="type-data text-xs text-paper-faint">{draft.catalog}</span>
          <h2 className="type-display mt-1 text-3xl text-paper">{draft.artist}</h2>
          <p className="type-body text-sm text-paper-dim">
            {draft.song}
            {draft.album && ` · ${draft.album}`}
          </p>
        </div>

        <span
          className={`type-eyebrow px-3 py-1 ${
            draft.verified ? "bg-flame text-ink" : "border border-paper-faint text-paper-dim"
          }`}
        >
          {draft.verified ? t("library.verified") : "unverified"}
        </span>
      </div>

      {/* Every entry cut from this recording, so a record with three soloists
          reads as one record rather than three unrelated rows. */}
      {siblings.length > 1 && (
        <ul className="mt-6 flex flex-wrap gap-2">
          {siblings.map((sibling) => (
            <li key={sibling.id}>
              <span
                className={`type-data inline-flex items-center gap-2 border px-3 py-1 text-xs ${
                  sibling.id === draft.id
                    ? "border-flame text-flame"
                    : "border-ink-edge text-paper-dim"
                }`}
              >
                <span className="block h-2 w-2 rounded-full bg-flame" aria-hidden="true" />
                {sibling.soloist}
                {sibling.soloAt !== undefined && ` · ${timecode(sibling.soloAt)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {(["head", "solo"] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={value === "solo" && !draft.soloClip}
            onClick={() => setSide(value)}
            className={`type-eyebrow border px-4 py-2 transition-colors disabled:opacity-30 ${
              side === value
                ? "border-flame bg-flame text-ink"
                : "border-ink-edge text-paper-dim hover:text-paper"
            }`}
          >
            {value === "head" ? t("library.headClip") : t("library.soloClip")}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onRemark(siblings)}
          className="type-eyebrow ml-auto border border-paper-faint px-4 py-2 text-paper transition-colors hover:border-flame hover:text-flame"
        >
          {t("mark.remark")}
        </button>
      </div>

      <div className="mt-5">
        <Waveform
          buffer={audio.buffer}
          marker={marker}
          onMarkerChange={moveMarker}
          playhead={playhead}
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

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="type-eyebrow text-paper-faint">{t("library.preview")}</span>
        {PREVIEW_LENGTHS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            onClick={() => preview(seconds)}
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
          <button
            type="button"
            onClick={audio.stop}
            className="type-eyebrow px-3 py-2 text-flame"
          >
            {t("library.stop")}
          </button>
        )}
        <span className="type-body ml-auto text-xs text-paper-faint">{t("library.spaceHint")}</span>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => save({ verified: true })}
          disabled={busy}
          className="type-eyebrow bg-flame px-5 py-3 text-ink transition-colors hover:bg-paper disabled:opacity-40"
        >
          {busy ? t("library.saving") : t("library.markVerified")}
        </button>
        <button
          type="button"
          onClick={() => save()}
          disabled={busy}
          className="type-eyebrow border border-paper-faint px-5 py-3 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
        >
          {t("library.save")}
        </button>
        <button
          type="button"
          onClick={remove}
          className="type-eyebrow ml-auto border border-ink-edge px-5 py-3 text-paper-faint transition-colors hover:border-flame hover:text-flame"
        >
          {t("library.delete")}
        </button>
      </div>

      {error && <p className="type-body mt-4 text-sm text-flame">{error}</p>}

      <section className="mt-12 border-t border-ink-edge pt-8">
        <h3 className="type-eyebrow text-flame">{t("library.soloist")}</h3>
        <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
          {t("library.soloistHelp")}
        </p>
        {/* A native select ignores padding on macOS unless its own appearance
            is dropped, which is why this one used to sit half the height of
            every field around it. */}
        <select
          value={draft.soloist || draft.artist}
          onChange={(event) => field("soloist", event.target.value)}
          className="type-body mt-4 w-full appearance-none border border-ink-edge bg-ink-raised bg-[length:10px] bg-[right_1rem_center] bg-no-repeat px-3 py-3 pr-10 text-sm text-paper focus:border-flame focus:outline-none"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath fill='%239c9382' d='M0 0h10L5 6z'/%3E%3C/svg%3E\")",
          }}
        >
          {/* The leader is always offered, even when the credits omit them. */}
          {[
            ...new Set([
              draft.soloist,
              draft.artist,
              ...draft.personnel.map((credit) => credit.name).filter(Boolean),
            ].filter(Boolean)),
          ].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </section>

      <section className="mt-12 border-t border-ink-edge pt-8">
        <h3 className="type-eyebrow text-flame">
          {t("library.personnelCount", { n: draft.personnel.length })}
        </h3>

        <ul className="mt-4 space-y-2">
          {draft.personnel.map((credit, i) => (
            <li key={i} className="flex gap-2">
              <input
                type="text"
                value={credit.name}
                onChange={(event) => setCredit(i, "name", event.target.value)}
                className="type-body min-w-0 flex-1 border border-ink-edge bg-ink-raised px-3 py-2 text-sm text-paper focus:border-flame focus:outline-none"
              />
              <input
                type="text"
                value={credit.role}
                onChange={(event) => setCredit(i, "role", event.target.value)}
                className="type-body min-w-0 flex-1 border border-ink-edge bg-ink-raised px-3 py-2 text-sm text-paper-dim focus:border-flame focus:outline-none"
              />
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    personnel: current.personnel.filter((_, j) => j !== i),
                  }))
                }
                aria-label={`Remove ${credit.name}`}
                className="type-data px-2 text-paper-faint transition-colors hover:text-flame"
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              personnel: [...current.personnel, { name: "", role: "" }],
            }))
          }
          className="type-eyebrow mt-4 w-full border border-ink-edge py-3 text-paper-dim transition-colors hover:border-flame hover:text-flame"
        >
          {t("library.addCredit")}
        </button>

        <div className="mt-6 flex flex-wrap gap-3">
          <input
            type="text"
            value={discogsLink}
            onChange={(event) => setDiscogsLink(event.target.value)}
            placeholder="https://www.discogs.com/release/… (optional)"
            className="type-body min-w-0 flex-1 border border-ink-edge bg-ink-raised px-3 py-3 text-sm text-paper focus:border-flame focus:outline-none"
          />
          <button
            type="button"
            onClick={fetchCredits}
            disabled={creditsBusy}
            className="type-eyebrow border border-paper-faint px-5 py-3 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
          >
            {creditsBusy ? t("library.lookingUp") : t("library.fetchCredits")}
          </button>
        </div>

        {draft.discogsReleaseId && (
          <a
            href={`https://www.discogs.com/release/${draft.discogsReleaseId}`}
            target="_blank"
            rel="noreferrer"
            className="type-data mt-3 inline-block text-xs text-paper-faint underline underline-offset-2 transition-colors hover:text-flame"
          >
            discogs release {draft.discogsReleaseId}
          </a>
        )}
      </section>

      <section className="mt-12 border-t border-ink-edge pt-8">
        <h3 className="type-eyebrow text-flame">Metadata</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Text
            label="Artist — the answer"
            value={draft.artist}
            onChange={(v) => field("artist", v)}
          />
          <Text label="Song" value={draft.song} onChange={(v) => field("song", v)} />
          <Text label="Album" value={draft.album} onChange={(v) => field("album", v)} />
          <Text
            label="Year"
            value={draft.year ? String(draft.year) : ""}
            onChange={(v) => field("year", Number(v) || 0)}
          />
        </div>
        <div className="mt-4">
          <Text
            label="Note shown on reveal"
            value={draft.note ?? ""}
            onChange={(v) => field("note", v)}
          />
        </div>
      </section>
    </div>
  );
}

function Text({
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
