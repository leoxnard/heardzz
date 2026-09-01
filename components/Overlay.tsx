"use client";

import { useEffect, useRef } from "react";
import { t } from "@/lib/i18n";

/** A panel over the game. Escape closes it, and focus starts inside. */
export function Overlay({
  title, onClose, children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={t("a11y.closeDialog")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/80"
      />

      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-md flex-col border-l border-ink-edge bg-ink focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-ink-edge px-6 py-4">
          <h2 className="type-display text-2xl text-paper">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="type-eyebrow text-paper-dim transition-colors hover:text-flame"
          >
            {t("settings.close")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-3">
      <span
        className={`mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center border transition-colors duration-150 ${
          checked ? "border-flame bg-flame" : "border-ink-edge bg-ink-raised"
        }`}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="h-3 w-3 text-ink" aria-hidden="true">
            <path d="M1 6.5 4.5 10 11 2" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <span className="type-body text-sm text-paper">{label}</span>
    </label>
  );
}
