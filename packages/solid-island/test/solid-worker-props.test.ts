// @vitest-environment happy-dom
/**
 * Prop-surface coverage for the Solid worker renderer — `setProperty`'s
 * whole prop-convention map driven through the real op protocol, the
 * wire-props proxy traps (`has`/`ownKeys`/`getOwnPropertyDescriptor`/`set`,
 * key removal), and every exported authoring primitive. Mounts come from
 * the `props.worker` registry plus the `mono.worker` 1:1 entry — two
 * `defineSolid*Worker` entry points, one in-process module graph.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
import { callbackProp, connectIslandWorker, mountIsland } from '@atolljs/islands';

vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [
  () => import('./fixtures/props.worker'),
  () => import('./fixtures/mono.worker'),
];

// In-process artifact: capture the real document before a instance's proxy
// document can claim the ambient global.
let realDoc: Document;
beforeAll(() => {
  realDoc = document;
});

const renderWorker = () =>
  new Worker(new URL('./fixtures/props.worker.ts', import.meta.url), { type: 'module' });

const mount = async (app: string, props: Record<string, unknown> = {}, onEvent?: (n: string, p: unknown) => void) => {
  const el = realDoc.createElement('div');
  realDoc.body.appendChild(el);
  const client = connectIslandWorker({ worker: renderWorker });
  const island = await mountIsland({ client, el, app, props, onEvent });
  return { el, island };
};

describe('solid worker renderer — prop surface', () => {
  it('writes every setProperty convention, then re-patches them with prev diffs', async () => {
    const emitted: Array<{ name: string; payload: unknown }> = [];
    const { el, island } = await mount(
      'propkit',
      {
        title: 't0',
        count: 1,
        aria: 'a0',
        pressed: true,
        bogus: 'not-a-fn',
        hidden: true,
        tagline: 'tg',
        track: 'trk',
        obj: { nested: true },
        cls: 'c1',
        list: { on: true, off: false },
        featured: true,
        cname: 'named',
        sty: { color: 'red', fontSize: '9px' },
        bw: '2px',
        text: 'txt',
        itext: 'itxt',
        html: '<b>bold</b>',
        dyn: 'd0',
        alt: false,
      },
      (name, payload) => emitted.push({ name, payload }),
    );

    const attrs = el.querySelector('[data-pk="attrs"]') as HTMLElement;
    expect(attrs.getAttribute('title')).toBe('t0');
    expect(attrs.getAttribute('data-count')).toBe('1');
    expect(attrs.getAttribute('aria-label')).toBe('a0');
    expect(attrs.getAttribute('aria-pressed')).toBe('true');
    // bool:hidden writes 'true' — the driver's reflected-property path
    // (`hidden` in node → node.hidden = 'true' → truthy) lands the
    // presence attribute; getAttribute reads ''.
    expect(attrs.hasAttribute('hidden')).toBe(true);
    // prop:/use: are worker-side expandos — no wire encoding, no attribute.
    expect(attrs.hasAttribute('tagline')).toBe(false);
    expect(attrs.hasAttribute('use:tracking')).toBe(false);
    // Object values have no attribute encoding — writeAttr drops them.
    expect(attrs.hasAttribute('data-obj')).toBe(false);
    expect(attrs.getAttribute('class')).toContain('c1');
    // ref fired during the mount batch.
    expect(emitted.some((e) => e.name === 'ref-claimed')).toBe(true);
    // children/key were swallowed — no 'ignored' text inside .pk-ref.
    expect(el.querySelector('.pk-ref')?.textContent).toBe('');

    const classy = el.querySelector('.pk-classy') as HTMLElement;
    expect(classy.classList.contains('on')).toBe(true);
    expect(classy.classList.contains('off')).toBe(false);
    expect(classy.classList.contains('featured')).toBe(true);
    expect((el.querySelector('.pk-cnamed') as HTMLElement).className).toContain('named');

    const styled = el.querySelector('.pk-styled') as HTMLElement;
    expect(styled.style.color).toBe('red');
    expect(styled.style.fontSize).toBe('9px');
    expect(styled.style.borderWidth).toBe('2px');

    expect(el.querySelector('.pk-text')?.textContent).toBe('txt');
    expect(el.querySelector('.pk-itext')?.textContent).toBe('itxt');
    expect(el.querySelector('.pk-html b')?.textContent).toBe('bold');
    // Marker-anchored text — 'dyn:d0' inserted BEFORE the marker span.
    const anchored = el.querySelector('.pk-anchor') as HTMLElement;
    expect(anchored.textContent).toBe('dyn:d0mk');
    expect(anchored.lastChild?.textContent).toBe('mk');

    // Deferred post-task work resolved through the ambient fallbacks.
    await vi.waitFor(async () => {
      await island.flush();
      expect(el.querySelector('.pk-late')?.textContent).toBe('late');
    });

    // Click → the `on:` binding's base handler fires.
    el.querySelector('.pk-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'click-base')).toBe(true));

    /* Re-patch: same nodes, every convention flipped. */
    const btn = el.querySelector('.pk-btn');
    await island.updateProps({
      // `title` omitted entirely — the key is REMOVED from the wire set →
      // its signal → undefined → writeAttr → removeAttribute.
      count: 2, // number → '2'
      aria: 'a1',
      pressed: false,
      hidden: false, // bool: → remove
      obj: 'stringified', // string → attribute appears
      cls: false, // → ''
      list: { off: true }, // 'on' removed, 'off' added
      featured: false,
      cname: 'renamed',
      sty: { color: 'blue' }, // fontSize cleared via prev-diff
      bw: '0px',
      text: null, // → ''
      itext: 'itxt2',
      html: '<i>ital</i>',
      dyn: 'd1', // marker-anchored text → replaceText
      alt: true, // rebinds on:click + onCustom
    });

    expect(attrs.hasAttribute('title')).toBe(false);
    expect(attrs.getAttribute('data-count')).toBe('2');
    expect(attrs.getAttribute('aria-label')).toBe('a1');
    expect(attrs.hasAttribute('aria-pressed')).toBe(false);
    expect(attrs.hasAttribute('hidden')).toBe(false);
    expect(attrs.getAttribute('data-obj')).toBe('stringified');
    expect(attrs.getAttribute('class')).not.toContain('c1');
    expect(classy.classList.contains('on')).toBe(false);
    expect(classy.classList.contains('off')).toBe(true);
    expect(classy.classList.contains('featured')).toBe(false);
    expect((el.querySelector('.pk-cnamed') as HTMLElement).className).toContain('renamed');
    expect(styled.style.color).toBe('blue');
    expect(styled.style.fontSize).toBe('');
    expect(styled.style.borderWidth).toBe('0px');
    expect(el.querySelector('.pk-text')?.textContent).toBe('');
    expect(el.querySelector('.pk-itext')?.textContent).toBe('itxt2');
    expect(el.querySelector('.pk-html i')?.textContent).toBe('ital');
    expect(anchored.textContent).toBe('dyn:d1mk');
    expect(el.querySelector('.pk-btn')).toBe(btn); // patch, not rebuild

    // The rebind detached the base handlers — the alt pair fires now.
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'click-alt')).toBe(true));

    btn!.dispatchEvent(new CustomEvent('custom', { bubbles: true }));
    await vi.waitFor(() => expect(emitted.some((e) => e.name === 'custom-alt')).toBe(true));
    expect(emitted.some((e) => e.name === 'custom-base')).toBe(false);

    // callbackProp'd callable: rides the wire as a {__cb} handle, lands as
    // a worker-side function — 'onBogus' attaches a listener for 'bogus'
    // whose invocations emit back to the marshalled shell function.
    let bogusCalls = 0;
    await island.updateProps({ bogus: callbackProp(() => bogusCalls++) });
    attrs.dispatchEvent(new CustomEvent('bogus'));
    await vi.waitFor(() => expect(bogusCalls).toBe(1));
    // A non-function replacement detaches the listener outright.
    await island.updateProps({ bogus: 'not-a-fn' });
    attrs.dispatchEvent(new CustomEvent('bogus'));
    await island.flush();
    expect(bogusCalls).toBe(1);

    /* style → string → removal → object again, through the same element. */
    await island.updateProps({ sty: 'color: green' });
    expect(styled.getAttribute('style')).toContain('color: green');
    await island.updateProps({ sty: false });
    expect(styled.hasAttribute('style')).toBe(false);
    await island.updateProps({ sty: { margin: '3px' } });
    expect(styled.style.margin).toBe('3px');
    // 'style:' key → null writes ''.
    await island.updateProps({ bw: null });
    expect(styled.style.borderWidth).toBe('');

    const worker = InProcessWorker.created.at(-1)!;
    island.destroy();
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });

  it('wire-props proxy mirrors the key set — has/ownKeys/descriptor/set/removal', async () => {
    const { el, island } = await mount('keyprobe', { a: 1, opt: 'x' });
    const probe = () => el.querySelector('.kp')?.textContent;

    // Mount-time key set — the swallowed `smuggled` write never landed.
    expect(probe()).toBe('y|a,opt|x');

    // Dropping a key → deleted from the set AND its signal → undefined.
    await island.updateProps({ a: 1 });
    expect(probe()).toBe('n|a|u');

    // Keys can come back (and new ones appear) — `ownKeys`/`has` track a
    // key-set signal, so 'extra' joining the set re-renders immediately.
    await island.updateProps({ a: 1, opt: 'z', extra: 'e' });
    expect(probe()).toBe('y|a,extra,opt|z');

    // Value changes still propagate through the per-key signals.
    await island.updateProps({ a: 1, opt: 'y', extra: 'e' });
    expect(probe()).toBe('y|a,extra,opt|y');

    island.destroy();
  });

  it('toolkit exercises every exported authoring primitive', async () => {
    const { el, island } = await mount('toolkit', { tag: 'x' });

    expect(el.querySelector('.made')?.textContent).toBe('made:x');
    const made = el.querySelector('.made') as HTMLElement;
    expect(made.getAttribute('data-arg')).toBe('u1');
    expect(made.getAttribute('data-eff')).toBe('x');
    expect(el.querySelector('.memo')?.textContent).toBe('x+x');
    // mergeProps(defaults, props): the wire-props descriptors are real
    // accessors now, so mergeProps' static path reads live values — the
    // component prop wins, same as the {...props} snapshot.
    expect(el.querySelector('.merged')?.textContent).toBe('m:x:L');
    expect(el.querySelector('.mergedB')?.textContent).toBe('m2:x:L');
    expect(el.querySelector('.host .inner')?.textContent).toBe('in:x');

    // The setProp-registered click handler dispatches back into the worker —
    // no onEvent sink here, so the emit op is simply drained by the driver.
    made.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await island.flush();

    // Tracked reads still re-run on updateProps.
    await island.updateProps({ tag: 'y' });
    expect(made.getAttribute('data-eff')).toBe('y');
    expect(el.querySelector('.memo')?.textContent).toBe('y+y');
    expect(el.querySelector('.host .inner')?.textContent).toBe('in:y');
    // The static insertNode'd text stays — it was never tracked.
    expect(el.querySelector('.made')?.textContent).toBe('made:x');

    island.destroy();
  });

  it('defineSolidMonoWorker mounts its sole app under any registry name', async () => {
    const el = realDoc.createElement('div');
    realDoc.body.appendChild(el);
    const client = connectIslandWorker({ worker: renderWorker });
    // 'main' is the registry key defineMonoWorker assigns — mount it
    // explicitly here (unnamed mounts would land the same app).
    const island = await mountIsland({ client, el, app: 'main', props: { tag: 'm' } });
    expect(el.querySelector('.mono')?.textContent).toBe('mono:m');
    await island.updateProps({ tag: 'm2' });
    expect(el.querySelector('.mono')?.textContent).toBe('mono:m2');
    island.destroy();
  });
});
