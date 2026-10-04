// @vitest-environment happy-dom
/**
 * initDevtools gating — ?__atoll_devtools in the URL (or ATOLL_DEVTOOLS env
 * without a location) decides whether anything installs at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDevtoolsSink } from '@atolljs/core';
import { devtoolsEnabled, initDevtools, DEVTOOLS_PARAM } from '../src/init';
import type { InitDevtools } from '../src/init';

describe('initDevtools', () => {
  let init: InitDevtools | null = null;

  afterEach(() => {
    init?.conn.close();
    init?.overlay?.unmount();
    init = null;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    setDevtoolsSink(null);
    document.body.replaceChildren();
  });

  it('is a no-op without the URL param — no sink, no overlay', () => {
    // happy-dom location.search is '' — devtoolsEnabled is false.
    init = initDevtools();
    expect(init).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('activates on ?__atoll_devtools — connects and mounts the flyout', () => {
    vi.stubGlobal('location', { search: `?${DEVTOOLS_PARAM}`, href: 'https://app.test/' });
    init = initDevtools({ network: false, memory: false });
    expect(init).not.toBeNull();
    expect(init!.conn.session.runtime).toBe('browser');
    expect(init!.overlay).not.toBeNull();
    expect(document.querySelector('iframe')).not.toBeNull();
  });

  it('explicit enabled wins over the URL gate', () => {
    expect(initDevtools({ enabled: false })).toBeNull();
    init = initDevtools({ enabled: true, overlay: false, network: false, memory: false });
    expect(init).not.toBeNull();
    // overlay:false — connected without the flyout.
    expect(init!.overlay).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('passes overlay options through to the flyout', () => {
    vi.stubGlobal('location', { search: '?x=1', href: 'https://app.test/' });
    init = initDevtools({
      enabled: true,
      overlay: { position: 'topleft', startOpen: true },
      network: false,
      memory: false,
    });
    const p = document.querySelector('div') as HTMLElement;
    expect(p.style.display).toBe('flex');
    expect(p.style.left).toBe('16px');
    expect(p.style.top).toBe('16px');
  });

  it('falls back to the ATOLL_DEVTOOLS env var when there is no location', () => {
    vi.stubGlobal('location', undefined);
    // Node path also has no window — the overlay is skipped by design.
    vi.stubGlobal('window', undefined);
    expect(devtoolsEnabled()).toBe(false);
    vi.stubEnv('ATOLL_DEVTOOLS', '1');
    expect(devtoolsEnabled()).toBe(true);
    init = initDevtools({ transport: 'broadcast', network: false, memory: false });
    expect(init).not.toBeNull();
    expect(init!.conn.session.runtime).toBe('node');
    expect(init!.overlay).toBeNull();
  });

  it('node subpath exposes the same API without the overlay surface', async () => {
    const node = await import('@atolljs/devtools/node');
    expect(node.initDevtools).toBe(initDevtools);
    expect(node.DEVTOOLS_PARAM).toBe(DEVTOOLS_PARAM);
  });
});
