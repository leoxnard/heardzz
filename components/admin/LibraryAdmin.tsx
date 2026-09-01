"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ImportForm } from "./ImportForm";
import { SoloEditor } from "./SoloEditor";
import { t } from "@/lib/i18n";
import type { Solo } from "@/lib/types";

export function LibraryAdmin({ initial }: { initial: Solo[] }) {
  const [solos, setSolos] = useState(initial);
  const [filter, setFilter] = useState<"all" | "unverified">(
    initial.some((solo) => !solo.verified) ? "unverified" : "all",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(initial.length === 0);

  const unverified = solos.filter((solo) => !solo.verified).length;

  // Unverified first: they are the reason to open this screen at all.
  const visible = useMemo(() => {
    const pool = filter === "unverified" ? solos.filter((s) => !s.verified) : solos;
    return [...pool].sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? 1 : -1;
      return a.catalog.localeCompare(b.catalog);
    });
  }, [solos, filter]);

  const selected = solos.find((solo) => solo.id === selectedId) ?? visible[0] ?? null;

  function replace(updated: Solo) {
    setSolos((current) => {
      const index = current.findIndex((solo) => solo.id === updated.id);
      if (index === -1) return [...current, updated];
      const next = [...current];
      next[index] = updated;
      return next;
    });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-ink-edge px-6 py-4 sm:px-10">
        <Link href="/" className="flex items-center gap-3">
          <span className="block h-4 w-4 bg-flame" aria-hidden="true" />
          <span className="type-display text-xl text-paper">{t("brand")}</span>
        </Link>
        <span className="type-eyebrow text-paper-dim">{t("library.title")}</span>

        <div className="ml-auto flex items-center gap-4">
          <span className="type-data text-xs text-paper-faint">
            {unverified > 0 ? t("library.unverified", { n: unverified }) : t("library.allVerified")}
          </span>
          <Link href="/" className="type-eyebrow text-paper-dim transition-colors hover:text-flame">
            {t("nav.daily")}
          </Link>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[320px_1fr]">
        <aside className="border-b border-ink-edge lg:border-b-0 lg:border-r">
          <div className="flex gap-2 border-b border-ink-edge p-4">
            {(["unverified", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`type-eyebrow border px-3 py-2 transition-colors ${
                  filter === value
                    ? "border-flame bg-flame text-ink"
                    : "border-ink-edge text-paper-dim hover:text-paper"
                }`}
              >
                {value === "all" ? t("library.filterAll") : t("library.filterUnverified")}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setSelectedId(null);
              }}
              className="type-eyebrow ml-auto border border-ink-edge px-3 py-2 text-paper-dim transition-colors hover:border-flame hover:text-flame"
            >
              +
            </button>
          </div>

          <ul className="max-h-[70vh] overflow-y-auto lg:max-h-none">
            {visible.length === 0 && (
              <li className="type-body p-6 text-sm text-paper-faint">
                {solos.length === 0 ? t("library.empty") : t("library.allVerified")}
              </li>
            )}
            {visible.map((solo) => {
              const active = selected?.id === solo.id && !adding;
              return (
                <li key={solo.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(solo.id);
                      setAdding(false);
                    }}
                    className={`flex w-full items-start gap-3 border-b border-ink-edge px-4 py-3 text-left transition-colors ${
                      active ? "bg-ink-raised" : "hover:bg-ink-raised"
                    }`}
                  >
                    <span
                      className={`mt-[6px] block h-2 w-2 shrink-0 ${
                        solo.verified ? "bg-flame-deep" : "bg-flame"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="type-body block truncate text-sm text-paper">
                        {solo.artist}
                      </span>
                      <span className="type-body block truncate text-xs text-paper-dim">
                        {solo.song}
                      </span>
                      <span className="type-data mt-1 block text-[0.6rem] text-paper-faint">
                        {solo.catalog}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="p-6 sm:p-10">
          {adding || !selected ? (
            <>
              <p className="type-body mb-8 max-w-2xl text-sm text-paper-dim">{t("library.intro")}</p>
              <ImportForm
                onImported={(solo) => {
                  replace(solo);
                  setSelectedId(solo.id);
                  setAdding(false);
                }}
              />
            </>
          ) : (
            <SoloEditor
              key={selected.id}
              solo={selected}
              onSaved={replace}
              onDeleted={(id) => {
                setSolos((current) => current.filter((solo) => solo.id !== id));
                setSelectedId(null);
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
