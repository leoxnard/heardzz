/*
================================================================================
ANALYTICS
================================================================================
Umami, self-hosted on analytics.leonardsima.de. The instance runs on the same
machine as the app, so nothing here ever leaves our own infrastructure.

The website id and host sit in this file rather than in an env var: the id is
visible in the served HTML anyway, and this way a deploy needs no configuration.
UMAMI_DOMAINS keeps a local dev server or a preview out of the stats.

Every route is a plain page name — no room codes, no share links — so there is
nothing in a URL to strip and Umami can count page views by itself.

RULE — never put personal data in an event. No guesses, no suggested records,
no admin identities. Counters and coarse categories only.
================================================================================
*/

export const UMAMI_SRC = "https://analytics.leonardsima.de/script.js";
export const UMAMI_WEBSITE_ID = "6a4a1fd1-75f9-48b9-acfe-f93f851bec6e";
export const UMAMI_DOMAINS = "heardzz.leonardsima.de";

type EventData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: EventData) => void;
    };
  }
}

/**
 * Records a custom event. Silently does nothing when the script hasn't loaded
 * yet or an ad blocker removed it.
 */
export const track = (event: string, data?: EventData): void => {
  if (typeof window === "undefined" || !window.umami) return;
  try {
    window.umami.track(event, data);
  } catch {
    // A failed measurement is worth less than the round in progress.
  }
};
