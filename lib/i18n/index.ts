import { en, type Dictionary } from "./en";

export type Locale = "en";

const DICTIONARIES: Record<Locale, Dictionary> = { en };

export const DEFAULT_LOCALE: Locale = "en";

type Path<T> = T extends object
  ? { [K in keyof T]: K extends string ? K | `${K}.${Path<T[K]>}` : never }[keyof T]
  : never;

export type MessageKey = Path<Dictionary>;

function resolve(dict: unknown, key: string): string {
  const value = key.split(".").reduce<unknown>(
    (acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined),
    dict,
  );
  return typeof value === "string" ? value : key;
}

/**
 * t("round.attemptOf", { n: 2, total: 6 }) — placeholders are {name}.
 * Missing keys return the key itself rather than throwing, so a half-finished
 * translation degrades to something readable instead of a blank screen.
 */
export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const template = resolve(DICTIONARIES[locale], key);
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match,
  );
}
