/**
 * URL-gated devtools: `initDevtools()` is a no-op unless the app was
 * opened with `?__atoll_devtools` in the URL (Node: `ATOLL_DEVTOOLS`
 * env). When enabled it connects the broadcast transport and mounts the
 * overlay flyout — one line in the app, nothing when uninvited:
 *
 *   import { initDevtools } from '@atolljs/devtools';
 *   initDevtools({ session: { name: 'my-app' } });
 *
 *   my-app/?__atoll_devtools        → devtools on
 *   my-app/                         → zero cost, no sink installed
 */
import { connectDevtools, type ConnectDevtoolsOptions, type DevtoolsConnection } from './client';
import { mountDevtoolsOverlay, type DevtoolsOverlay, type DevtoolsOverlayOptions } from './overlay';

export const DEVTOOLS_PARAM = '__atoll_devtools';

/** Whether devtools should activate in this context. */
export const devtoolsEnabled = (enabled?: boolean): boolean => {
  if (enabled !== undefined) return enabled;
  if (typeof location !== 'undefined' && typeof location.search === 'string') {
    return new URLSearchParams(location.search).has(DEVTOOLS_PARAM);
  }
  // Node — no URL to gate on; honor the env var instead.
  return !!(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.ATOLL_DEVTOOLS;
};

export interface InitDevtoolsOptions extends ConnectDevtoolsOptions {
  /** Force on/off — defaults to the ?__atoll_devtools URL param. */
  enabled?: boolean;
  /** Overlay flyout — default true in a browser window; pass options or false. */
  overlay?: boolean | DevtoolsOverlayOptions;
}

export interface InitDevtools {
  conn: DevtoolsConnection;
  overlay: DevtoolsOverlay | null;
}

export function initDevtools(opts: InitDevtoolsOptions = {}): InitDevtools | null {
  if (!devtoolsEnabled(opts.enabled)) return null;
  const conn = connectDevtools(opts);
  const inWindow = typeof window !== 'undefined' && typeof window.document !== 'undefined';
  const overlay =
    inWindow && opts.overlay !== false
      ? mountDevtoolsOverlay(typeof opts.overlay === 'object' ? opts.overlay : {})
      : null;
  return { conn, overlay };
}
