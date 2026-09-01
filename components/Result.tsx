"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  const soloist = solo.soloist || solo.artist;
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
        {soloist && soloist !== solo.artist && (
          <div className="border-b border-ink-edge py-4">
            <dt className="type-eyebrow text-paper-faint">{t("result.answerSoloist")}</dt>
            <dd className="type-display mt-2 text-3xl text-paper">{soloist}</dd>
            {solo.soloistRole && (
              <dd className="type-body mt-1 text-sm text-paper-dim">{solo.soloistRole}</dd>
            )}
          </div>
        )}
        {solo.personnel.length > 0 && (
          <div className="border-b border-ink-edge py-4">
            <dt className="type-eyebrow text-paper-faint">{t("result.personnel")}</dt>
            <dd className="mt-3">
              <ul className="space-y-1">
                {solo.personnel.map((credit) => {
                  // The soloist is the one you were actually listening to;
                  // the rest of the band is context.
                  const solos = credit.name === soloist;
                  return (
                    <li key={credit.name} className="flex flex-wrap gap-x-3 text-sm">
                      <span className={solos ? "type-body font-semibold text-flame" : "type-body text-paper"}>
                        {credit.name}
                      </span>
                      {credit.role && (
                        <span className="type-body text-paper-faint">{credit.role}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </dd>
          </div>
        )}
      </dl>

      {solo.year > 0 && (
        <p className="type-data mt-4 text-xs text-paper-faint">
          {t("result.recordedIn", { year: solo.year })}
        </p>
      )}

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
        <>
          <p className="type-data mt-6 text-xs text-paper-faint">
            {t("result.nextDaily", { time: countdown })}
          </p>
          <Link
            href="/practice"
            className="type-eyebrow mt-4 block w-full bg-flame px-5 py-4 text-center text-ink transition-colors duration-150 hover:bg-paper"
          >
            {t("result.tryPractice")}
          </Link>
        </>
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
