"use client";

import { useState } from "react";
import { t } from "@/lib/i18n";
import type { Solo } from "@/lib/types";

const BLANK = {
  target: "",
  artist: "",
  song: "",
  soloist: "",
  solo: "",
  album: "",
  year: "",
  label: "",
  note: "",
};

export function ImportForm({ onImported }: { onImported: (solo: Solo) => void }) {
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof BLANK>(key: K, value: (typeof BLANK)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Import failed");
      onImported(data.solo as Solo);
      setForm(BLANK);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h3 className="type-eyebrow text-flame">{t("library.add")}</h3>

      <div className="mt-4 space-y-4">
        <Field
          label={t("library.search")}
          value={form.target}
          onChange={(v) => set("target", v)}
          placeholder="Dexter Gordon Cheese Cake Go 1962"
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Artist — the answer"
            value={form.artist}
            onChange={(v) => set("artist", v)}
            required
          />
          <Field label="Song" value={form.song} onChange={(v) => set("song", v)} required />
          <Field
            label="Soloist — shown on reveal"
            value={form.soloist}
            onChange={(v) => set("soloist", v)}
          />
          <Field
            label={t("library.soloAt")}
            value={form.solo}
            onChange={(v) => set("solo", v)}
            placeholder="0:52"
            required
          />
          <Field label="Album" value={form.album} onChange={(v) => set("album", v)} />
          <Field label="Year" value={form.year} onChange={(v) => set("year", v)} />
          <Field label="Label" value={form.label} onChange={(v) => set("label", v)} />
        </div>

        <Field label="Note shown on reveal" value={form.note} onChange={(v) => set("note", v)} />
      </div>

      <button
        type="submit"
        disabled={busy}
        className="type-eyebrow mt-6 w-full bg-flame px-5 py-4 text-ink transition-colors hover:bg-paper disabled:opacity-40"
      >
        {busy ? t("library.importing") : t("library.add")}
      </button>

      {busy && (
        <p className="type-body mt-3 text-xs text-paper-faint">
          Downloading the source and cutting a 40 second window. This usually takes under a minute.
        </p>
      )}
      {error && <p className="type-body mt-3 text-sm text-flame">{error}</p>}
    </form>
  );
}

function Field({
  label, value, onChange, placeholder, required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="type-eyebrow text-paper-faint">{label}</span>
      <input
        type="text"
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="type-body mt-2 w-full border border-ink-edge bg-ink-raised px-3 py-3 text-sm text-paper focus:border-flame focus:outline-none"
      />
    </label>
  );
}
