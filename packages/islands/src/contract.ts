/**
 * Island contracts — the framework-free seam between a micro-frontend's
 * worker and any shell.
 *
 * The contract module is the one file BOTH sides import: it names the
 * registry app, declares the props/events wire shape as `Schema`s (the
 * vendored `z` from `@atolljs/core`, consumer-supplied zod, or any
 * `{ parse }` validator), and can carry the worker factory so
 * `lazyIsland(() => import('./x.contract'))` is a self-contained split
 * point. No framework types cross it — a React shell mounting an Angular
 * app needs only this file.
 *
 * ```ts
 * // checkout.contract.ts — published by the MFE, imported by both threads
 * import { z } from '@atolljs/core';
 * import { defineIslandContract } from '@atolljs/islands';
 *
 * export const checkout = defineIslandContract({
 *   app: 'checkout',
 *   props: z.object({ label: z.string().optional() }),
 *   events: { paid: z.object({ total: z.number() }) },
 *   worker: () => new Worker(new URL('./checkout.worker.ts', import.meta.url), { type: 'module' }),
 * });
 * ```
 *
 * Enforcement is worker-side: mount/updateProps parse props AFTER
 * `unmarshalCallbackProps` restores `callbackProp` callables (declare those
 * members `z.callback<Fn>()`), and `emit` parses payloads for declared
 * event names. Undeclared event names pass through — a contract describes
 * the wire, it doesn't fence it (a newer worker emitting an event an older
 * shell doesn't know is normal evolution; a mismatched payload on a KNOWN
 * event is the violation).
 */
import type { Schema } from '@atolljs/core';

/** The brand property `defineIslandContract` stamps — a data property,
 *  like `islandAppName`, so it survives minification and `{...spread}`. */
const CONTRACT_MARK = 'islandContract';
/** The property `withContract` stamps on an app def — read at mount. */
const APP_CONTRACT = 'appContract';

/**
 * A mountable app contract: the registry key, the prop/event wire schemas,
 * and optionally the worker factory. `P`/`E` are the shell-facing types —
 * they ride the contract as pure type information, so consumers of a
 * framework-rendered island (an Angular component, a Vue SFC) get typed
 * props and narrowed `onEvent` without ever importing that framework.
 */
export interface IslandContract<
  P = Record<string, unknown>,
  E extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly islandContract: true;
  /** Registry key — the name `mountIsland({ app })` resolves to. */
  readonly app: string;
  /** Prop wire schema — enforced worker-side at mount and updateProps. */
  readonly props?: Schema<P>;
  /** Declared emit vocabulary — declared names' payloads parse at emit(). */
  readonly events?: { readonly [K in keyof E & string]: Schema<E[K]> };
  /** The worker factory — optional; when present the contract object itself
   *  is a lazy contract module (`{ app, worker }`). */
  readonly worker?: (() => Worker) | URL;
}

export function defineIslandContract<
  P = Record<string, unknown>,
  E extends Record<string, unknown> = Record<string, unknown>,
>(contract: {
  app: string;
  props?: Schema<P>;
  events?: { [K in keyof E & string]: Schema<E[K]> };
  worker?: (() => Worker) | URL;
}): IslandContract<P, E> {
  return { ...contract, [CONTRACT_MARK]: true as const };
}

/** Structural contract check — the brand, not the shape, so a hand-rolled
 *  `{ app, props }` without `defineIslandContract` stays an app reference. */
export const isIslandContract = (value: unknown): value is IslandContract =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<string, unknown>)[CONTRACT_MARK] === true;

/** The props a contract admits — `IslandContract<P>` → `P`. */
export type IslandContractProps<C> = C extends IslandContract<infer P, infer _E>
  ? P
  : Record<string, unknown>;

/** The event vocabulary a contract declares — name → payload map. */
export type IslandContractEvents<C> = C extends IslandContract<infer _P, infer E>
  ? E
  : Record<string, unknown>;

/**
 * The `onEvent` signature a contract implies — `(name, payload)` with the
 * payload narrowed per event name. Framework-free sibling of
 * `@atolljs/angular-island`'s `IslandEventHandler<C>`.
 */
export type IslandContractEventHandler<C> = <
  K extends keyof IslandContractEvents<C> & string,
>(
  name: K,
  payload: IslandContractEvents<C>[K],
) => void;

/**
 * `withContract(contract, app)` — attach a contract to a registry app
 * (imperative def or any framework adapter's `RenderedIslandApp`). The
 * stamp rides the app object like `islandAppName`; the worker reads it at
 * mount/updateProps for prop validation and hands it to `emit` for
 * declared-payload checks.
 *
 *   apps: {
 *     checkout: withContract(checkout, angularIslandApp(CheckoutComponent)),
 *   }
 */
export function withContract<C extends IslandContract, A>(contract: C, app: A): A {
  (app as Record<string, unknown>)[APP_CONTRACT] = contract;
  return app;
}

/** Read the contract a `withContract`-stamped app carries (undefined when
 *  unstamped — most registry entries). */
export const contractOf = (app: unknown): IslandContract | undefined => {
  if (typeof app !== 'object' && typeof app !== 'function') return undefined;
  if (app === null) return undefined;
  const c = (app as Record<string, unknown>)[APP_CONTRACT];
  return isIslandContract(c) ? c : undefined;
};

/** The worker factory a contract-carrying `app` reference supplies —
 *  mount seams fall back to it when no `worker`/`client` was passed, so
 *  `<Island app={contract}/>` and `islandComponent(contract)` are fully
 *  self-contained. */
export const contractWorkerOf = (app: unknown): (() => Worker) | URL | undefined =>
  isIslandContract(app) ? app.worker : undefined;
