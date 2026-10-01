<script lang="ts">
  /**
   * Svelte host — FIVE worker-rendered micro-frontends, five frameworks.
   *
   * The shell imports only CONTRACT modules (`../../mfe/contracts/*`): the
   * `use:island` action takes the contract itself as `app` — its `app` key
   * resolves the registry name and its `worker` factory supplies the
   * connection, so each island is one options object.
   *
   * Nothing in this bundle imports React, Vue, Solid, or Angular — those
   * runtimes exist only inside their own worker chunks.
   */
  import { island } from '@atolljs/svelte-island';
  import type { IslandHandle } from '@atolljs/islands';
  import counterContract from '../../mfe/contracts/counter.contract';
  import notesContract from '../../mfe/contracts/notes.contract';
  import tickerContract from '../../mfe/contracts/ticker.contract';
  import dialContract from '../../mfe/contracts/dial.contract';
  import checkoutContract from '../../mfe/contracts/checkout.contract';

  // No SharedArrayBuffer without COOP/COEP — the doorbell option travels
  // with the client (workerOptions.doorbell); a doorbell-free client's
  // 'push' mode falls back to 50ms polling automatically.
  const isolated =
    typeof SharedArrayBuffer !== 'undefined' &&
    (typeof window.crossOriginIsolated === 'undefined' || window.crossOriginIsolated);
  const transport = { workerOptions: { doorbell: isolated } };

  let status = $state('mounting islands…');
  let pids = $state<Record<string, string>>({});

  const ready = (key: string) => (handle: IslandHandle): void => {
    pids = { ...pids, [key]: `worker ${handle.pid}` };
  };

  /** The call-site code rendered under each island — this file's own idiom. */
  const SNIPPETS = {
    counter: `<div use:island={{
      app: counterContract,
      props: { label: 'alpha' },
      onEvent: (name, p) => …,
    }} />`,
    notes: `<div use:island={{
      app: notesContract,
      props: { title: 'vue island' },
      onEvent: (name, p) => …,
    }} />`,
    ticker: `<div use:island={{
      app: tickerContract,
      props: { label: 'pulse', intervalMs: 1000 },
      onEvent: (name, p) => …,
    }} />`,
    dial: `<div use:island={{
      app: dialContract,
      props: { label: 'level', value: 40 },
      onEvent: (name, p) => …,
    }} />`,
    checkout: `<div use:island={{
      app: checkoutContract,
      props: { label: 'cart', total: 42 },
      onEvent: (name, p) => …,
    }} />`,
  };
</script>

<h1>Svelte shell — five frameworks inside workers</h1>
<p style="font: 12px monospace; color: #9aa4b2; margin-top: -8px">
  every island mounts through a framework-free <code>*.contract.ts</code> — the contract object IS
  the <code>use:island</code> app (its <code>worker</code> factory supplies the connection).
</p>
<div id="status-line">{status}</div>

<section class="island">
  <div class="island-head"><span>counter — React worker</span><span class="badge">{pids.counter ?? 'worker …'}</span></div>
  <div
    class="island-root"
    use:island={{
      app: counterContract,
      props: { label: 'alpha' },
      ...transport,
      onReady: ready('counter'),
      onEvent: (name, payload) => {
        const p = payload as { count: number; label: string };
        if (name === 'incremented')
          status = `${p.label} counter → ${p.count} (React state stayed in the worker)`;
      },
    }}
  ></div>
  <pre class="island-code">{SNIPPETS.counter}</pre>
</section>

<section class="island">
  <div class="island-head"><span>notes — Vue worker (createRenderer on the proxy DOM)</span><span class="badge">{pids.notes ?? 'worker …'}</span></div>
  <div
    class="island-root"
    use:island={{
      app: notesContract,
      props: { title: 'vue island' },
      ...transport,
      onReady: ready('notes'),
      onEvent: (name, payload) => {
        const p = payload as { text: string; total: number };
        if (name === 'noteAdded')
          status = `notes island emitted noteAdded → "${p.text}" (${p.total} total)`;
      },
    }}
  ></div>
  <pre class="island-code">{SNIPPETS.notes}</pre>
</section>

<section class="island">
  <div class="island-head"><span>ticker — Solid worker (timer-driven emits)</span><span class="badge">{pids.ticker ?? 'worker …'}</span></div>
  <div
    class="island-root"
    use:island={{
      app: tickerContract,
      props: { label: 'pulse', intervalMs: 1000 },
      ...transport,
      onReady: ready('ticker'),
      onEvent: (name, payload) => {
        const p = payload as { count: number };
        if (name === 'tick') status = `ticker island emitted tick → ${p.count}`;
      },
    }}
  ></div>
  <pre class="island-code">{SNIPPETS.ticker}</pre>
</section>

<section class="island">
  <div class="island-head"><span>dial — Svelte worker (mount() on the proxy DOM)</span><span class="badge">{pids.dial ?? 'worker …'}</span></div>
  <div
    class="island-root"
    use:island={{
      app: dialContract,
      props: { label: 'level', value: 40 },
      ...transport,
      onReady: ready('dial'),
      onEvent: (name, payload) => {
        const p = payload as { value: number };
        if (name === 'changed') status = `dial island emitted changed → ${p.value}`;
      },
    }}
  ></div>
  <pre class="island-code">{SNIPPETS.dial}</pre>
</section>

<section class="island">
  <div class="island-head"><span>checkout — Angular worker (JIT + zoneless, signal inputs)</span><span class="badge">{pids.checkout ?? 'worker …'}</span></div>
  <div
    class="island-root"
    use:island={{
      app: checkoutContract,
      props: { label: 'cart', total: 42 },
      ...transport,
      onReady: ready('checkout'),
      onEvent: (name, payload) => {
        const p = payload as { total: number };
        if (name === 'paid') status = `checkout island emitted paid → $${p.total}`;
      },
    }}
  ></div>
  <pre class="island-code">{SNIPPETS.checkout}</pre>
</section>
