import { Game } from "@/components/Game";
import { loadSolos } from "@/lib/library";

// The library is a file on disk that the CLI and the library screen both
// write to, so it is read per request rather than baked into the build.
export const dynamic = "force-dynamic";

export default async function DailyPage() {
  const solos = await loadSolos();
  return <Game solos={solos} mode="daily" />;
}
