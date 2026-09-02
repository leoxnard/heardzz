import { notFound, redirect } from "next/navigation";
import { ForYou } from "@/components/ForYou";
import { adminAvailable, isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Behind the admin guard while the idea is being tried out.
 *
 * Opening it would mean this server downloading from YouTube whenever a
 * stranger asks it to, which is a different thing from fetching the records
 * you chose yourself — in load, in cost, and in what it is doing on your
 * behalf. That decision is worth making separately from whether the mode
 * is any fun.
 */
export default async function ForYouPage() {
  if (!adminAvailable()) notFound();
  if (!(await isAdmin())) redirect("/login");
  return <ForYou />;
}
