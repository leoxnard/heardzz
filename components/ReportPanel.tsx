"use client";

import { useState } from "react";
import { Overlay } from "./Overlay";
import { t } from "@/lib/i18n";
import type { ReportKind } from "@/lib/types";

/* ------------------------------------------------------------------
   A player's way of talking back.

   No login, no email thread — just this record, one of three problems, and
   an optional line about it. It posts and gets out of the way; nothing here
   promises a fix, only that someone will see it.
   ------------------------------------------------------------------ */

const KINDS: { value: ReportKind; label: "report.kindAudio" | "report.kindInfo" | "report.kindOther" }[] = [
  { value: "audio", label: "report.kindAudio" },
  { value: "info", label: "report.kindInfo" },
  { value: "other", label: "report.kindOther" },
];

export function ReportPanel({ soloId, onClose }: { soloId: string; onClose: () => void }) {
  const [kind, setKind] = useState<ReportKind>("audio");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setStatus("sending");
    setError(null);
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soloId, kind, note: note.trim() || undefined }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(response.status === 429 ? t("report.rateLimited") : data.error);
      }
      setStatus("sent");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error && cause.message ? cause.message : t("report.error"));
    }
  }

  return (
    <Overlay title={t("report.title")} onClose={onClose}>
      {status === "sent" ? (
        <p className="type-body text-sm text-paper">{t("report.sent")}</p>
      ) : (
        <div>
          <p className="type-body text-sm text-paper-dim">{t("report.intro")}</p>

          <div className="mt-5 space-y-2">
            {KINDS.map(({ value, label }) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-3 border px-4 py-3 transition-colors ${
                  kind === value ? "border-flame bg-ink-raised" : "border-ink-edge hover:border-paper-faint"
                }`}
              >
                <input
                  type="radio"
                  name="report-kind"
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="accent-flame"
                />
                <span className="type-body text-sm text-paper">{t(label)}</span>
              </label>
            ))}
          </div>

          <label className="mt-5 block">
            <span className="type-eyebrow text-paper-faint">{t("report.noteLabel")}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("report.notePlaceholder")}
              rows={3}
              maxLength={500}
              className="type-body mt-2 w-full resize-none border border-ink-edge bg-ink-raised px-3 py-3 text-sm text-paper focus:border-flame focus:outline-none"
            />
          </label>

          {error && <p className="type-body mt-4 text-sm text-flame">{error}</p>}

          <button
            type="button"
            onClick={send}
            disabled={status === "sending"}
            className="type-eyebrow mt-6 w-full bg-flame px-5 py-4 text-ink transition-colors hover:bg-paper disabled:opacity-40"
          >
            {status === "sending" ? t("report.sending") : t("report.submit")}
          </button>
        </div>
      )}
    </Overlay>
  );
}
