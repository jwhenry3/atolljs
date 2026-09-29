// @vitest-environment happy-dom
/**
 * `vueIslandApp` — a Vue component rendered inside the worker through
 * `createRenderer` onto the proxy DOM. In-process E2E like the echo suite:
 * real registry + real op protocol, the only fake being the thread
 * boundary.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/sdk/testing/inProcessWorker';
import { connectIslandWorker, mountIsland } from '@atolljs/islands';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./fixtures/counter.worker')];

// In-process artifact: once a worker instance mounts, ambient `document` can
// resolve to its PROXY document (shared globalThis) — capture the real one
// before any mounts. Real browsers never share globals across threads.
let realDoc: Document;
beforeAll(() => {
  realDoc = document;
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/counter.worker.ts', import.meta.url), { type: 'module' });

describe('vueIslandApp', () => {
  it('mounts real DOM, patches on updateProps, and relays dispatch + emit', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const emitted: Array<{ name: string; payload: unknown }> = [];
    const client = connectIslandWorker({ worker: renderWorker });

    const island = await mountIsland({
      client,
      el,
      app: 'counter',
      props: { label: 'hits' },
      onEvent: (name, payload) => emitted.push({ name, payload }),
    });
    expect(island.pid).toMatch(/^w-/);

    // Mount replayed the worker's op batch into real DOM.
    const button = el.querySelector('button.inc') as HTMLElement;
    const valueEl = el.querySelector('.value') as HTMLElement;
    expect(button?.textContent).toBe('+');
    expect(valueEl?.textContent).toBe('hits: 0');

    // updateProps → fine-grained patch: textContent changes and the SAME
    // element instance survives (no clear/rebuild).
    await island.updateProps({ label: 'score' });
    expect(el.querySelector('.value')?.textContent).toBe('score: 0');
    expect(el.querySelector('.value')).toBe(valueEl);
    expect(el.querySelector('button.inc')).toBe(button);

    // Click → driver dispatch → worker handler → Vue re-render. Vue's
    // scheduler commits on a microtask after the dispatch task drains, so
    // the ops land on the instance queue — flush() (or the doorbell in push
    // mode) delivers them. The emit op DID ride back in the dispatch batch.
    button.dispatchEvent(new (realDoc.defaultView as typeof window).MouseEvent('click', { bubbles: true }));
    await vi.waitFor(async () => {
      await island.flush();
      expect(el.querySelector('.value')?.textContent).toBe('score: 1');
    });
    expect(
      emitted.some(
        (e) => e.name === 'incremented' && (e.payload as { count: number }).count === 1,
      ),
    ).toBe(true);
    // Still the same element — the update patched text, not the tree.
    expect(el.querySelector('.value')).toBe(valueEl);

    // Unmount → worker teardown.
    const worker = InProcessWorker.created.at(-1)!;
    island.destroy();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });

  it('carries .once on the wire and anchors a conditional branch on a comment node', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const client = connectIslandWorker({ worker: renderWorker });

    const island = await mountIsland({
      client,
      el,
      app: 'controls',
      props: { show: false },
    });

    // False branch mounts through createComment → ProxyComment → an empty
    // text node driver-side: invisible, but a real anchor for insert/remove.
    const stable = el.querySelector('.stable') as HTMLElement;
    expect(stable?.textContent).toBe('stable');
    expect(el.querySelector('.branch')).toBeNull();

    // Toggling the branch via updateProps swaps element ↔ comment anchor
    // in place; the trailing sibling's identity survives both directions.
    await island.updateProps({ show: true });
    expect(el.querySelector('.branch')?.textContent).toBe('shown');
    expect(el.querySelector('.stable')).toBe(stable);

    await island.updateProps({ show: false });
    expect(el.querySelector('.branch')).toBeNull();
    expect(el.querySelector('.stable')).toBe(stable);

    await island.updateProps({ show: true });
    expect(el.querySelector('.branch')?.textContent).toBe('shown');
    expect(el.querySelector('.stable')).toBe(stable);

    // @click.once: the listen op carried opts.once — the driver attached a
    // real once-listener AND the worker's ProxyElement auto-detaches after
    // the first dispatch. A second click must not reach the handler.
    const onceBtn = el.querySelector('button.once') as HTMLElement;
    const MouseEventCtor = (realDoc.defaultView as typeof window).MouseEvent;
    onceBtn.dispatchEvent(new MouseEventCtor('click', { bubbles: true }));
    await vi.waitFor(async () => {
      await island.flush();
      expect(el.querySelector('.once-value')?.textContent).toBe('once: 1');
    });

    onceBtn.dispatchEvent(new MouseEventCtor('click', { bubbles: true }));
    // Give any (unexpected) dispatch + re-render a chance to land, then
    // assert the count did NOT move.
    await island.flush();
    await vi.waitFor(async () => {
      await island.flush();
      expect(el.querySelector('.once-value')?.textContent).toBe('once: 1');
    });

    const worker = InProcessWorker.created.at(-1)!;
    island.destroy();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });

  it('insertStaticContent lands v-once/static HTML as real DOM', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const client = connectIslandWorker({ worker: renderWorker });

    const island = await mountIsland({ client, el, app: 'static' });
    // The static vnode's HTML string parsed through a <template> and its
    // children moved into the live tree — both nodes present, ordered
    // before the dynamic sibling.
    expect(el.querySelector('b.frozen')?.textContent).toBe('never re-renders');
    expect(el.querySelector('i.also-frozen')?.textContent).toBe('two');
    expect(el.querySelector('.live')?.textContent).toBe('live sibling');

    island.destroy();
  });

  it('v-model works end-to-end: vModelText/vModelCheckbox directives round-trip input', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const client = connectIslandWorker({ worker: renderWorker });

    const island = await mountIsland({ client, el, app: 'vmodel' });
    const textIn = el.querySelector('input.text-in') as HTMLInputElement;
    const checkIn = el.querySelector('input.check-in') as HTMLInputElement;
    // Directive's beforeMount wrote the model value onto the element.
    expect(textIn.value).toBe('initial');
    expect(el.querySelector('.echo')?.textContent).toBe('initial:false');

    // Type → real input event → worker directive's listener → _assign →
    // the onUpdate:modelValue prop (skipped by patchProp, consumed by the
    // directive in-worker) → ref → re-render.
    textIn.value = 'typed here';
    textIn.dispatchEvent(new (realDoc.defaultView as typeof window).Event('input', { bubbles: true }));
    await vi.waitFor(async () => {
      await island.flush();
      expect(el.querySelector('.echo')?.textContent).toBe('typed here:false');
    });

    checkIn.checked = true;
    checkIn.dispatchEvent(new (realDoc.defaultView as typeof window).Event('change', { bubbles: true }));
    await vi.waitFor(async () => {
      await island.flush();
      expect(el.querySelector('.echo')?.textContent).toBe('typed here:true');
    });

    island.destroy();
  });

  it('Teleport resolves `to` inside the island via the querySelector host op', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const client = connectIslandWorker({ worker: renderWorker });

    const island = await mountIsland({ client, el, app: 'teleport' });
    // Teleported to the instance body — lands inside the island element as a
    // sibling of the app's root, not inside .tele-app.
    const beamed = el.querySelector('b.beamed') as HTMLElement;
    expect(beamed?.textContent).toBe('beamed in');
    expect(el.querySelector('.tele-app b.beamed')).toBeNull();
    // The teleport's source position stays anchored by its comment.
    expect(el.querySelector('.after')?.textContent).toBe('anchor sibling');
    island.destroy();
  });
});
