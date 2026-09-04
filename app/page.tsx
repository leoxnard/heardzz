import { Game } from "@/components/Game";
import { loadSolos } from "@/lib/library";

// The library is a file on disk that the CLI and the library screen both
// write to, so it is read per request rather than baked into the build.
export const dynamic = "force-dynamic";

export default async function DailyPage() {
  const solos = await loadSolos();
  /* One round for everybody, at one level: a shared result only means
     something if everybody was asked the same question. */
  return <Game solos={solos} mode="daily" fixedLevel="standard" />;
}
