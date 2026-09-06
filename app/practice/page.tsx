import { Game } from "@/components/Game";
import { loadSolos } from "@/lib/library";

export const dynamic = "force-dynamic";

export default async function PracticePage() {
  const solos = (await loadSolos()).filter((solo) => !solo.disabled);
  return <Game solos={solos} mode="practice" />;
}
