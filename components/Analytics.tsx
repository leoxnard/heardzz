import Script from "next/script";

import { UMAMI_DOMAINS, UMAMI_SRC, UMAMI_WEBSITE_ID } from "@/lib/analytics";

/**
 * Loads the Umami tracker from our own analytics host.
 *
 * Umami hooks the History API itself, so client-side route changes are counted
 * without a router effect here — do not add one, it would double-count.
 */
export default function Analytics() {
  return (
    <Script
      src={UMAMI_SRC}
      data-website-id={UMAMI_WEBSITE_ID}
      data-domains={UMAMI_DOMAINS}
      strategy="afterInteractive"
    />
  );
}
