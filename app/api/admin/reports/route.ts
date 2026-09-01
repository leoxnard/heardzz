import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { readReports, updateReport } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const store = await readReports();
  return NextResponse.json(store);
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as { id?: string; status?: "open" | "resolved" };
  if (!body.id || (body.status !== "open" && body.status !== "resolved")) {
    return NextResponse.json({ error: "id and status are required" }, { status: 400 });
  }

  const updated = await updateReport(body.id, { status: body.status });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ report: updated });
}
