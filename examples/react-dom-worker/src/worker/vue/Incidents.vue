<script setup lang="ts">
/**
 * 'incidents' — the heavy-component benchmark: 1,000,000 incident records
 * in the worker, rendered through a virtualized scroller. The main thread
 * only ever sees ~20 rows of ops no matter how deep the user scrolls.
 *
 * Rows are lazily generated (deterministic pseudo-data — nothing is
 * materialized until it's visible). Each scroll event is a dispatch
 * round-trip; the worker re-renders the window and reports the re-render
 * time back via 'rendered' — that's the number that matters.
 */
import { computed, onUpdated, ref } from 'vue';
import { emit, runInInstance } from '@atolljs/vue-island/worker';
import { getActiveInstance } from '@atolljs/islands/worker';

const props = withDefaults(defineProps<{ count?: number }>(), { count: 1_000_000 });
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

const start = ref(0);
const lastMs = ref(0);
let t0 = performance.now();

const first = computed(() =>
  Math.min(start.value, Math.max(0, props.count - VISIBLE)),
);
const rows = computed(() =>
  Array.from({ length: Math.min(VISIBLE, props.count - first.value) }, (_, k) =>
    incident(first.value + k),
  ),
);
const end = computed(() => first.value + rows.value.length - 1);

const onScroll = (e: Event): void => {
  t0 = performance.now();
  // The driver stamps the scroller's scrollTop onto the wire payload —
  // e.target is the proxy element, whose geometry getters are stubs.
  const st = (e as Event & { scrollTop?: number }).scrollTop ?? 0;
  start.value = Math.max(0, Math.floor(st / ROW_H) - OV);
};
// onUpdated runs after the re-render commits — the delta from the scroll
// handler is the whole worker-side re-render cost. The window-key guard
// stops lastMs's own write from looping back into another report. Vue's
// scheduler flushes async, so the callback runs with no instance scope —
// capture this mount's key during setup (which runs inside the mount task)
// and re-enter it for the emit.
const scope = getActiveInstance();
let prevKey = '';
onUpdated(() => {
  const key = `${first.value}:${end.value}`;
  if (key === prevKey) return;
  prevKey = key;
  lastMs.value = performance.now() - t0;
  runInInstance(scope, () =>
    emit('rendered', { start: first.value, end: end.value, ms: lastMs.value }),
  );
});
</script>

<template>
  <div class="inc-stats">
    {{ count.toLocaleString() }} incidents · rows {{ first.toLocaleString() }}–{{ end.toLocaleString() }} ·
    worker re-render {{ lastMs.toFixed(1) }}ms
  </div>
  <div class="inc-viewport" @scroll="onScroll">
    <div class="inc-spacer" :style="{ height: `${count * ROW_H}px` }">
      <div
        v-for="r in rows"
        :key="r.id"
        class="inc-row"
        :style="{ top: `${r.id * ROW_H}px` }"
      >
        <span class="inc-id">#{{ r.id }}</span>
        <span class="inc-site">{{ r.site }}</span>
        <span class="inc-region">{{ r.region }}</span>
        <span :class="sevClass(r.sev)">{{ sevLabel(r.sev) }} · {{ r.sev }}</span>
        <span class="inc-dur">{{ r.dur }}</span>
      </div>
    </div>
  </div>
</template>
