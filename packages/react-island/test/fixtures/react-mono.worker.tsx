/**
 * Mono/stamped worker fixtures for the React island adapter:
 * - `reactIsland(name, Comp)` — stamp + wrap in one step; the stamped app is
 *   registered in a one-app poly registry, exercising the stamp-preserving
 *   wrap path inside `reactIslandApp`.
 * - `defineReactMonoWorker(Comp)` — bare component → wrapped via
 *   reactIslandApp and registered namelessly under 'main' (the shell mounts
 *   it without an `app`).
 * - `defineReactMonoWorker({ imperative })` — the non-component branch.
 *
 * In-process the app registry is a union across every handler module in the
 * test file — the stamps keep these entries distinct from the poly fixture's.
 */
import { createElement } from 'react';
import { emit, islandApp, type ProxyDocument } from '@atolljs/islands/worker';
import {
  defineReactMonoWorker,
  defineReactPolyWorker,
  reactIsland,
} from '../../src/worker';

function reactTagged(props: Record<string, unknown>) {
  return createElement(
    'p',
    { className: 'tagged' },
    `tagged: ${String(props.label ?? 'solo')}`,
  );
}

/** `reactIsland` — stamp + wrap in one step (the registry value AND the
 *  component-reference handle shells can mount). */
export const taggedApp = reactIsland('reactTagged', reactTagged);

export const taggedWorker = defineReactPolyWorker({
  apps: { reactTagged: taggedApp },
});

/** Bare anonymous component in a mono worker — no name to stamp, so the
 *  app registers under the default 'main' and mounts namelessly. */
export const monoReactWorker = defineReactMonoWorker((props: Record<string, unknown>) =>
  createElement(
    'p',
    { className: 'mono-react' },
    `mono: ${String(props.label ?? 'solo')}`,
  ),
);

/** An imperative def pinned to a mono worker — the non-component branch. */
export const monoImpApp = islandApp('monoImp', {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    const p = doc.createElement('p');
    p.className = 'mono-imp';
    p.textContent = String(props.label ?? 'imp solo');
    const btn = doc.createElement('button');
    btn.className = 'imp-ping';
    btn.addEventListener('click', () => emit('imp-pinged', {}));
    doc.body.append(p, btn);
  },
});

export const monoImpWorker = defineReactMonoWorker(monoImpApp);
