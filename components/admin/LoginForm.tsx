"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t } from "@/lib/i18n";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Wrong password");
      router.replace("/admin");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wrong password");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <Link href="/" className="flex items-center gap-3">
          <span className="block h-4 w-4 bg-flame" aria-hidden="true" />
          <span className="type-display text-xl text-paper">{t("brand")}</span>
        </Link>

        <h1 className="type-display-tight mt-8 text-5xl text-paper">{t("login.title")}</h1>
        <p className="type-body mt-3 text-sm text-paper-dim">{t("login.intro")}</p>

        <label className="mt-8 block">
          <span className="type-eyebrow text-paper-faint">{t("login.password")}</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="type-body mt-2 w-full border border-ink-edge bg-ink-raised px-4 py-3 text-paper focus:border-flame focus:outline-none"
          />
        </label>

        <button
          type="submit"
          disabled={busy || !password}
          className="type-eyebrow mt-5 w-full bg-flame px-5 py-4 text-ink transition-colors hover:bg-paper disabled:opacity-40"
        >
          {busy ? t("login.signingIn") : t("login.signIn")}
        </button>

        {error && <p className="type-body mt-4 text-sm text-flame">{error}</p>}
      </form>
    </div>
  );
}
