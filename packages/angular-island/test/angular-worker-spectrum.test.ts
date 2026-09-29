// @vitest-environment happy-dom
/**
 * `angularIslandApp` component-spectrum E2E — a registry worker serving one
 * app per Angular feature area, mounted over the real op protocol via
 * InProcessWorker (same module graph, so the fixture's exported
 * `lifecycleLog` doubles as the worker-side assertion channel).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectIslandWorker, mountIsland } from '@atolljs/islands';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import { lifecycleLog } from './fixtures/spectrum.worker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('./fixtures/spectrum.worker'),
  () => import('./fixtures/aot.worker'),
];

const renderWorker = () =>
  new Worker(new URL('./fixtures/spectrum.worker.ts', import.meta.url), { type: 'module' });

let realDoc: Document;
beforeAll(() => {
  realDoc = document;
});
beforeEach(() => {
  lifecycleLog.length = 0;
});

/** A fresh island container per mount — the instance root's real element. */
function host(): HTMLElement {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  return el;
}

const mount = (el: HTMLElement, app: string, props: Record<string, unknown> = {}) =>
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

describe('@if / @for control flow', () => {
  it('toggles branches, renders/moves/empties a tracked list', async () => {
    const el = host();
    const island = await mount(el, 'flow');

    await vi.waitFor(() => expect(text(el, '.on')).toBe('ON'));
    expect(el.querySelector('.off')).toBeNull();
    expect(el.querySelectorAll('.row')).toHaveLength(3);
    expect(el.querySelector('.empty')).toBeNull();

    // @else branch swaps in through the comment-anchor path.
    click(el, '.toggle');
    await vi.waitFor(() => expect(text(el, '.off')).toBe('OFF'));
    expect(el.querySelector('.on')).toBeNull();

    click(el, '.toggle');
    await vi.waitFor(() => expect(text(el, '.on')).toBe('ON'));

    // Append a row.
    click(el, '.add');
    await vi.waitFor(() => expect(el.querySelectorAll('.row')).toHaveLength(4));

    // Reorder via `track row.id` — Angular moves the SAME DOM nodes, it does
    // not recreate them (LiveCollection insertBefore semantics).
    const firstLi = el.querySelectorAll('.row')[0];
    click(el, '.reverse');
    await vi.waitFor(() =>
      expect(
        [...el.querySelectorAll('.row')].map((r) => r.getAttribute('data-id')),
      ).toEqual(['4', '3', '2', '1']),
    );
    expect(el.querySelectorAll('.row')[3]).toBe(firstLi);

    // @empty branch appears when the collection empties, and @for resumes.
    click(el, '.clear');
    await vi.waitFor(() => expect(text(el, '.empty')).toBe('empty'));
    expect(el.querySelectorAll('.row')).toHaveLength(0);

    island.destroy();
  });
});

describe('content projection', () => {
  it('projects parent markup into child ng-content slots, stays live', async () => {
    const el = host();
    const island = await mount(el, 'projection', { title: 'slot demo' });

    await vi.waitFor(() => expect(text(el, '.head .title')).toBe('slot demo'));
    expect(text(el, '.body .para')).toBe('projected 0');

    // The projected binding updates in the DECLARING (parent) view.
    click(el, '.para');
    await vi.waitFor(() => expect(text(el, '.body .para')).toBe('projected 1'));

    await island.updateProps({ title: 're-titled' });
    await vi.waitFor(() => expect(text(el, '.head .title')).toBe('re-titled'));

    island.destroy();
  });
});

describe('dependency injection', () => {
  it('shares a providedIn-root service parent↔child, honors options.providers', async () => {
    const el = host();
    const island = await mount(el, 'di');

    // Provided through angularIslandApp's `providers` option.
    await vi.waitFor(() => expect(text(el, '.greeting')).toBe('hola island'));
    expect(text(el, '.count')).toBe('0');

    // The child's button mutates the injected store the parent reads.
    click(el, '.bump');
    await vi.waitFor(() => expect(text(el, '.count')).toBe('1'));

    island.destroy();
  });
});

