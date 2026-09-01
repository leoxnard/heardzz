import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SUGGESTIONS_PATH } from "./paths";
import type { Suggestion, SuggestionStore } from "./types";

const EMPTY: SuggestionStore = { version: 1, suggestions: [] };

export async function readSuggestions(): Promise<SuggestionStore> {
  try {
    const raw = await readFile(SUGGESTIONS_PATH, "utf8");
    const parsed = JSON.parse(raw) as SuggestionStore;
    return {
      version: parsed.version ?? 1,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function writeSuggestions(store: SuggestionStore): Promise<void> {
  await mkdir(path.dirname(SUGGESTIONS_PATH), { recursive: true });
  await writeFile(SUGGESTIONS_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function addSuggestion(suggestion: Suggestion): Promise<Suggestion> {
  const store = await readSuggestions();

  // The same record put forward twice is one suggestion, not two.
  const existing = store.suggestions.find(
    (s) => s.youtubeId === suggestion.youtubeId && s.status === "pending",
  );
  if (existing) return existing;

  store.suggestions.push(suggestion);
  await writeSuggestions(store);
  return suggestion;
}

export async function updateSuggestion(
  id: string,
  changes: Partial<Suggestion>,
): Promise<Suggestion | null> {
  const store = await readSuggestions();
  const index = store.suggestions.findIndex((s) => s.id === id);
  if (index === -1) return null;

  store.suggestions[index] = { ...store.suggestions[index], ...changes, id };
  await writeSuggestions(store);
  return store.suggestions[index];
}

export async function pendingCount(): Promise<number> {
  const { suggestions } = await readSuggestions();
  return suggestions.filter((s) => s.status === "pending").length;
}
