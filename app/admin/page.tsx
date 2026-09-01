import { existsSync } from "node:fs";
import path from "node:path";
import { notFound, redirect } from "next/navigation";
import { LibraryAdmin } from "@/components/admin/LibraryAdmin";
import { adminAvailable, isAdmin } from "@/lib/auth";
import { loadSolos } from "@/lib/library";
import { readReports } from "@/lib/reports";
import { readSuggestions } from "@/lib/suggestions";
import { AUDIO_DIR } from "@/lib/paths";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Without a password configured this screen does not exist, rather than
  // existing and being open.
  if (!adminAvailable()) notFound();
  if (!(await isAdmin())) redirect("/login");

  const [solos, { suggestions }, { reports }] = await Promise.all([
    loadSolos(),
    readSuggestions(),
    readReports(),
  ]);

  // A fresh volume has the library but none of the audio it names.
  const missingAudio = solos.filter(
    (solo) => !existsSync(path.join(AUDIO_DIR, `${solo.id}.mp3`)),
  ).length;

  return (
    <LibraryAdmin
      initial={solos}
      suggestions={suggestions}
      reports={reports}
      missingAudio={missingAudio}
    />
  );
}
