"use client";

import { useState } from "react";
import { t } from "@/lib/i18n";
import type { Report } from "@/lib/types";

/* ------------------------------------------------------------------
   What players reported.

   A report names a solo and one of three problems, and nothing here fixes
   anything by itself — it opens the record in the library so the timestamp
   or the credits can be corrected there, then gets marked resolved by hand.
   ------------------------------------------------------------------ */

function when(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

interface ReportsReviewProps {
  reports: Report[];
  /** Jump to this report's entry in the library. */
  onOpen: (soloId: string) => void;
  onResolved: (report: Report) => void;
}

export function ReportsReview({ reports, onOpen, onResolved }: ReportsReviewProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = [...reports.filter((r) => r.status === "open")].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );
  const resolved = [...reports.filter((r) => r.status === "resolved")].slice(-10).reverse();

  async function setStatus(report: Report, status: "open" | "resolved") {
    setBusyId(report.id);
    setError(null);
    try {
      const response = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not do that");
      onResolved(data.report as Report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not do that");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h2 className="type-display text-3xl text-paper">{t("reports.title")}</h2>
      <p className="type-data mt-2 text-xs text-paper-faint">
        {open.length > 0 ? t("reports.open", { n: open.length }) : t("reports.none")}
      </p>

      {error && <p className="type-body mt-4 text-sm text-flame">{error}</p>}

      <ul className="mt-8 space-y-4">
        {open.map((report) => (
          <li key={report.id} className="border border-ink-edge p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="type-display text-xl text-paper">
                {report.artist} — {report.song}
              </h3>
              <span className="type-data text-xs text-paper-faint">
                {when(report.submittedAt)}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="type-eyebrow border border-flame px-2 py-1 text-flame">
                {t(`reports.kind.${report.kind}`)}
              </span>
              <span className="type-data text-xs text-paper-faint">{report.catalog}</span>
              {report.count > 1 && (
                <span className="type-data text-xs text-paper-faint">
                  {t("reports.count", { n: report.count })}
                </span>
              )}
            </div>

            {report.note && (
              <p className="type-body mt-3 border-l-2 border-flame pl-3 text-sm text-paper-dim">
                {report.note}
              </p>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onOpen(report.soloId)}
                className="type-eyebrow bg-flame px-5 py-3 text-ink transition-colors hover:bg-paper"
              >
                {t("reports.openRecord")}
              </button>
              <button
                type="button"
                onClick={() => setStatus(report, "resolved")}
                disabled={busyId !== null}
                className="type-eyebrow ml-auto border border-ink-edge px-5 py-3 text-paper-dim transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
              >
                {busyId === report.id ? t("reports.resolving") : t("reports.resolve")}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {resolved.length > 0 && (
        <ul className="mt-12 border-t border-ink-edge pt-6">
          {resolved.map((report) => (
            <li
              key={report.id}
              className="flex flex-wrap items-baseline gap-x-3 border-b border-ink-edge py-3"
            >
              <span className="type-body text-sm text-paper-dim">
                {report.artist} — {report.song}
              </span>
              <span className="type-eyebrow text-paper-faint">{t(`reports.kind.${report.kind}`)}</span>
              <button
                type="button"
                onClick={() => setStatus(report, "open")}
                className="type-eyebrow ml-auto text-paper-faint transition-colors hover:text-flame"
              >
                {t("reports.reopen")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
