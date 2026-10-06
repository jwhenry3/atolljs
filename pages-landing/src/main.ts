/**
 * Landing-page showcase: five micro-frontends, five frameworks, each
 * rendering inside its own dedicated worker. The page imports ONLY the
 * framework-free contract modules from examples/mfe — each contract names
 * the registry app, declares the props/events wire shape, and carries the
 * worker factory. Nothing here imports React, Vue, Solid, Svelte, or
 * Angular: those runtimes exist only inside their worker bundles.
 */
import { mountIsland } from '@atolljs/islands';
import type { IslandContract, IslandHandle, Mode } from '@atolljs/islands';
import counterContract from '../../examples/mfe/contracts/counter.contract';
import notesContract from '../../examples/mfe/contracts/notes.contract';
import tickerContract from '../../examples/mfe/contracts/ticker.contract';
import dialContract from '../../examples/mfe/contracts/dial.contract';
import checkoutContract from '../../examples/mfe/contracts/checkout.contract';

interface Isle {
  id: string;
  contract: IslandContract;
  framework: string;
  props?: Record<string, unknown>;
}

const ISLES: Isle[] = [
  { id: 'counter', contract: counterContract, framework: 'React', props: { label: 'react island' } },
  { id: 'notes', contract: notesContract, framework: 'Vue', props: { title: 'vue island' } },
  { id: 'ticker', contract: tickerContract, framework: 'Solid', props: { label: 'solid island', intervalMs: 1000 } },
  { id: 'dial', contract: dialContract, framework: 'Svelte', props: { label: 'svelte island', value: 40 } },
  { id: 'checkout', contract: checkoutContract, framework: 'Angular', props: { label: 'angular island', total: 42 } },
];

// SharedArrayBuffer only exists in cross-origin-isolated contexts — without
// COOP/COEP (and when coi-sw.js can't take, e.g. first visit) the doorbell
// can't bind, so islands run their 50ms poll transport instead of push.
const mode: Mode =
  typeof SharedArrayBuffer !== 'undefined' &&
  (typeof window.crossOriginIsolated === 'undefined' || window.crossOriginIsolated)
    ? 'push'
    : 'poll';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
  document.querySelector<T>(sel);

let opsReplayed = 0;
let islandsLive = 0;
const statsEl = $('#isle-stats');
const eventEl = $('#isle-event');
const renderStats = (): void => {
  if (statsEl) {
    statsEl.textContent =
      `${islandsLive}/${ISLES.length} islands live · ${opsReplayed.toLocaleString()} ops replayed · ` +
      `transport ${mode === 'push' ? 'push (SharedArrayBuffer doorbell)' : 'poll (50ms drain)'}`;
  }
};

const noteEvent = (isle: Isle, name: string, payload: unknown): void => {
  if (!eventEl) return;
  let preview = '';
  try {
    preview = JSON.stringify(payload);
  } catch {
    preview = String(payload);
  }
  eventEl.textContent = `last event — ${isle.id} emitted '${name}' ${preview ?? ''}`;
};

/** rAF-driven heartbeat: proof the main thread stays free while the workers render. */
const heartbeat = $('#main-thread-hb');
const t0 = performance.now();
const tick = (): void => {
  if (heartbeat) {
    heartbeat.textContent = `main thread idle · ${((performance.now() - t0) / 1000).toFixed(0)}s uptime`;
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

renderStats();
for (const isle of ISLES) {
  const card = $(`#isle-${isle.id}`);
  const body = card?.querySelector<HTMLElement>('[data-mount]');
  const badge = card?.querySelector<HTMLElement>('.pid');
  const worker = isle.contract.worker;
  if (!card || !body || !worker) continue;
  mountIsland({
    el: body,
    worker,
    app: isle.contract.app,
    props: isle.props,
    mode,
    framework: isle.framework.toLowerCase(),
    onEvent: (name, payload) => noteEvent(isle, name, payload),
    onOps: (ops) => {
      opsReplayed += ops.length;
      renderStats();
    },
  })
    .then((handle: IslandHandle) => {
      islandsLive += 1;
      renderStats();
      if (badge) {
        badge.textContent = `worker ${handle.pid}`;
        badge.classList.add('live');
      }
    })
    .catch((err: unknown) => {
      if (badge) {
        badge.textContent = 'failed to mount';
        badge.classList.add('dead');
      }
      body.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'isle-error';
      p.textContent = err instanceof Error ? err.message : String(err);
      body.append(p);
    });
}
