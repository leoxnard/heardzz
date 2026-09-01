import { notFound } from "next/navigation";
import { LibraryAdmin } from "@/components/admin/LibraryAdmin";
import { isAdminEnabled } from "@/lib/admin-guard";
import { loadSolos } from "@/lib/library";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Writing to disk and shelling out to yt-dlp belongs on a laptop, nowhere else.
  if (!isAdminEnabled) notFound();

  const solos = await loadSolos();
  return <LibraryAdmin initial={solos} />;
}