describe('lifecycle + afterRenderEffect', () => {
  it('runs hooks in order across mount, updateProps, destroy', async () => {
    const el = host();
    const island = await mount(el, 'lifecycle', { greeting: 'hello' });

    await vi.waitFor(() => expect(text(el, '.greeting')).toBe('hello'));
    expect(lifecycleLog).toContain('ngOnChanges:greeting');
    expect(lifecycleLog).toContain('ngOnInit');
    // The initial render lands ngOnChanges/ngOnInit before the first
    // afterRender pass (ApplicationRef.synchronize order).
    expect(lifecycleLog.indexOf('ngOnInit')).toBeLessThan(
      lifecycleLog.indexOf('afterRenderEffect:hello'),
    );
    expect(lifecycleLog).toContain('afterRenderEffect:hello');

    await island.updateProps({ greeting: 'again' });
    await vi.waitFor(() => expect(text(el, '.greeting')).toBe('again'));
    // A new input triggers ngOnChanges, and the effect's tracked greeting()
    // read re-fires it with the new value.
    expect(
      lifecycleLog.filter((l) => l === 'ngOnChanges:greeting').length,
    ).toBeGreaterThan(1);
    expect(lifecycleLog).toContain('afterRenderEffect:again');

    island.destroy();
    await vi.waitFor(() => expect(lifecycleLog).toContain('ngOnDestroy'));
  });
});

describe('model()/output() two-way binding', () => {
  it('round-trips model inputs and child-to-parent output wiring', async () => {
    const el = host();
    const emitted: Array<{ name: string; payload: unknown }> = [];
    const client = connectIslandWorker({ worker: renderWorker });
    const island = await mountIsland({
      client,
      el,
      app: 'model',
      props: { name: 'prop-name' },
      onEvent: (name, payload) => emitted.push({ name, payload }),
    });

    // model() field written through the adapter's setInput/signal path.
    await vi.waitFor(() => expect(text(el, '.name')).toBe('prop-name'));
    expect(text(el, '.mirror')).toBe('child: off');

    // Child click: model write mirrors into the parent's bound signal AND
    // fires output() — component events stay worker-internal; the shell
    // channel only sees them because the handler also calls emit().
    click(el, '.flip');
    await vi.waitFor(() => expect(text(el, '.mirror')).toBe('child: on'));
    expect(text(el, 'atoll-two-way .flip')).toBe('on');
    await vi.waitFor(() =>
      expect(emitted.some((e) => e.name === 'flipped')).toBe(true),
    );

    // Back down again — same nodes patched, not rebuilt.
    click(el, '.flip');
    await vi.waitFor(() => expect(text(el, '.mirror')).toBe('child: off'));

    // updateProps → model() input round trip.
    await island.updateProps({ name: 'second' });
    await vi.waitFor(() => expect(text(el, '.name')).toBe('second'));

    island.destroy();
  });
});

describe('class/style/attr/property bindings', () => {
  it('applies [class], [class.x], [style], [style.x.px], [attr.x], [prop]', async () => {
    const el = host();
    const island = await mount(el, 'bindings');
    const box = () => el.querySelector('.box') as HTMLElement;
    const flag = () => el.querySelector('.flag') as HTMLInputElement;
    const inp = () => el.querySelector('.text') as HTMLInputElement;

    await vi.waitFor(() => expect(box()).not.toBeNull());
    expect(box().className).toBe('box base dim');
    expect(box().classList.contains('active')).toBe(false);
    expect(box().style.width).toBe('120px');
    expect(box().style.opacity).toBe('0.5');
    expect(box().style.color).toBe('red');
    expect(box().getAttribute('data-state')).toBe('idle');
    expect(box().getAttribute('aria-hidden')).toBe('false');
    // [checked]/[disabled]/[value] ride the `update` op's property-write path.
    expect(flag().checked).toBe(true);
    expect(flag().disabled).toBe(false);
    expect(inp().value).toBe('typed');

    click(el, '.activate');
    await vi.waitFor(() => expect(box().classList.contains('active')).toBe(true));
    expect(box().className).toBe('box base lit active');
    expect(box().style.width).toBe('240px');
    expect(box().style.opacity).toBe('1');
    expect(box().style.color).toBe('blue');
    expect(box().style.fontSize).toBe('18px'); // style-map 'font-size.px' key
    expect(box().getAttribute('data-state')).toBe('live');
    expect(flag().checked).toBe(false); // prop cleared, attribute removed
    expect(flag().disabled).toBe(true); // prop set, attribute present
    expect(inp().value).toBe('retyped');

    island.destroy();
  });
});

