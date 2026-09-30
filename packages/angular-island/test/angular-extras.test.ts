// @vitest-environment happy-dom
/**
 * `angularIslandApp` extras — the worker-side edges the spectrum suite
 * doesn't reach, mounted over the real op protocol via InProcessWorker:
 *
 *   svg       namespaced elements (`<svg:*>` → createElementNS) and
 *             namespaced attribute set/remove (`[attr.xlink:href]` → null).
 *   sanitize  `[innerHTML]` routes through the Sanitizer provider stub.
 *   err       a throwing listener → INTERNAL_APPLICATION_ERROR_HANDLER.
 *   docbody   `(document:x)` / `(body:x)` host listener targets.
 *   fallback  a non-enumerable `input()` field → the setProps signal-node
 *             fallback, plus an undeclared prop name → drop-and-warn.
 *   cfg       the `{ component, providers }` registry-entry form.
 *   sleepy    a post-destroy scheduler notify hits the componentRef guard.
 *   mono      `defineAngularMonoWorker` nameless mounts + `angularIsland`
 *             stamped registration through the shared registry.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { connectIslandWorker, mountIsland } from '@atolljs/islands';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('./fixtures/extras.worker'),
  () => import('./fixtures/mono.worker'),
];

const renderWorker = () =>
  new Worker(new URL('./fixtures/extras.worker.ts', import.meta.url), { type: 'module' });
const monoWorker = () =>
  new Worker(new URL('./fixtures/mono.worker.ts', import.meta.url), { type: 'module' });

let realDoc: Document;
beforeAll(() => {
  realDoc = document;
});

function host(): HTMLElement {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
}

const mount = (
  el: HTMLElement,
  app: string,
  props: Record<string, unknown> = {},
) =>
  mountIsland({
    client: connectIslandWorker({ worker: renderWorker }),
    el,
    app,
    props,
  });

const click = (el: ParentNode, selector: string): void => {
  (el.querySelector(selector) as HTMLElement).dispatchEvent(
    new MouseEvent('click', { bubbles: true }),
  );
};

const text = (el: ParentNode, selector: string): string | null | undefined =>
  el.querySelector(selector)?.textContent;

describe('namespaced elements and attributes', () => {
  it('renders svg:* via createElementNS and removes xlink:href on null', async () => {
    const el = host();
    const island = await mount(el, 'svg');

    const svg = el.querySelector('.chart')!;
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    const link = el.querySelector('.link')!;
    expect(link.getAttribute('xlink:href')).toBe('#target');
    expect(el.querySelector('.dot')!.getAttribute('r')).toBe('3');
    expect(text(el, '.cap')).toBe('go');

    // [attr.xlink:href]="null" → IslandRenderer.removeAttribute(…, 'xlink')
    // → the proxy's removeAttributeNS path.
    click(el, '.unlink');
    await vi.waitFor(() =>
      expect(link.getAttribute('xlink:href')).toBeNull(),
    );
    island.destroy();
  });
});

describe('[innerHTML] sanitizer', () => {
  it('writes and swaps sanitized html', async () => {
    const el = host();
    const island = await mount(el, 'sanitize');

    await vi.waitFor(() => expect(el.querySelector('.san .bold')).not.toBeNull());
    click(el, '.swap');
    await vi.waitFor(() => {
      expect(el.querySelector('.san .bold')).toBeNull();
      expect(el.querySelector('.san .ital')).not.toBeNull();
    });
    island.destroy();
  });
});

describe('listener error surface', () => {
  it('routes a throwing (click) handler to the error handler', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = host();
    const island = await mount(el, 'err');

    await vi.waitFor(() => expect(el.querySelector('.boom')).not.toBeNull());
    click(el, '.boom');
    await vi.waitFor(() =>
      expect(
        spy.mock.calls.some((args) =>
          args.some((a) => String(a).includes('listener exploded')),
        ),
      ).toBe(true),
    );
    island.destroy();
    spy.mockRestore();
  });
});

describe('(document:)/(body:) host listeners', () => {
  it('document and body targets attach through the proxy', async () => {
    const el = host();
    const island = await mount(el, 'docbody');
    await vi.waitFor(() => expect(text(el, '.hits')).toBe('doc:0 body:0'));

    // document/window/body listeners land on the island container (id 0) —
    // a bubbling event inside the island reaches them.
    el.dispatchEvent(new Event('custom-doc', { bubbles: true }));
    await vi.waitFor(() => expect(text(el, '.hits')).toBe('doc:1 body:0'));

    el.dispatchEvent(new Event('custom-body', { bubbles: true }));
    await vi.waitFor(() => expect(text(el, '.hits')).toBe('doc:1 body:1'));
    island.destroy();
  });
});

describe('setProps fallback', () => {
  it('writes non-enumerable signal inputs and warns on unknown names', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = host();
    const island = await mount(el, 'fallback', { extra: 'via-fallback', bogus: 1 });

    await vi.waitFor(() => expect(text(el, '.extra')).toBe('via-fallback'));
    await vi.waitFor(() =>
      expect(
        spy.mock.calls.some((args) =>
          args.some((a) => String(a).includes('bogus')),
        ),
      ).toBe(true),
    );

    // The same fallback path serves fine-grained updateProps too.
    await island.updateProps({ extra: 'again' });
    await vi.waitFor(() => expect(text(el, '.extra')).toBe('again'));
    island.destroy();
    spy.mockRestore();
  });
});

describe('{ component, providers } registry entries', () => {
  it('builds the app injector with the entry providers', async () => {
    const el = host();
    const island = await mount(el, 'cfg');
    await vi.waitFor(() => expect(text(el, '.flavor')).toBe('mango'));
    island.destroy();
  });
});

describe('post-dispose scheduler notify', () => {
  it('a signal write that lands after destroy hits the dead-ref guard', async () => {
    const el = host();
    const island = await mount(el, 'sleepy');
    await vi.waitFor(() => expect(text(el, '.ticks')).toBe('0'));

    click(el, '.arm'); // arm the deferred signal write
    island.destroy(); // unmount before the 25ms timer fires

    // The timer → signal write → scheduler notify runs AFTER dispose; the
    // queued tick must find componentRef === null and return quietly — no
    // ops are applied, so the rendered text stays at its pre-arm value.
    await new Promise((r) => setTimeout(r, 60));
    expect(text(el, '.ticks')).toBe('0');
  });
});

describe('mono-worker registration', () => {
  it('nameless mounts resolve the single registered app', async () => {
    const el = host();
    const island = await mountIsland({
      client: connectIslandWorker({ worker: monoWorker }),
      el,
      props: { label: 'nameless' },
    });
    await vi.waitFor(() => expect(text(el, '.mono-label')).toBe('mono:nameless'));
    island.destroy();
  });

  it('an angularIsland-stamped app mounts by name through the same worker', async () => {
    const el = host();
    const island = await mountIsland({
      client: connectIslandWorker({ worker: monoWorker }),
      el,
      app: 'ngMono',
      props: { label: 'stamped' },
    });
    await vi.waitFor(() => expect(text(el, '.mono-label')).toBe('mono:stamped'));
    island.destroy();
  });
});
