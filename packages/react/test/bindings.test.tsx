// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineSharedMemory, defineTask, field, observe } from '@jwhenry123/mesh/sdk';
import { useObservable, useSharedValue, useTask } from '../src/index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const mem = defineSharedMemory({ n: field.number(), label: field.string({ maxBytes: 64 }) });
mem.bind(new SharedArrayBuffer(mem.totalBytes));

const render = (el: JSX.Element) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(el));
  return { container, root };
};

describe('useObservable', () => {
  it('renders the current value and re-renders on writes', async () => {
    const src = observe(mem, 'n');
    function C() {
      return <output data-testid="n">{String(useObservable(src))}</output>;
    }
    const { container } = render(<C />);
    act(() => mem.n.write(41));
    await vi.waitFor(() =>
      expect(container.querySelector('output')!.textContent).toBe('41')
    );
  });
});

describe('useSharedValue', () => {
  it('binds a field directly', async () => {
    function C() {
      const label = useSharedValue(mem, 'label');
      return <output>{label ?? 'unset'}</output>;
    }
    const { container } = render(<C />);
    act(() => mem.label.write('mesh'));
    await vi.waitFor(() =>
      expect(container.querySelector('output')!.textContent).toBe('mesh')
    );
  });

  it('supports a selector slice', async () => {
    function C() {
      const doubled = useSharedValue(mem, 'n', (v) => (v ?? 0) * 2);
      return <output>{String(doubled)}</output>;
    }
    const { container } = render(<C />);
    act(() => mem.n.write(50));
    await vi.waitFor(() =>
      expect(container.querySelector('output')!.textContent).toBe('100')
    );
  });
});

describe('useTask', () => {
  it('exposes the task snapshot plus run triggers', async () => {
    const task = defineTask(async (n: number) => n + 1);
    function C() {
      const t = useTask(task);
      return <output>{t.settled ? String(t.data) : t.pending ? 'pending' : 'idle'}</output>;
    }
    const { container } = render(<C />);
    expect(container.querySelector('output')!.textContent).toBe('idle');

    await act(async () => task.run(9));
    await vi.waitFor(() =>
      expect(container.querySelector('output')!.textContent).toBe('10')
    );
  });
});
