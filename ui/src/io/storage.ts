/**
 * Remembering things between visits, on this machine only.
 *
 * Every access is guarded: private browsing can make even reading throw, and
 * failing to remember a preference is never worth breaking the page for.
 */

export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

function guarded(backing: () => globalThis.Storage): Storage {
  return {
    get(key) {
      try {
        return backing().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        backing().setItem(key, value);
      } catch {
        /* quota, or private browsing */
      }
    },
    remove(key) {
      try {
        backing().removeItem(key);
      } catch {
        /* as above */
      }
    },
  };
}

/** Survives a browser restart. For preferences, including the home address. */
export const localStore = guarded(() => localStorage);
/** Cleared when the tab closes. For derived data that is cheap to recompute. */
export const sessionStore = guarded(() => sessionStorage);

/** An in-memory Storage, for tests and for environments with neither. */
export function memoryStore(): Storage {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  };
}

export const ADDRESS_KEY = "hundeskove:address";
export const THEME_KEY = "hundeskove:theme";
export const DRIVE_CACHE_PREFIX = "hundeskove:drive:";