describe('pipes', () => {
  it('runs built-in pipes, including AsyncPipe via the scheduler tick', async () => {
    const el = host();
    const island = await mount(el, 'pipes');

    await vi.waitFor(() => expect(text(el, '.upper')).toBe('ISLAND'));
    expect(text(el, '.year')).toBe('2024');
    // AsyncPipe marks the view for check when of() emits — the
    // ChangeDetectionScheduler stub's queued tick is what renders it.
    await vi.waitFor(() => expect(text(el, '.async')).toBe('resolved'));

    island.destroy();
  });
});

describe('host bindings + (window:) listeners', () => {
  it('binds host attrs/classes/listeners, resolves the window facade', async () => {
    const el = host();
    const island = await mount(el, 'hostBind');
    const hostEl = () => el.querySelector('atoll-host-bind') as HTMLElement;

    await vi.waitFor(() => expect(hostEl()).not.toBeNull());
    expect(hostEl().getAttribute('role')).toBe('button');
    expect(text(el, '.state')).toBe('safe');

    // (click) on the component host — listen op on the host element.
    hostEl().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(hostEl().classList.contains('armed')).toBe(true));
    expect(hostEl().getAttribute('aria-pressed')).toBe('true');
    expect(text(el, '.state')).toBe('armed');

    // (window:resize) — resolved through doc.defaultView's facade; the op
    // lands on the island's root container, which is `el` itself.
    el.dispatchEvent(new Event('resize', { bubbles: false }));
    await vi.waitFor(() => expect(hostEl().classList.contains('resized')).toBe(true));

    island.destroy();
  });
});

describe('out-of-band invalidation', () => {
  it('renders signal writes made inside timers (scheduler microtask tick)', async () => {
    const el = host();
    const island = await mount(el, 'async');
    island.setMode('push'); // arm the doorbell subscription

    await vi.waitFor(() => expect(text(el, '.ticks')).toBe('0'));
    click(el, '.schedule');
    // The interval's signal.set calls notify the ChangeDetectionScheduler
    // stub → queued microtask detectChanges → ops → doorbell push.
    await vi.waitFor(() => expect(text(el, '.ticks')).toBe('3'), {
      timeout: 10_000,
    });

    island.destroy();
  });
});

describe('@defer', () => {
  it('probe: on-immediate block either renders or documents its failure', async () => {
    const el = host();
    const island = await mount(el, 'defer');
    // Give the defer machinery a beat (load → render is promise-driven).
    await island.flush();
    await new Promise((r) => setTimeout(r, 100));
    await island.flush();
    // eslint-disable-next-line no-console -- deliberate probe output
    console.log(
      `[defer probe] island DOM: ${el.innerHTML}`,
    );
    expect(el.querySelector('.deferred, .ph')).not.toBeNull();
    island.destroy();
  });
});

describe('AOT-shaped component (static ɵcmp, no compiler)', () => {
  it('mounts, binds inputs, renders listeners/interpolation', async () => {
    const el = host();
    const island = await mount(el, 'aot', { label: 'compiled' });

    await vi.waitFor(() => expect(text(el, 'atoll-aot .inc')).toBe('compiled: 0'));
    expect(text(el, 'atoll-aot .val')).toBe('0');
    expect((el.querySelector('atoll-aot .inc') as HTMLButtonElement).disabled).toBe(false);

    click(el, 'atoll-aot .inc');
    await vi.waitFor(() => expect(text(el, 'atoll-aot .val')).toBe('1'));
    expect(text(el, 'atoll-aot .inc')).toBe('compiled: 1');

    await island.updateProps({ label: 'aot-2' });
    await vi.waitFor(() => expect(text(el, 'atoll-aot .inc')).toBe('aot-2: 1'));

    island.destroy();
  });
});
