import { ForYou } from "@/components/ForYou";
import { tidalAvailable } from "@/lib/tidal";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Open to anyone, and rate-limited rather than guarded.
 *
 * Every round here is a download this server makes because a visitor asked
 * it to, so the ceilings in the two routes are not a formality — they are
 * the thing that keeps an open page from being an open tab on somebody
 * else's bandwidth.
 *
 * Without TIDAL credentials the mode cannot work at all, so it does not
 * exist rather than existing and failing at the first click.
 */
export default function ForYouPage() {
  if (!tidalAvailable()) notFound();
  return <ForYou />;
}
