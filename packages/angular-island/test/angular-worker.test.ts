// @vitest-environment happy-dom
/**
 * `angularIslandApp` — a standalone Angular component rendered inside the
 * island worker by the proxy-DOM RendererFactory2. In-process E2E: real
 * registry + op protocol, the only fake being the thread boundary
 * (InProcessWorker runs the real worker entry in the test's module graph).
 *
 * The worker entry imports '@angular/compiler' so the decorator component's
 * JIT compilation works; `createComponent` + the proxy `RendererFactory2` do
 * the rest — no platform-browser, no zone.js, no TestBed on this side.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { connectIslandWorker, mountIsland } from '@jwhenry123/mesh-islands';
import { InProcessWorker } from '@jwhenry123/mesh/sdk/testing/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/counter.worker')];

const renderWorker = () =>
  new Worker(new URL('./fixtures/counter.worker.ts', import.meta.url), { type: 'module' });

// In-process artifact: once a instance mounts, ambient globalThis.document can
// resolve to the PROXY document — capture the real one for assertions.
let realDoc: Document;
beforeAll(() => {
  realDoc = document;
});

describe('angularIslandApp', () => {
  it('mounts a standalone component, round-trips click + updateProps, unmounts', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const emitted: Array<{ name: string; payload: unknown }> = [];

    const client = connectIslandWorker({ worker: renderWorker });
    const island = await mountIsland({
      client,
      el,
      props: { label: 'island counter' },
      onEvent: (name, payload) => emitted.push({ name, payload }),
    });

    // Initial render — the component host carries its selector tag, the
    // input() arrived via setInput inside mount().
    await vi.waitFor(() =>
      expect(el.querySelector('mesh-counter .label')?.textContent).toBe('island counter'),
    );
    expect(el.querySelector('.count')?.textContent).toBe('0');
    expect(island.pid).toMatch(/^w-/);

    // Click → listen op's handler dispatches into the worker → the wrapped
    // listener runs change detection synchronously → ops ride the dispatch
    // batch back: real DOM update, plus the emit op for onEvent.
    el.querySelector('.inc')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(el.querySelector('.count')?.textContent).toBe('1'));
    await vi.waitFor(() =>
      expect(emitted.some((e) => e.name === 'incremented')).toBe(true),
    );
    expect(
      (emitted.find((e) => e.name === 'incremented')?.payload as { n: number }).n,
    ).toBe(1);

    // updateProps → setInput('label', …) + detectChanges → patched in place.
    await island.updateProps({ label: 'relabelled' });
    await vi.waitFor(() =>
      expect(el.querySelector('.label')?.textContent).toBe('relabelled'),
    );
    // The rest of the tree survived (fine-grained update, not a rebuild).
    expect(el.querySelector('.count')?.textContent).toBe('1');

    // Destroy → component teardown + unmount → last island out terminates.
    const worker = InProcessWorker.created.at(-1)!;
    island.destroy();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });
});
