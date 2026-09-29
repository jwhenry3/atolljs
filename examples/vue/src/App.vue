<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useIncidents } from './useIncidents';
import { fmtDur, fmtInt, incidentColumns as columns, REGIONS, SERVICES, SEVERITIES, STATUSES, type QueryArgs } from '@atolljs/incidents';

const pageIndex = ref(0);
const pageSize = ref(50);
const sortBy = ref<string | null>(null);
const sortDesc = ref(false);
const severity = ref<number | ''>('');
const status = ref<number | ''>('');
const region = ref<number | ''>('');
const service = ref<number | ''>('');
const search = ref('');
const debouncedSearch = ref('');

// Any filter change restarts pagination
watch([severity, status, region, service], () => (pageIndex.value = 0));

// Debounce the site search box
let debounce: ReturnType<typeof setTimeout> | undefined;
function onSearch(e: Event) {
  const v = (e.target as HTMLInputElement).value.toUpperCase();
  search.value = v;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    debouncedSearch.value = v;
    pageIndex.value = 0;
  }, 300);
}

const query = computed<QueryArgs>(() => ({
  offset: pageIndex.value * pageSize.value,
  limit: pageSize.value,
  sortBy: sortBy.value,
  sortDesc: sortDesc.value,
  severity: severity.value === '' ? null : Number(severity.value),
  status: status.value === '' ? null : Number(status.value),
  region: region.value === '' ? null : Number(region.value),
  service: service.value === '' ? null : Number(service.value),
  search: debouncedSearch.value,
}));

const { ready, seedProgress, metrics, page, roundTripMs, isFetching } = useIncidents(query);

const rows = computed(() => page.value?.rows ?? []);
const filtered = computed(() => page.value?.filtered ?? 0);
const total = computed(() => page.value?.total ?? 0);
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value / pageSize.value)));
const timing = computed(() =>
  page.value && roundTripMs.value != null
    ? `scan ${page.value.scanMs.toFixed(0)}ms + sort ${page.value.sortMs.toFixed(0)}ms, round-trip ${roundTripMs.value.toFixed(0)}ms`
    : ''
);

function toggleSort(key: string) {
  if (sortBy.value !== key) {
    sortBy.value = key;
    sortDesc.value = false;
  } else if (!sortDesc.value) {
    sortDesc.value = true;
  } else {
    sortBy.value = null;
  }
}
const prevPage = () => { if (pageIndex.value > 0) pageIndex.value--; };
const nextPage = () => { if (pageIndex.value < pageCount.value - 1) pageIndex.value++; };
</script>

<template>
  <main v-if="!ready">
    <h1>Telecom Incident Explorer</h1>
    <p class="subtitle">Seeding 1,000,000 incident records into shared memory…</p>
    <div class="progress"><div class="progress-fill" :style="{ width: `${seedProgress}%` }" /></div>
    <p class="subtitle">{{ fmtInt(seedProgress) }}% — {{ fmtInt(seedProgress * 10_000) }} records</p>
  </main>

  <main v-else class="wide">
    <h1>Telecom Incident Explorer</h1>
    <p class="subtitle">
      {{ fmtInt(total) }} fixed-layout records in shared memory — the worker filters, sorts, and aggregates;
      only the visible page crosses postMessage.
    </p>

    <div class="metrics">
      <div class="metric"><span class="metric-value">{{ metrics ? fmtInt(metrics.total) : '—' }}</span><span>total</span></div>
      <div class="metric"><span class="metric-value st-open">{{ metrics ? fmtInt(metrics.open) : '—' }}</span><span>open</span></div>
      <div class="metric"><span class="metric-value st-ack">{{ metrics ? fmtInt(metrics.acknowledged) : '—' }}</span><span>acknowledged</span></div>
      <div class="metric"><span class="metric-value st-resolved">{{ metrics ? fmtInt(metrics.resolved) : '—' }}</span><span>resolved</span></div>
      <div class="metric"><span class="metric-value sev-critical">{{ metrics ? fmtInt(metrics.critical) : '—' }}</span><span>critical</span></div>
      <div class="metric"><span class="metric-value">{{ metrics ? fmtInt(metrics.customersAffected) : '—' }}</span><span>customers</span></div>
      <div class="metric"><span class="metric-value">{{ metrics ? fmtDur(metrics.avgDurationMin) : '—' }}</span><span>avg duration</span></div>
    </div>
    <p v-if="metrics" class="subtitle">
      metrics aggregated by worker in {{ metrics.scanMs.toFixed(0) }}ms{{ timing ? ` · last query: ${timing}` : '' }}
    </p>

    <div class="toolbar">
      <select v-model="severity">
        <option value="">all severities</option>
        <option v-for="(s, i) in SEVERITIES" :key="s" :value="i">{{ s }}</option>
      </select>
      <select v-model="status">
        <option value="">all statuses</option>
        <option v-for="(s, i) in STATUSES" :key="s" :value="i">{{ s }}</option>
      </select>
      <select v-model="region">
        <option value="">all regions</option>
        <option v-for="(s, i) in REGIONS" :key="s" :value="i">{{ s }}</option>
      </select>
      <select v-model="service">
        <option value="">all services</option>
        <option v-for="(s, i) in SERVICES" :key="s" :value="i">{{ s }}</option>
      </select>
      <input type="text" placeholder="search site…" :value="search" @input="onSearch" />
      <span class="filtered">{{ fmtInt(filtered) }} matching{{ isFetching ? ' · updating…' : '' }}</span>
    </div>

    <table>
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key" class="sortable" @click="toggleSort(col.key)">
            {{ col.label }}{{ sortBy === col.key ? (sortDesc ? ' ▼' : ' ▲') : '' }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td v-for="col in columns" :key="col.key">
            <span v-if="col.badge" class="badge" :class="col.badge(row)">{{ col.text(row) }}</span>
            <template v-else>{{ col.text(row) }}</template>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="pager">
      <button :disabled="pageIndex === 0" @click="prevPage">‹ prev</button>
      <span>page {{ pageIndex + 1 }} / {{ pageCount }}</span>
      <button :disabled="pageIndex >= pageCount - 1" @click="nextPage">next ›</button>
      <select v-model="pageSize">
        <option v-for="s in [25, 50, 100, 200]" :key="s" :value="s">{{ s }} / page</option>
      </select>
    </div>
  </main>
</template>
