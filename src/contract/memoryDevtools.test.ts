import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineSharedMemory, field } from './sharedMemory';
import { memoryWatches, parseWatchRule } from './memoryDevtools';
import { listDevtoolsCommands, runDevtoolsCommand, setDevtoolsSink, type EmittedDevtoolsEvent } from '../devtools';
import { reef } from './reef';

let events: EmittedDevtoolsEvent[] = [];
const hits = () => events.filter((e) => e.type === 'memory:watch-hit') as Extract<EmittedDevtoolsEvent, { type: 'memory:watch-hit' }>[];

const bound = () => {
  const m = defineSharedMemory({
    dv: {
      count: field.number(),
      status: field.string({ maxBytes: 32 }),
      samples: field.float64Array({ length: 40 }),
      rows: field.list({ schema: reef.object({ id: reef.u32() }), count: 8 }),
    },
  });
  m.bind(new SharedArrayBuffer(m.totalBytes));
  return m;
};

type ReadRow = { path: string; value: string; version: number; contract: number };
const readOf = async (path: string, contract?: number): Promise<ReadRow | undefined> =>
  ((await runDevtoolsCommand('memory.read')) as ReadRow[]).filter((r) => r.path === path && (contract === undefined || r.contract === contract)).at(-1);

afterEach(async () => {
  for (const path of [...memoryWatches.keys()]) await runDevtoolsCommand('memory.unwatch', { path });
  setDevtoolsSink(null);
  events = [];
});

describe('memory devtools commands', () => {
  it('stay unregistered until a contract binds with devtools on', () => {
    const m = defineSharedMemory({ off: field.number() });
    m.bind(new SharedArrayBuffer(m.totalBytes));
    expect(listDevtoolsCommands()).not.toContain('memory.read');
  });

  it('memory.read previews every bound field with its version', async () => {
    setDevtoolsSink((e) => events.push(e));
    const m = bound();
    expect(listDevtoolsCommands()).toEqual(expect.arrayContaining(['memory.read', 'memory.watch', 'memory.unwatch', 'memory.watches']));
    m.dv.count.write(4);
    m.dv.count.write(5);
    m.dv.status.write('up');
    m.dv.samples.write(Float64Array.from({ length: 40 }, (_, i) => i));
    m.dv.rows.writeAt(1, { id: 9 });
    m.dv.rows.commit();

    const rows = (await runDevtoolsCommand('memory.read')) as ReadRow[];
    const contract = rows.find((r) => r.path === 'dv.count' && r.value === '5')!.contract;
    const mine = rows.filter((r) => r.contract === contract);
    expect(mine.map((r) => r.path)).toEqual(['dv.count', 'dv.status', 'dv.samples', 'dv.rows']);
    expect(mine[0]).toMatchObject({ value: '5', version: 2 });
    expect(mine[1]).toMatchObject({ value: '"up"', version: 1 });
    expect(mine[2].value).toMatch(/^Float64Array\(40\) \[0,1,2,.*15\]…$/);
    expect(JSON.parse(mine[3].value)).toEqual({ records: 8, head: [{ id: 0 }, { id: 9 }, { id: 0 }, { id: 0 }, { id: 0 }] });
    expect(mine[3].version).toBe(1);
  });

  it('numeric watch rules fire memory:watch-hit on matching local writes only', async () => {
    setDevtoolsSink((e) => events.push(e));
    const m = bound();
    m.dv.count.write(1);
    expect(await runDevtoolsCommand('memory.watch', { path: 'dv.count', rule: '> 5' })).toEqual([
      { path: 'dv.count', rule: '> 5', hits: 0 },
    ]);
    m.dv.count.write(3);
    expect(hits()).toHaveLength(0);
    m.dv.count.write(7);
    expect(hits()).toEqual([expect.objectContaining({ path: 'dv.count', value: '7', rule: '> 5', version: 3 })]);
    expect(await runDevtoolsCommand('memory.watches')).toEqual([{ path: 'dv.count', rule: '> 5', hits: 1 }]);

    await runDevtoolsCommand('memory.unwatch', { path: 'dv.count' });
    expect(memoryWatches.size).toBe(0);
    m.dv.count.write(70);
    expect(hits()).toHaveLength(1);
  });

  it("'change' and equality rules compare values, not writes", async () => {
    setDevtoolsSink((e) => events.push(e));
    const m = bound();
    await runDevtoolsCommand('memory.watch', { path: 'dv.status', rule: 'change' });
    m.dv.status.write('a');
    m.dv.status.write('a');
    m.dv.status.write('b');
    expect(hits().map((h) => h.value)).toEqual(['"a"', '"b"']);

    await runDevtoolsCommand('memory.watch', { path: 'dv.status', rule: '== "down"' });
    m.dv.status.write('up');
    m.dv.status.write('down');
    expect(hits().at(-1)).toMatchObject({ value: '"down"', rule: '== "down"' });
    expect(hits()).toHaveLength(3);

    await runDevtoolsCommand('memory.watch', { path: 'dv.rows', rule: 'change' });
    m.dv.rows.writeAt(0, { id: 3 });
    m.dv.rows.commit();
    expect(hits().at(-1)).toMatchObject({ path: 'dv.rows', rule: 'change' });
  });

  it('catches writes from another thread through the version observer', async () => {
    setDevtoolsSink((e) => events.push(e));
    const m = bound();
    await runDevtoolsCommand('memory.watch', { path: 'dv.count', rule: '>= 100' });
    // A worker writes the shared buffer directly and bumps the counter — no
    // connector call on this thread.
    const { byteOffset } = m.fields().find((f) => f.path === 'dv.count')!;
    new Float64Array(m.buffer, byteOffset, 1)[0] = 123;
    const v = (m as unknown as { connector(p: string): { _version: { view: Int32Array; index: number } } }).connector('dv.count')._version;
    Atomics.add(v.view, v.index, 1);
    Atomics.notify(v.view, v.index);
    await vi.waitFor(() => expect(hits()).toEqual([expect.objectContaining({ path: 'dv.count', value: '123', version: 1 })]));
  });

  it('rejects malformed rules and unknown paths', async () => {
    setDevtoolsSink((e) => events.push(e));
    bound();
    expect(() => parseWatchRule('~ 3')).toThrow(/bad rule/);
    expect(() => parseWatchRule('> abc')).toThrow(/not a number/);
    await expect(runDevtoolsCommand('memory.watch', { path: 'nope.nothing', rule: 'change' })).rejects.toThrow(/no contract/);
    expect(parseWatchRule('!= 3').test(4)).toBe(true);
    expect(parseWatchRule('<= 3').test(3n)).toBe(true);
    expect(parseWatchRule('< 3').test('2')).toBe(false);
    expect(await readOf('dv.count')).toBeDefined();
  });
});
