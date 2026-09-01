"use client";

import { useMemo, useState } from "react";
import { Waveform } from "./Waveform";
import { useSoloAudio } from "@/lib/audio";
import { t } from "@/lib/i18n";
import type { Solo } from "@/lib/types";

const PREVIEW_LENGTHS = [0.5, 2, 6];

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
  onSaved: (solo: Solo) => void;
  onDeleted: (id: string) => void;
}

export function SoloEditor({ solo, onSaved, onDeleted }: SoloEditorProps) {
  const [draft, setDraft] = useState<Solo>(solo);
  const [busy, setBusy] = useState<null | "saving" | "recutting">(null);
  const [error, setError] = useState<string | null>(null);
  const [recutAt, setRecutAt] = useState("");
  const [playedFrom, setPlayedFrom] = useState<number | null>(null);
  const [playedLength, setPlayedLength] = useState(0);

  // No reset effect here: LibraryAdmin keys this component on the solo id,
  // so selecting a different entry remounts it with fresh state.

  const audio = useSoloAudio(draft.audio, 0.9);

  const level = useMemo(
    () => rmsAfter(audio.buffer, draft.leadIn, 2),
    [audio.buffer, draft.leadIn],
  );

  const playhead = useMemo(() => {
    if (!audio.isPlaying || playedFrom === null) return null;
    return playedFrom + audio.progress * playedLength;
  }, [audio.isPlaying, audio.progress, playedFrom, playedLength]);

  function preview(seconds: number) {
    setPlayedFrom(draft.leadIn);
    setPlayedLength(seconds);
    audio.play(draft.leadIn, seconds);
  }

  function field<K extends keyof Solo>(key: K, value: Solo[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save(extra: Partial<Solo> = {}) {
    setBusy("saving");
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
      setBusy(null);
    }
  }

  async function recut() {
    if (!recutAt.trim()) return;
    setBusy("recutting");
    setError(null);
    try {
      const response = await fetch("/api/admin/recut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, soloStart: recutAt.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Re-cut failed");
      setDraft(data);
      onSaved(data);
      setRecutAt("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Re-cut failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(t("library.deleteConfirm", { song: draft.song, artist: draft.artist }))) {
      return;
    }
    await fetch(`/api/admin/solos?id=${encodeURIComponent(draft.id)}`, { method: "DELETE" });
    onDeleted(draft.id);
  }

  // The marker's position in the clip and its position in the source describe
  // the same instant; showing both makes the re-cut field self-explanatory.
  const sourceTime = solo.soloStart + (draft.leadIn - solo.leadIn);

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

      <div className="mt-8">
        <Waveform
          buffer={audio.buffer}
          marker={draft.leadIn}
          onMarkerChange={(seconds) => field("leadIn", seconds)}
          playhead={playhead}
        />
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <span className="type-eyebrow text-paper-faint">{t("library.inClip")}</span>
          <div className="type-data mt-2 text-2xl text-paper">{timecode(draft.leadIn)}</div>
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
            className="type-data border border-ink-edge px-4 py-2 text-sm text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-30"
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
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => save({ verified: true })}
          disabled={busy !== null}
          className="type-eyebrow bg-flame px-5 py-3 text-ink transition-colors hover:bg-paper disabled:opacity-40"
        >
          {busy === "saving" ? t("library.saving") : t("library.markVerified")}
        </button>
        <button
          type="button"
          onClick={() => save()}
          disabled={busy !== null}
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
        <h3 className="type-eyebrow text-flame">{t("library.sourcePreview")}</h3>
        <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
          {t("library.recutHelp")}
        </p>

        <div className="mt-4 aspect-video w-full border border-ink-edge">
          <iframe
            title={`${draft.song} source`}
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${draft.youtubeId}?start=${Math.max(0, Math.floor(sourceTime))}`}
            allow="encrypted-media"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <input
            type="text"
            value={recutAt}
            onChange={(event) => setRecutAt(event.target.value)}
            placeholder="3:26"
            className="type-data w-32 border border-ink-edge bg-ink-raised px-4 py-3 text-paper focus:border-flame focus:outline-none"
          />
          <button
            type="button"
            onClick={recut}
            disabled={busy !== null || !recutAt.trim()}
            className="type-eyebrow border border-paper-faint px-5 py-3 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
          >
            {busy === "recutting" ? t("library.importing") : t("library.recut")}
          </button>
        </div>
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
          <Text
            label="Soloist — shown on reveal"
            value={draft.soloist}
            onChange={(v) => field("soloist", v)}
          />
          <Text label="Album" value={draft.album} onChange={(v) => field("album", v)} />
          <Text label="Label" value={draft.label} onChange={(v) => field("label", v)} />
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
