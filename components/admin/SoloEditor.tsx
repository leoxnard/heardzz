"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Waveform } from "./Waveform";
import { useSoloAudio } from "@/lib/audio";
import { StemReview } from "./StemReview";
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
  /** Switch the editor to one of the siblings. */
  onSelectSibling: (id: string) => void;
  onRemark: (group: Solo[]) => void;
  onSaved: (solo: Solo) => void;
  onDeleted: (id: string) => void;
  /** Names already in the library, offered as completions. */
  known: { artists: string[]; songs: string[]; albums: string[] };
}

export function SoloEditor({
  solo, siblings, onSelectSibling, onRemark, onSaved, onDeleted, known,
}: SoloEditorProps) {
  const [draft, setDraft] = useState<Solo>(solo);
  const [busy, setBusy] = useState(false);
  /** Bumped when a save invalidates the stems, to set the split going. */
  const [resplit, setResplit] = useState(0);

  /*
   * Whether anything here differs from what is stored.
   *
   * The stems are excluded because they are not this form's to hold: they
   * are written by the split and ruled on in the review block, and counting
   * them would make the save button light up because somebody approved a
   * stem — an edit nobody made and a save that would do nothing.
   */
  const dirty = useMemo(() => {
    const bare = (solo: Solo) => ({
      ...solo,
      stems: undefined,
      soloClip: solo.soloClip ? { ...solo.soloClip, stems: undefined } : undefined,
    });
    return JSON.stringify(bare(draft)) !== JSON.stringify(bare(solo));
  }, [draft, solo]);
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

  /**
   * Play whichever cut is on screen, from the marker to the end of it.
   *
   * There used to be a row of buttons offering half a second, two, and six.
   * They were the game's ladder leaking into the editor, and the editor is
   * not the game: marking an entry point means hearing what comes after it,
   * and cutting that off at six seconds only meant pressing the button
   * again. The clip is twenty-odd seconds. It plays.
   */
  const preview = useCallback(() => {
    const rest = (audio.buffer?.duration ?? marker) - marker;
    setPlayedFrom(marker);
    setPlayedLength(rest);
    audio.play(marker, rest);
  }, [audio, marker]);

  /* Space plays whichever cut is on screen, and stops it again. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.code !== "Space" && event.key !== " ") return;
      event.preventDefault();
      if (audio.isPlaying) audio.stop();
      else preview();
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

      /*
       * The save may have thrown the stems away, because what went into them
       * changed — a different soloist takes a different instrument out of
       * the rhythm mix. Noticing it here rather than in `StemReview` is the
       * difference between "these were just invalidated" and "these are
       * missing", and only the first should start an hour of separating.
       * Merely opening a record that was never split must not.
       */
      const dropped =
        (Boolean(draft.stems) && !data.stems) ||
        (Boolean(draft.soloClip?.stems) && !data.soloClip?.stems);
      if (dropped) setResplit((n) => n + 1);

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
      // A link pasted by hand is a correction, not a fallback — it overwrites
      // whatever is here, including a year or an album that were wrong.
      setDraft((current) => ({
        ...current,
        personnel: data.personnel,
        discogsReleaseId: data.discogsReleaseId,
        year: data.year || current.year,
        album: data.album || current.album,
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

        {/* A chip that was only ever a readout, and the one thing the second
            save button existed to set. Clicking it is the setting now, and
            the save below writes it with everything else. */}
        <button
          type="button"
          onClick={() => field("verified", !draft.verified)}
          aria-pressed={Boolean(draft.verified)}
          title={t("library.verifiedHint")}
          className={`type-eyebrow px-3 py-1 transition-colors ${
            draft.verified
              ? "bg-flame text-ink hover:bg-paper"
              : "border border-paper-faint text-paper-dim hover:border-flame hover:text-flame"
          }`}
        >
          {draft.verified ? t("library.verified") : "unverified"}
        </button>
      </div>

      {/* Every entry cut from this recording, so a record with three soloists
          reads as one record rather than three unrelated rows — and clicking
          one switches the editor onto it, rather than only naming it. */}
      {siblings.length > 1 && (
        <ul className="mt-6 flex flex-wrap gap-2">
          {siblings.map((sibling) => (
            <li key={sibling.id}>
              <button
                type="button"
                onClick={() => onSelectSibling(sibling.id)}
                disabled={sibling.id === draft.id}
                className={`type-data inline-flex items-center gap-2 border px-3 py-1 text-xs transition-colors disabled:cursor-default ${
                  sibling.id === draft.id
                    ? "border-flame text-flame"
                    : "border-ink-edge text-paper-dim hover:border-paper-faint hover:text-paper"
                }`}
              >
                <span className="block h-2 w-2 rounded-full bg-flame" aria-hidden="true" />
                {sibling.soloist}
                {sibling.soloAt !== undefined && ` · ${timecode(sibling.soloAt)}`}
              </button>
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
        <button
          type="button"
          onClick={() => (audio.isPlaying ? audio.stop() : preview())}
          disabled={audio.status !== "ready"}
          className="type-eyebrow border border-ink-edge px-5 py-2 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-30"
        >
          {audio.isPlaying ? t("library.stop") : t("library.preview")}
        </button>
        <span className="type-body ml-auto text-xs text-paper-faint">{t("library.spaceHint")}</span>
      </div>

      <section className="mt-12 border-t border-ink-edge pt-8">
        <h3 className="type-eyebrow text-flame">{t("library.melody")}</h3>
        <p className="type-body mt-2 text-xs leading-relaxed text-paper-faint">
          {t("library.melodyHelp")}
        </p>
        {/* Every credited player, because who states a theme is not a thing
            the instrument decides — the horns usually have it, the piano
            often doubles it, and on a trio it is the piano alone. */}
        <ul className="mt-4 flex flex-wrap gap-2">
          {draft.personnel.map((credit) => {
            const on = (draft.melody ?? []).includes(credit.name);
            return (
              <li key={credit.name}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    field(
                      "melody",
                      on
                        ? (draft.melody ?? []).filter((name) => name !== credit.name)
                        : [...(draft.melody ?? []), credit.name],
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
        {(draft.melody ?? []).length === 0 && (
          <p className="type-body mt-3 text-xs text-paper-faint">
            {t("library.melodyGuessed")}
          </p>
        )}
      </section>

      {/* Approving a stem writes to the record, so the form has to take that
          back — otherwise the next save posts a copy without it. Only the
          stems are merged, so edits in progress here are not thrown away. */}
      <StemReview
        solo={solo}
        resplit={resplit}
        onSaved={(next) => {
          setDraft((current) => ({
            ...current,
            stems: next.stems,
            soloClip: current.soloClip
              ? { ...current.soloClip, stems: next.soloClip?.stems }
              : current.soloClip,
          }));
          onSaved(next);
        }}
      />

      {/* Only where there is a solo to be soloing in. The blindfold level is
          the only one that asks for this and it deals only records that have
          a solo cut, so on a record without one the question has no answer
          and storing one invents a fact. */}
      {draft.soloClip && (
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
      )}

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
            options={known.artists}
          />
          <Text
            label="Song"
            value={draft.song}
            onChange={(v) => field("song", v)}
            options={known.songs}
          />
          <Text
            label="Album"
            value={draft.album}
            onChange={(v) => field("album", v)}
            options={known.albums}
          />
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

      {/* Pinned rather than sitting at whatever point in the form it happens
          to fall. The editor is long — credits, melody, three stems with a
          waveform each — and a save button you have to scroll to find is
          also a "have I changed anything" you have to scroll to answer. */}
      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-12 border-t border-ink-edge bg-ink px-6 py-4 sm:-mx-10 sm:-mb-10 sm:px-10">
        <div className="flex flex-wrap items-center gap-3">
          {/* Lit only when there is something to save. A button that is
              always the loudest thing on screen stops saying anything. */}
          <button
            type="button"
            onClick={() => save()}
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
            onClick={() => setDraft(solo)}
            disabled={busy || !dirty}
            className="type-eyebrow border border-ink-edge px-5 py-3 text-paper-dim transition-colors hover:border-paper-faint hover:text-paper disabled:opacity-30"
          >
            {t("library.revert")}
          </button>
          <button
            type="button"
            onClick={remove}
            className="type-eyebrow ml-auto border border-ink-edge px-5 py-3 text-paper-faint transition-colors hover:border-flame hover:text-flame"
          >
            {t("library.delete")}
          </button>
        </div>
        {error && <p className="type-body mt-3 text-sm text-flame">{error}</p>}
      </div>
    </div>
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
