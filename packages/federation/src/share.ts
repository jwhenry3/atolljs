/**
 * The shared-dependency scope — a realm-level registry on `globalThis` that
 * every module loaded into the same worker can read, regardless of which
 * bundle carried it. This is the "shared" half of federation: the host
 * worker publishes framework singletons (react, a design system, a store)
 * once, and remote app modules resolve the SAME objects instead of
 * evaluating their own bundled copies.
 *
 * Scoping is per-realm, not per-page: each worker is its own module realm,
 * so two federation hosts on one page each hold their own scope. That is
 * the correct unit — a shared module instance can only ever live inside
 * one worker's heap.
 *
 * `__atollShared` is deliberately a plain global (not a module-level Map):
 * remote chunks may bundle their own copy of this file, and module-identity
 * forks must not fork the scope.
 */
export interface SharedEntry {
  /** The live module object — a namespace record, a class, a store. */
  module: unknown;
  /** The version the provider declares — matched against remote `requires`. */
  version: string;
}

const GLOBAL_KEY = '__atollShared';

type Scope = Record<string, SharedEntry | undefined>;

const scope = (): Scope => {
  const g = globalThis as Record<string, unknown>;
  if (typeof g[GLOBAL_KEY] !== 'object' || g[GLOBAL_KEY] === null) {
    g[GLOBAL_KEY] = {} satisfies Scope;
  }
  return g[GLOBAL_KEY] as Scope;
};

/**
 * Publish a module into the realm's shared scope. Called by
 * `defineFederationHost` for its `shared` option before any remote module
 * imports; remote authors can also call it directly (a remote that
 * provides as well as consumes). Re-providing a name at a different
 * version warns and keeps the FIRST entry — last-write-wins would let a
 * late remote silently swap the realm's singleton out from under earlier
 * consumers.
 */
export const provideShared = (name: string, module: unknown, version = '0'): void => {
  const existing = scope()[name];
  if (existing !== undefined) {
    if (existing.version !== version || existing.module !== module) {
      console.warn(
        `[federation] shared dep "${name}" already provided (v${existing.version}) — ` +
          `ignoring re-provide of v${version}`,
      );
    }
    return;
  }
  scope()[name] = { module, version };
};

/**
 * Read a shared dep. Throws when absent — a remote that can't see its
 * declared deps must fail at load, not undefined-property-crash mid-render.
 * `range` narrows the read to a compatible provider (see
 * `satisfiesVersion`).
 */
export const useShared = <T = unknown>(name: string, range?: string): T => {
  const entry = scope()[name];
  if (entry === undefined) {
    throw new Error(
      `[federation] shared dep "${name}" is not provided in this realm — ` +
        `the federation host must declare it in its \`shared\` option`,
    );
  }
  if (range !== undefined && !satisfiesVersion(entry.version, range)) {
    throw new Error(
      `[federation] shared dep "${name}" is provided at v${entry.version} — ` +
        `this module requires "${range}"`,
    );
  }
  return entry.module as T;
};

/** The provided version of a shared dep (undefined when unprovided). */
export const sharedVersionOf = (name: string): string | undefined => scope()[name]?.version;

/** Snapshot of the scope as name → version — for manifests and devtools. */
export const sharedDeps = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [name, entry] of Object.entries(scope())) {
    if (entry !== undefined) out[name] = entry.version;
  }
  return out;
};

/**
 * Pragmatic semver-ish matcher for `requires` ranges — deliberately small,
 * not a general resolver. Supports `*`/empty, exact `x.y.z` (shorter forms
 * zero-pad), `^`, `~`, and `>=`. Anything else falls back to string
 * equality so exotic ranges fail loudly rather than silently pass.
 */
export const satisfiesVersion = (version: string, range: string): boolean => {
  const r = range.trim();
  if (r === '*' || r === '') return true;
  const m = /^(\^|~|>=)?\s*(\d+(?:\.\d+){0,2})$/.exec(r);
  if (m === null) return version.trim() === r;
  const toTuple = (v: string): [number, number, number] => {
    const p = v.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
  };
  const v = toTuple(version);
  const b = toTuple(m[2]);
  const cmp = v[0] - b[0] || v[1] - b[1] || v[2] - b[2];
  switch (m[1]) {
    case '>=':
      return cmp >= 0;
    case '^':
      return v[0] === b[0] && cmp >= 0;
    case '~':
      return v[0] === b[0] && v[1] === b[1] && cmp >= 0;
    default:
      return cmp === 0;
  }
};
