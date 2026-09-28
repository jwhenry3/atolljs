// @vitest-environment happy-dom
/**
 * Functional test for the islands demo — three mountIsland() trees over
 * InProcessWorker, so everything except the OS thread boundary is real:
 * the registry, per-realm reconcilers, the op protocol, the emit channel,
 * and the shared-memory doorbell.
 *
 * One module instance plays every worker, so realms are keyed by app name —
 * exactly why mount/updateProps/flush/whoami carry the app on the wire.
 * A shared module graph also means every defined shared-memory contract ends
 * up bound to the LAST pool's buffer; doorbells therefore have to subscribe
 * after all mounts (island.ts documents the same call order for main.ts).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '../../../test/inProcessWorker';

/**
 * One React copy for the whole render stack. The suite aliases `react` to the
 * repo root's install, but the example's react-reconciler is externalized and
 * Node-resolves the EXAMPLE's react — two copies would null the hook
 * dispatcher. Re-point every 'react'/'react/jsx-runtime' import at the
 * example's own install (createRequire = the same require the externalized
 * reconciler uses) so apps, hostConfig, and reconciler share one instance.
 */
const requireFromExample = async () => {
  const { createRequire } = await import('node:module');
  const { join } = await import('node:path');
  // import.meta.url is a served http URL under the module runner — anchor at
  // the repo root (vitest cwd) instead.
  return createRequire(join(process.cwd(), 'examples/react-dom-worker/package.json'));
};
vi.mock('react', async () => {
  const mod = (await requireFromExample())('react') as Record<string, unknown>;
  return { ...mod, default: mod };
});
vi.mock('react/jsx-runtime', async () => {
  const mod = (await requireFromExample())('react/jsx-runtime') as Record<string, unknown>;
  return { ...mod, default: mod };
});

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('../src/worker/render.worker')];

let connectIslandWorker: typeof import('../src/island').connectIslandWorker;
let mountIsland: typeof import('../src/island').mountIsland;
beforeAll(async () => {
  // Imported after the Worker stub — the client factory builds pools lazily.
  ({ connectIslandWorker, mountIsland } = await import('../src/island'));
});

const fire = (el: Element, event: Event): void => {
  el.dispatchEvent(event);
};

describe('react-dom-worker islands', () => {
  it('mounts islands with distinct realms, mediates emit → updateProps, and flushes via the doorbell', async () => {
    const controlsEl = document.createElement('div');
    const tableEl = document.createElement('div');
    const statsEl = document.createElement('div');
    document.body.append(controlsEl, tableEl, statsEl);

    const emitted: Array<{ name: string; payload: unknown }> = [];

    // Same mediation as src/main.ts — controls → table, table → stats.
    const stats = await mountIsland({
      client: connectIslandWorker(),
      el: statsEl,
      app: 'stats',
      props: { visible: 2000, total: 2000 },
    });
    const table = await mountIsland({
      client: connectIslandWorker(),
      el: tableEl,
      app: 'data-table',
      props: { filter: '', desc: false },
      onEvent: (name, payload) => {
        emitted.push({ name, payload });
        const p = payload as { count?: number };
        if (name === 'rowsChanged') void stats.updateProps({ visible: p.count ?? 0, total: 2000 });
      },
    });
    const controls = await mountIsland({
      client: connectIslandWorker(),
      el: controlsEl,
      app: 'controls',
      onEvent: (name, payload) => {
        emitted.push({ name, payload });
        const p = payload as { filter?: string };
        if (name === 'filterChanged') void table.updateProps({ filter: p.filter ?? '', desc: false });
      },
    });

    /* distinct worker realms — the badge ids */
    expect(new Set([controls.pid, table.pid, stats.pid]).size).toBe(3);
    for (const pid of [controls.pid, table.pid, stats.pid]) expect(pid).toMatch(/^w-/);

    /* mount produced real DOM in each container */
    expect(controlsEl.querySelector('input')).not.toBeNull();
    expect(tableEl.querySelectorAll('tbody tr').length).toBe(2000);
    expect(statsEl.textContent).toContain('2000');

    /* island → shell → island: filter emits, table re-renders filtered rows */
    const input = controlsEl.querySelector('input')!;
    input.value = 'us-east';
    fire(input, new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(tableEl.querySelectorAll('tbody tr').length).toBe(400));
    expect(emitted.some((e) => e.name === 'filterChanged' && (e.payload as { filter: string }).filter === 'us-east')).toBe(true);

    /* the emit chain fed the stats island's props too */
    await vi.waitFor(() => expect(statsEl.textContent).toContain('400'));

    /* table emits rowSelected on click — island → shell, not a DOM op */
    fire(tableEl.querySelector('tbody tr')!, new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'rowSelected')).toBe(true));

    /* doorbell: StatsApp's useEffect commits outside a task — its opsVersion
       bump (plus the subscription's initial-value emit) triggers flush() on
       its own. No manual island.flush() is ever called. */
    const flushesBefore = stats.flushCalls;
    for (const island of [controls, table, stats]) island.setMode('push');
    await vi.waitFor(() => expect(statsEl.textContent).toContain('passive effects flushed'));
    expect(stats.flushCalls).toBeGreaterThan(flushesBefore);
  });

  it('mount() on an already-mounted app remounts — fresh batch, same pid', async () => {
    const client = connectIslandWorker();
    const first = await client.mount('controls', {});
    const pid = await client.whoami('controls');
    expect(first.some((op) => op.t === 'create')).toBe(true);

    const second = await client.mount('controls', {});
    // Remount replays a clear + full create set onto the emptied root.
    expect(second.some((op) => op.t === 'clear')).toBe(true);
    expect(second.some((op) => op.t === 'create')).toBe(true);
    expect(await client.whoami('controls')).toBe(pid); // pid survives a remount
    client.terminate();
  });

  it('mount() rejects unknown registry apps', async () => {
    const client = connectIslandWorker();
    await expect(client.mount('nope', {})).rejects.toThrow(/unknown app "nope"/);
    client.terminate();
  });
});
