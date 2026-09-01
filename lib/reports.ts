import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPORTS_PATH } from "./paths";
import type { Report, ReportStore } from "./types";

const EMPTY: ReportStore = { version: 1, reports: [] };

export async function readReports(): Promise<ReportStore> {
  try {
    const raw = await readFile(REPORTS_PATH, "utf8");
    const parsed = JSON.parse(raw) as ReportStore;
    return {
      version: parsed.version ?? 1,
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

async function writeReports(store: ReportStore): Promise<void> {
  await mkdir(path.dirname(REPORTS_PATH), { recursive: true });
  await writeFile(REPORTS_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

/**
 * File a report, or bump the count on one already open.
 *
 * The same complaint about the same record, filed twice, is not two things
 * to look into — it is one thing that more than one person hit. Collapsing
 * it here is what keeps the admin list a list of problems rather than a log
 * of clicks.
 */
export async function addReport(
  entry: Omit<Report, "id" | "submittedAt" | "status" | "count">,
): Promise<Report> {
  const store = await readReports();

  const existing = store.reports.find(
    (r) => r.soloId === entry.soloId && r.kind === entry.kind && r.status === "open",
  );
  if (existing) {
    existing.count += 1;
    // A fresh note is worth keeping even when the count was already rising.
    if (entry.note) existing.note = entry.note;
    await writeReports(store);
    return existing;
  }

  const report: Report = {
    ...entry,
    id: `${entry.soloId}-${Date.now().toString(36)}`,
    count: 1,
    submittedAt: new Date().toISOString(),
    status: "open",
  };
  store.reports.push(report);
  await writeReports(store);
  return report;
}

export async function updateReport(id: string, changes: Partial<Report>): Promise<Report | null> {
  const store = await readReports();
  const index = store.reports.findIndex((r) => r.id === id);
  if (index === -1) return null;

  store.reports[index] = { ...store.reports[index], ...changes, id };
  await writeReports(store);
  return store.reports[index];
}

export async function openCount(): Promise<number> {
  const { reports } = await readReports();
  return reports.filter((r) => r.status === "open").length;
}
