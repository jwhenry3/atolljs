import { afterEach, describe, expect, it } from 'vitest';
import { defineSharedMemory, field } from './contract/sharedMemory';
import { listDevtoolsCommands, runDevtoolsCommand, setDevtoolsSink, type EmittedDevtoolsEvent } from './devtools';
import { observe } from './observable';
import { watch } from './reactive';

type NodeEvent = Extract<EmittedDevtoolsEvent, { type: 'reactive:node' }>;
let events: EmittedDevtoolsEvent[] = [];
const nodes = () => events.filter((e) => e.type === 'reactive:node') as NodeEvent[];
const byKind = (k: NodeEvent['kind']) => nodes().filter((n) => n.kind === k);

const mem = () => {
  const m = defineSharedMemory({ rg: { level: field.number(), meta: field.object({ maxBytes: 64 }) } });
  m.bind(new SharedArrayBuffer(m.totalBytes));
  return m;
};

afterEach(() => {
  setDevtoolsSink(null);
  events = [];
});

describe('reactive:node emission', () => {
  it('is silent (and registers nothing) while devtools is off', () => {
    const m = mem();
    const stop = watch(m.rg.level, () => {});
    stop();
    expect(listDevtoolsCommands()).not.toContain('reactive.nodes');
  });

  it('watch() emits source → bridge → effect, and disposes on stop', async () => {
    setDevtoolsSink((e) => events.push(e));
    const m = mem();
    const stop = watch(m.rg.level, () => {});

    expect(byKind('source')).toEqual([expect.objectContaining({ id: 'mem:rg.level', owner: 'shared', label: 'rg.level' })]);
    const [bridge] = byKind('bridge');
    expect(bridge.deps).toEqual(['mem:rg.level']);
    expect(bridge.owner).toBe('main');
    expect(bridge.label).toMatch(/^(waitAsync|poll) rg\.level$/);
    const [effect] = byKind('effect');
    expect(effect).toMatchObject({ label: 'watch(rg.level)', deps: [bridge.id], owner: 'main' });
    expect(byKind('derived')).toHaveLength(0);

    const live = (await runDevtoolsCommand('reactive.nodes')) as { id: string }[];
    expect(live.map((n) => n.id)).toEqual(expect.arrayContaining(['mem:rg.level', bridge.id, effect.id]));

    stop();
    const disposed = nodes().filter((n) => n.disposed).map((n) => n.id);
    expect(disposed).toEqual(expect.arrayContaining([bridge.id, effect.id]));
    // Sources outlive their watchers.
    expect(disposed).not.toContain('mem:rg.level');
    const after = (await runDevtoolsCommand('reactive.nodes')) as { id: string }[];
    expect(after.map((n) => n.id)).not.toContain(effect.id);
  });

  it('a selector adds a derived node between bridge and effect', () => {
    setDevtoolsSink((e) => events.push(e));
    const m = mem();
    const stop = watch(m.rg.meta, (v: unknown) => (v as { a?: number }).a, () => {});
    const [bridge] = byKind('bridge');
    const [derived] = byKind('derived');
    const [effect] = byKind('effect');
    expect(derived).toMatchObject({ label: 'select(rg.meta)', deps: [bridge.id] });
    expect(effect.deps).toEqual([derived.id]);
    stop();
    expect(nodes().filter((n) => n.disposed).map((n) => n.id)).toEqual(expect.arrayContaining([derived.id, effect.id, bridge.id]));
  });

  it('observe() labels its effect with the live subscriber count', () => {
    setDevtoolsSink((e) => events.push(e));
    const m = mem();
    const obs = observe(m, 'rg.level');
    const un1 = obs.subscribe(() => {});
    const un2 = obs.subscribe(() => {});
    const effectId = byKind('effect')[0].id;
    const labels = () => byKind('effect').filter((n) => n.id === effectId).map((n) => n.label);
    expect(labels().at(-1)).toBe('observe(rg.level) · 2 subs');
    un1();
    expect(labels().at(-1)).toBe('observe(rg.level) · 1 sub');
    un2();
    expect(byKind('effect').filter((n) => n.id === effectId).at(-1)!.disposed).toBe(true);
  });
});
