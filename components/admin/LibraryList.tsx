"use client";

import { useMemo, useState } from "react";
import { t } from "@/lib/i18n";
import { tuneKey } from "@/lib/slug";
import type { Solo } from "@/lib/types";

/* ------------------------------------------------------------------
   The list down the left.

   Twenty records fit on a screen and a hundred do not, which is the whole
   reason this is more than a sorted list now. Searching is the fast path.

   One row per tune, always — three solos off the same tune are one row
   naming all three, not three unrelated rows, and that holds even when they
   were cut from different uploads. Grouping buckets those rows into
   sections; it never re-splits a tune back apart.
   ------------------------------------------------------------------ */

type Sort = "catalog" | "artist" | "song" | "year" | "soloist";
type Group = "none" | "artist" | "verified";

const SORTS: Sort[] = ["catalog", "artist", "song", "year", "soloist"];
const GROUPS: Group[] = ["none", "artist", "verified"];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Everything about a record worth typing into a search box — the band and the
 * instruments included, because "tenor" and a sideman's name are both things
 * you go looking for and neither is on the row.
 */
function haystack(solo: Solo): string {
  return normalize(
    [
      solo.artist,
      solo.song,
      solo.album,
      solo.soloist,
      solo.soloistRole,
      solo.catalog,
      String(solo.year),
      ...solo.personnel.flatMap((credit) => [credit.name, credit.role]),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** One tune, however many solos have been marked on it, off however many uploads. */
interface Recording {
  key: string;
  /** The one that opened the record — lowest catalogue number wins. */
  lead: Solo;
  entries: Solo[];
  verified: boolean;
  haystack: string;
}

function groupByTune(solos: Solo[]): Recording[] {
  const byTune = new Map<string, Solo[]>();
  for (const solo of solos) {
    const key = tuneKey(solo.artist, solo.song);
    const bucket = byTune.get(key);
    if (bucket) bucket.push(solo);
    else byTune.set(key, [solo]);
  }

  return [...byTune.entries()].map(([key, entries]) => {
    const sorted = [...entries].sort((a, b) => a.catalog.localeCompare(b.catalog));
    return {
      key,
      lead: sorted[0],
      entries: sorted,
      verified: entries.every((solo) => solo.verified),
      haystack: entries.map(haystack).join(" "),
    };
  });
}

function compare(sort: Sort) {
  return (a: Recording, b: Recording) => {
    switch (sort) {
      case "artist":
        return a.lead.artist.localeCompare(b.lead.artist) || a.lead.song.localeCompare(b.lead.song);
      case "song":
        return a.lead.song.localeCompare(b.lead.song) || a.lead.artist.localeCompare(b.lead.artist);
      case "year":
        // A record with no year is unknown, not ancient: it sorts last.
        return (a.lead.year || 9999) - (b.lead.year || 9999) || a.lead.artist.localeCompare(b.lead.artist);
      case "soloist":
        return (a.lead.soloist || a.lead.artist).localeCompare(b.lead.soloist || b.lead.artist);
      default:
        return a.lead.catalog.localeCompare(b.lead.catalog);
    }
  };
}

interface Section {
  key: string;
  label: string | null;
  items: Recording[];
}

interface LibraryListProps {
  solos: Solo[];
  selectedId: string | null;
  onSelect: (solo: Solo) => void;
  onAdd: () => void;
}

export function LibraryList({ solos, selectedId, onSelect, onAdd }: LibraryListProps) {
  const [filter, setFilter] = useState<"all" | "unverified">(
    solos.some((solo) => !solo.verified) ? "unverified" : "all",
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("artist");
  const [group, setGroup] = useState<Group>("artist");

  const recordings = useMemo(() => groupByTune(solos), [solos]);

  const sections = useMemo<Section[]>(() => {
    const needle = normalize(query.trim());
    // A search is a search: it looks at everything, filter chip or not.
    const pool = recordings.filter((recording) => {
      if (needle) return recording.haystack.includes(needle);
      if (filter === "unverified" && recording.verified) return false;
      return true;
    });

    const sorted = [...pool].sort(compare(sort));
    if (group === "none") return [{ key: "all", label: null, items: sorted }];

    const buckets = new Map<string, Section>();
    for (const recording of sorted) {
      const [key, label] =
        group === "artist"
          ? [recording.lead.artist, recording.lead.artist]
          : [
              recording.verified ? "verified" : "unverified",
              recording.verified ? t("library.verified") : t("library.filterUnverified"),
            ];

      const bucket = buckets.get(key);
      if (bucket) bucket.items.push(recording);
      else buckets.set(key, { key, label, items: [recording] });
    }
    return [...buckets.values()];
  }, [recordings, query, filter, sort, group]);

  const shown = sections.reduce((n, section) => n + section.items.length, 0);

  return (
    <>
      <div className="shrink-0 border-b border-ink-edge p-4">
        <button
          type="button"
          onClick={onAdd}
          className="type-eyebrow w-full border border-ink-edge py-3 text-paper-dim transition-colors hover:border-flame hover:text-flame"
        >
          + {t("mark.add")}
        </button>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("library.searchPlaceholder")}
          className="type-body mt-3 w-full border border-ink-edge bg-ink-raised px-3 py-3 text-sm text-paper focus:border-flame focus:outline-none"
        />

        <div className="mt-3 flex gap-2">
          {(["unverified", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              disabled={query.trim().length > 0}
              className={`type-eyebrow border px-3 py-2 transition-colors disabled:opacity-30 ${
                filter === value && !query.trim()
                  ? "border-flame bg-flame text-ink"
                  : "border-ink-edge text-paper-dim hover:text-paper"
              }`}
            >
              {value === "all" ? t("library.filterAll") : t("library.filterUnverified")}
            </button>
          ))}
          <span className="type-data ml-auto self-center text-[0.6rem] text-paper-faint">
            {t("library.showing", { n: shown })}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Picker
            label={t("library.sortBy")}
            value={sort}
            options={SORTS.map((value) => [value, t(`library.sort.${value}`)])}
            onChange={(value) => setSort(value as Sort)}
          />
          <Picker
            label={t("library.groupBy")}
            value={group}
            options={GROUPS.map((value) => [value, t(`library.group.${value}`)])}
            onChange={(value) => setGroup(value as Group)}
          />
        </div>
      </div>

      <ul className="max-h-[70vh] flex-1 overflow-y-auto lg:max-h-none lg:min-h-0">
        {shown === 0 && (
          <li className="type-body p-6 text-sm text-paper-faint">
            {solos.length === 0
              ? t("library.empty")
              : query.trim()
                ? t("library.noMatch", { query: query.trim() })
                : t("library.allVerified")}
          </li>
        )}

        {sections.map((section) => (
          <li key={section.key}>
            {section.label && (
              <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-ink-edge bg-ink px-4 py-2">
                <span className="type-eyebrow truncate text-paper-faint">{section.label}</span>
                <span className="type-data ml-auto text-[0.6rem] text-paper-faint">
                  {section.items.length}
                </span>
              </div>
            )}
            <ul>
              {section.items.map((recording) => {
                // Every name behind this row, the leader first and never twice.
                const soloists = [
                  ...new Set(recording.entries.map((solo) => solo.soloist).filter(Boolean)),
                ];
                const active = recording.entries.some((solo) => solo.id === selectedId);

                return (
                  <li key={recording.key}>
                    <button
                      type="button"
                      onClick={() => onSelect(recording.lead)}
                      className={`flex w-full items-start gap-3 border-b border-ink-edge px-4 py-3 text-left transition-colors ${
                        active ? "bg-ink-raised" : "hover:bg-ink-raised"
                      }`}
                    >
                      <span
                        className={`mt-[6px] block h-2 w-2 shrink-0 ${
                          recording.verified ? "bg-flame-deep" : "bg-flame"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="type-body block truncate text-sm text-paper">
                          {recording.lead.artist}
                        </span>
                        <span className="type-body block truncate text-xs text-paper-dim">
                          {recording.lead.song}
                          {soloists.length > 0 &&
                            !(soloists.length === 1 && soloists[0] === recording.lead.artist) &&
                            ` · ${soloists.join(", ")}`}
                        </span>
                        <span className="type-data mt-1 block text-[0.6rem] text-paper-faint">
                          {recording.entries.map((solo) => solo.catalog).join(" · ")}
                          {recording.lead.year ? ` · ${recording.lead.year}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}

function Picker({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="type-eyebrow text-[0.6rem] text-paper-faint">{label}</span>
      {/* Appearance dropped so the padding is the height, the way it is on
          every other field on this screen. */}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="type-body mt-1 w-full appearance-none border border-ink-edge bg-ink-raised bg-[length:8px] bg-[right_0.6rem_center] bg-no-repeat py-2 pl-3 pr-7 text-xs text-paper focus:border-flame focus:outline-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath fill='%239c9382' d='M0 0h10L5 6z'/%3E%3C/svg%3E\")",
        }}
      >
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
