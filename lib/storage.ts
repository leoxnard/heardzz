"use client";

import { useCallback, useEffect, useState } from "react";
import { CONFIG_STORAGE_KEY, DAILY_STORAGE_KEY, DEFAULT_CONFIG, STATS_STORAGE_KEY, clampConfig, type GameConfig } from "./config";
import { EMPTY_STATS, STATS_VERSION } from "./game";
import type { DailyRecord, Stats } from "./types";

/**
 * Persisted state, kept per-device. Reads are deferred to an effect so the
 * server-rendered markup and the first client render agree — otherwise every
 * stored value hydrates as a mismatch.
 */
function usePersisted<T>(key: string, fallback: T, revive?: (raw: unknown) => T) {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Reading localStorage is exactly the "subscribe to an external store"
    // case the rule exists to protect; the read has to be deferred to an
    // effect or the server markup and the first client render disagree.
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setValue(revive ? revive(parsed) : (parsed as T));
      }
    } catch {
      /* corrupt or unavailable storage falls back to the default */
    }
    setLoaded(true);
    // revive is stable in every call site here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (c: T) => T)(current) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          /* private browsing, quota, or storage disabled */
        }
        return resolved;
      });
    },
    [key],
  );

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* nothing to do */
    }
    setValue(fallback);
    // fallback is a module constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { value, setValue: update, clear, loaded };
}

export function useConfig() {
  const { value, setValue, clear, loaded } = usePersisted<GameConfig>(
    CONFIG_STORAGE_KEY,
    DEFAULT_CONFIG,
    (raw) => clampConfig(raw as Partial<GameConfig>),
  );

  const patch = useCallback(
    (changes: Partial<GameConfig>) => setValue((current) => clampConfig({ ...current, ...changes })),
    [setValue],
  );

  return { config: value, patch, reset: clear, loaded };
}

export function useStats() {
  const { value, setValue, clear, loaded } = usePersisted<Stats>(
    STATS_STORAGE_KEY,
    EMPTY_STATS,
    /*
     * The distribution used to count attempts and now counts the rung a
     * round was solved on. Same array, different meaning — so an old one is
     * thrown away rather than relabelled, while the totals and the streak,
     * which mean exactly what they always did, are kept.
     */
    (raw) => {
      const stats = raw as Stats;
      if (stats?.version === STATS_VERSION) return stats;
      return { ...EMPTY_STATS, ...stats, version: STATS_VERSION, distribution: [] };
    },
  );
  return { stats: value, setStats: setValue, resetStats: clear, loaded };
}

export function usePracticeIndex() {
  const { value, setValue } = usePersisted<number>("heardzz:practice:v1", 0);
  return { index: value, advance: () => setValue((n) => n + 1) };
}

export function useDailyRecord() {
  const { value, setValue, loaded } = usePersisted<DailyRecord | null>(DAILY_STORAGE_KEY, null);
  return { record: value, setRecord: setValue, loaded };
}
