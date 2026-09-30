// @vitest-environment happy-dom
/**
 * svelteIslandApp listener compat — the adapter patches proxy
 * addEventListener/removeEventListener (element proto + per-document) to
 * add a flushSync tail and dedupe the double id-0 forwarding Svelte's
 * mount performs ([target, document] both land on the driver-side
 * container). The fixture registers/duplicates/dedupes/removes listeners
 * at init and via buttons; every handler emits over onEvent so the test
 * counts actual worker-side invocations.
 *
 * NOTE: the known second-mount bug (see svelte-double.test.ts) limits this
 * file to ONE svelteMount — all assertions share the single 'listeners'
 * island.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import type { IslandHandle } from '@atolljs/islands';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/extras.worker')];

let mountIsland: typeof import('@atolljs/islands').mountIsland;
let connectIslandWorker: typeof import('@atolljs/islands').connectIslandWorker;
let realDoc: Document;
beforeAll(async () => {
  realDoc = document;
  ({ connectIslandWorker, mountIsland } = await import('@atolljs/islands'));
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/extras.worker.ts', import.meta.url), { type: 'module' });

const fire = (el: ParentNode, type: string): void => {
  el.dispatchEvent(new Event(type, { bubbles: true }));
};

describe('listener compat', () => {
  it('dedupes id-0 forwarding, wraps removals, honors once', async () => {
    const host = realDoc.createElement('div');
    realDoc.body.appendChild(host);
    const emitted: string[] = [];
    const island: IslandHandle = await mountIsland({
      client: connectIslandWorker({ worker: renderWorker }),
      el: host,
      app: 'listeners',
      onEvent: (name) => emitted.push(name),
    });
    await vi.waitFor(() => expect(host.querySelector('.rm-doc')).not.toBeNull());

    // document-level listener → one emit per event despite the doubled
    // init-time registration.
    fire(host, 'atoll-doc');
    await vi.waitFor(() =>
      expect(emitted.filter((e) => e === 'doc-heard')).toHaveLength(1),
    );

    // The same fn registered on document AND body lands once — the second
    // claim deduped to null.
    fire(host, 'atoll-shared');
    await vi.waitFor(() =>
      expect(emitted.filter((e) => e === 'shared-heard')).toHaveLength(1),
    );

    // { once: true } — fires exactly once, then the auto-removal runs
    // through the patched removeEventListener.
    fire(host, 'atoll-once');
    await vi.waitFor(() =>
      expect(emitted.filter((e) => e === 'once-heard')).toHaveLength(1),
    );
    fire(host, 'atoll-once');
    await new Promise((r) => setTimeout(r, 40));
    expect(emitted.filter((e) => e === 'once-heard')).toHaveLength(1);

    // body listener attached on the id-0 element surface.
    fire(host, 'atoll-body');
    await vi.waitFor(() =>
      expect(emitted.filter((e) => e === 'body-heard')).toHaveLength(1),
    );

    // Removing the body listener through the id-0 release path — a second
    // event no longer reaches the worker.
    host.querySelector('.rm-body')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(emitted).toContain('body-removed'));
    fire(host, 'atoll-body');
    await new Promise((r) => setTimeout(r, 40));
    expect(emitted.filter((e) => e === 'body-heard')).toHaveLength(1);

    // Removing the wrapped document listener stops its dispatch.
    host.querySelector('.rm-doc')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(emitted).toContain('doc-removed'));
    fire(host, 'atoll-doc');
    await new Promise((r) => setTimeout(r, 40));
    expect(emitted.filter((e) => e === 'doc-heard')).toHaveLength(1);

    // Removing the deduped (null-wrapped) body registration is a no-op —
    // the shared handler still fires through its document-side claim.
    host.querySelector('.rm-shared')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(emitted).toContain('shared-body-removed'));
    fire(host, 'atoll-shared');
    await vi.waitFor(() =>
      expect(emitted.filter((e) => e === 'shared-heard')).toHaveLength(2),
    );

    island.destroy();
  });
});
