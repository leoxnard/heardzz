"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ImportForm } from "./ImportForm";
import { SoloEditor } from "./SoloEditor";
import { SuggestionReview } from "./SuggestionReview";
import { t } from "@/lib/i18n";
import type { Solo, Suggestion } from "@/lib/types";

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
  const [filter, setFilter] = useState<"all" | "unverified">(
    initial.some((solo) => !solo.verified) ? "unverified" : "all",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(initial.length === 0);

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

      {tab === "suggestions" ? (
        <main className="flex-1 p-6 sm:p-10">
          <div className="mx-auto w-full max-w-3xl">
            <SuggestionReview
              suggestions={suggestions}
              onResolved={(suggestion, solo) => {
                setSuggestions((current) =>
                  current.map((s) => (s.id === suggestion.id ? suggestion : s)),
                );
                if (solo) replace(solo);
              }}
            />
          </div>
        </main>
      ) : (

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
          {missing > 0 && (
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
      )}
    </div>
  );
}
