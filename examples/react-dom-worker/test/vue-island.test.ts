// @vitest-environment happy-dom
/**
 * The demo's Vue island — `vue.worker.ts` runs a real Vue createRenderer
 * against the realm's proxy DOM. In-process E2E like islands.test.ts:
 * everything except the OS thread boundary is real. Also dogfoods the
 * `mountIsland({ worker })` shorthand (no connectIslandWorker call).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@jwhenry123/mesh/sdk/testing/inProcessWorker';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('../src/worker/vue.worker')];

let mountIsland: typeof import('@jwhenry123/mesh-worker-dom').mountIsland;
beforeAll(async () => {
  ({ mountIsland } = await import('@jwhenry123/mesh-worker-dom'));
});

const vueWorker = () =>
  new Worker(new URL('../src/worker/vue.worker.ts', import.meta.url), { type: 'module' });

const fire = (el: Element, event: Event): void => {
  el.dispatchEvent(event);
};

describe('vue island in the demo shell', () => {
  it('mounts via the worker shorthand, round-trips typing + add, and emits noteAdded', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const emitted: Array<{ name: string; payload: unknown }> = [];

    // `worker:` shorthand — no connectIslandWorker; the island owns its client.
    const island = await mountIsland({
      worker: vueWorker,
      el,
      app: 'vue-notes',
      props: { title: 'vue notes' },
      onEvent: (name, payload) => emitted.push({ name, payload }),
    });
    expect(island.pid).toMatch(/^w-/);
    // Push mode auto-subscribes the doorbell at mount — Vue's
    // microtask-scheduled commits (they land AFTER the dispatch task
    // returns) flush without any manual intervention.
    expect(island.mode).toBe('push');

    const heading = el.querySelector('.vanilla-heading')!;
    const input = el.querySelector('input')!;
    expect(heading.textContent).toBe('vue notes');
    expect(input).not.toBeNull();

    // Type into the input — each keystroke is a dispatch; e.target.value
    // (the DOM idiom) reads the stamped wire value worker-side.
    input.value = 'hello vue';
    fire(input, new Event('input', { bubbles: true }));

    // Click add — the note enters the worker-side list and patches back.
    // Vue's scheduler commits post-task, so the ops arrive via flush.
    fire(el.querySelector('button')!, new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(async () => {
      await island.flush();
      expect(el.querySelectorAll('.vanilla-log-line').length).toBe(1);
    });
    expect(el.querySelector('.vanilla-log-line')!.textContent).toBe('hello vue');
    expect(emitted.some((e) => e.name === 'noteAdded')).toBe(true);
    const added = emitted.find((e) => e.name === 'noteAdded')!.payload as {
      text: string;
      total: number;
    };
    expect(added).toEqual({ text: 'hello vue', total: 1 });

    // The draft cleared worker-side — the input's `value` prop patched back.
    await island.flush();
    expect(input.value).toBe('');

    // updateProps → Vue patch in place: same heading element, new text.
    await island.updateProps({ title: 'renamed' });
    expect(el.querySelector('.vanilla-heading')!.textContent).toBe('renamed');
    expect(el.querySelector('.vanilla-heading')).toBe(heading);

    const worker = InProcessWorker.created.at(-1)!;
    island.destroy();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });
});
