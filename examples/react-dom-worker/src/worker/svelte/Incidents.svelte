<script lang="ts">
  /**
   * 'incidents' — the heavy-component benchmark: 1,000,000 incident
   * records in the worker, rendered through a virtualized scroller. The
   * main thread only ever sees ~20 rows of ops no matter how deep the
   * user scrolls.
   *
   * Rows are lazily generated (deterministic pseudo-data — nothing is
   * materialized until it's visible). Each scroll event is a dispatch
   * round-trip; the worker re-renders the window and reports the
   * re-render time back via 'rendered'.
   */
  import { emit, runInInstance } from '@atolljs/svelte-island/worker';
  import { getActiveInstance } from '@atolljs/islands/worker';

  let { count = 1_000_000 }: { count?: number } = $props();

  const ROW_H = 24;
  const VIEW = 320;
  const OV = 4;
  const VISIBLE = Math.ceil(VIEW / ROW_H) + OV * 2;

  const REGIONS = ['us-east', 'us-west', 'eu-central', 'ap-south', 'sa-east'];
  const SEVS = ['P1', 'P2', 'P3', 'P4'];
  const incident = (i: number) => ({
    id: i,
    site: `site-${(i * 7919) % 1409}`,
    region: REGIONS[i % REGIONS.length],
    sev: (i * 31) % 100,
    dur: `${((i * 104729) % 977) % 60}m`,
  });
  const sevClass = (s: number): string =>
    `inc-sev sev-p${s > 75 ? 1 : s > 40 ? 2 : s > 15 ? 3 : 4}`;
  const sevLabel = (s: number): string => SEVS[s > 75 ? 0 : s > 40 ? 1 : s > 15 ? 2 : 3];

  let start = $state(0);
  let lastMs = $state(0);
  let t0 = performance.now();

  const first = $derived(Math.min(start, Math.max(0, count - VISIBLE)));
  const rows = $derived(
    Array.from({ length: Math.min(VISIBLE, count - first) }, (_, k) => incident(first + k)),
  );
  const end = $derived(first + rows.length - 1);

  const onScroll = (e: Event): void => {
    t0 = performance.now();
    // The driver stamps the scroller's scrollTop onto the wire payload —
    // the proxy element's geometry getters are stubs.
    const st = (e as Event & { scrollTop?: number }).scrollTop ?? 0;
    start = Math.max(0, Math.floor(st / ROW_H) - OV);
  };

  // After every commit that touched the window, report the re-render cost.
  // $effect runs async after the event dispatch released the instance
  // scope — capture this mount's key during setup (inside the mount task)
  // and re-enter it for the emit.
  const scope = getActiveInstance();
  $effect(() => {
    void rows; // track the window
    const ms = performance.now() - t0;
    // Read no $state we write: a self-invalidating effect never converges —
    // each flush re-schedules it via a new Batch, which recurses in
    // Batch.#process() until the worker dies on a stack overflow.
    runInInstance(scope, () => emit('rendered', { start: first, end, ms }));
    lastMs = ms;
  });
</script>

<div class="incidents">
  <div class="inc-stats">
    {count.toLocaleString()} incidents · rows {first.toLocaleString()}–{end.toLocaleString()} ·
    worker re-render {lastMs.toFixed(1)}ms
  </div>
  <div class="inc-viewport" onscroll={onScroll}>
    <div class="inc-spacer" style:height="{count * ROW_H}px">
      {#each rows as r (r.id)}
        <div class="inc-row" style:top="{r.id * ROW_H}px">
          <span class="inc-id">#{r.id}</span>
          <span class="inc-site">{r.site}</span>
          <span class="inc-region">{r.region}</span>
          <span class={sevClass(r.sev)}>{sevLabel(r.sev)} · {r.sev}</span>
          <span class="inc-dur">{r.dur}</span>
        </div>
      {/each}
    </div>
  </div>
</div>
