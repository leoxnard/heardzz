import { notFound, redirect } from "next/navigation";
import { LibraryAdmin } from "@/components/admin/LibraryAdmin";
import { missingAudioTargets } from "@/scripts/extract.mjs";
import { adminAvailable, isAdmin } from "@/lib/auth";
import { loadSolos } from "@/lib/library";
import { readReports } from "@/lib/reports";
import { readSuggestions } from "@/lib/suggestions";

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

  // A fresh volume has the library but none of the audio it names. Counted
  // by file rather than by entry, so a record's shared head clip is one
  // thing missing, not one per soloist on it.
  const missingAudio = missingAudioTargets(solos).length;

  return (
    <LibraryAdmin
      initial={solos}
      suggestions={suggestions}
      reports={reports}
      missingAudio={missingAudio}
    />
  );
}
