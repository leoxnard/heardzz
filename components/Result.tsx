"use client";

import { useEffect, useState } from "react";
import { formatSnippet } from "@/lib/audio";
import { formatCountdown, msUntilTomorrow } from "@/lib/daily";
import { t } from "@/lib/i18n";
import type { RoundState, Solo } from "@/lib/types";

interface ResultProps {
  solo: Solo;
  state: RoundState;
  heardMs: number;
  share: string;
  isDaily: boolean;
  keysHint: string;
  onPlayFull: () => void;
  onNext?: () => void;
}

export function Result({
  solo, state, heardMs, share, isDaily, keysHint, onPlayFull, onNext,
}: ResultProps) {
  const won = state.status === "won";
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);

  useEffect(() => {
    if (!isDaily) return;
    const update = () => setCountdown(formatCountdown(msUntilTomorrow()));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [isDaily]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(share);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <div className={`inline-block px-3 py-1 ${won ? "bg-flame text-ink" : "border border-paper-faint text-paper-dim"}`}>
        <span className="type-eyebrow">{won ? t("result.won") : t("result.lost")}</span>
      </div>

      <p className="type-body mt-4 text-sm text-paper-dim">
        {won && `${t("result.wonIn", { n: state.attempts.length })} · `}
        {t("result.heardFor", { ms: formatSnippet(heardMs) })}
      </p>

      <dl className="mt-8 border-t border-ink-edge">
        <div className="border-b border-ink-edge py-4">
          <dt className="type-eyebrow text-paper-faint">{t("result.answerArtist")}</dt>
          <dd className="type-display mt-2 text-3xl text-paper">{solo.artist}</dd>
        </div>
        <div className="border-b border-ink-edge py-4">
          <dt className="type-eyebrow text-paper-faint">{t("result.answerSong")}</dt>
          <dd className="type-display mt-2 text-3xl text-paper">{solo.song}</dd>
          <dd className="type-body mt-1 text-sm text-paper-dim">{solo.album}</dd>
        </div>
        <div className="border-b border-ink-edge py-4">
          <dt className="type-eyebrow text-paper-faint">{t("result.soloBy")}</dt>
          <dd className="type-body mt-2 text-base text-paper-dim">
            {solo.soloist}
          </dd>
        </div>
      </dl>

      <p className="type-data mt-4 text-xs text-paper-faint">
        {t("result.recordedIn", { year: solo.year || "—", label: solo.label || "—" })}
      </p>

      {solo.note && (
        <p className="type-body mt-6 border-l-2 border-flame pl-4 text-sm text-paper-dim">
          {solo.note}
        </p>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onPlayFull}
          className="type-eyebrow border border-paper-faint px-5 py-3 text-paper transition-colors duration-150 hover:border-flame hover:text-flame"
        >
          {t("result.listenFull")}
        </button>

        <button
          type="button"
          onClick={copy}
          className="type-eyebrow bg-paper px-5 py-3 text-ink transition-colors duration-150 hover:bg-flame"
        >
          {copied ? t("result.shared") : t("result.share")}
        </button>

        <a
          href={`https://www.youtube.com/watch?v=${solo.youtubeId}&t=${Math.max(0, Math.floor(solo.soloStart))}s`}
          target="_blank"
          rel="noreferrer"
          className="type-eyebrow border border-ink-edge px-5 py-3 text-paper-dim transition-colors duration-150 hover:border-paper-faint hover:text-paper"
        >
          {t("result.openSource")}
        </a>
      </div>

      <p className="type-data mt-4 text-xs text-paper-faint">{keysHint}</p>

      <pre className="type-data mt-6 whitespace-pre-wrap border border-ink-edge bg-ink-raised p-4 text-xs leading-relaxed text-paper-dim">
        {share}
      </pre>

      {isDaily && countdown && (
        <p className="type-data mt-6 text-xs text-paper-faint">
          {t("result.nextDaily", { time: countdown })}
        </p>
      )}

      {!isDaily && onNext && (
        <button
          type="button"
          onClick={onNext}
          className="type-eyebrow mt-6 w-full bg-flame px-5 py-4 text-ink transition-colors duration-150 hover:bg-paper"
        >
          {t("result.playAnother")}
        </button>
      )}
    </div>
  );
}
