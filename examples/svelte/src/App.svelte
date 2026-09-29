<script lang="ts">
  import { createIncidents } from './incidents.svelte';
  import { fmtDur, fmtInt, incidentColumns as columns, REGIONS, SERVICES, SEVERITIES, STATUSES, type QueryArgs } from '@atolljs/incidents';

  let pageIndex = $state(0);
  let pageSize = $state(50);
  let sortBy = $state<string | null>(null);
  let sortDesc = $state(false);
  let severity = $state<number | ''>('');
  let status = $state<number | ''>('');
  let region = $state<number | ''>('');
  let service = $state<number | ''>('');
  let search = $state('');
  let debouncedSearch = $state('');

  // Debounce the site search box
  let debounce: ReturnType<typeof setTimeout>;
  function onSearch(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value.toUpperCase();
    search = v;
    clearTimeout(debounce);
    debounce = setTimeout(() => { debouncedSearch = v; pageIndex = 0; }, 300);
  }

  const query: QueryArgs = $derived({
    offset: pageIndex * pageSize,
    limit: pageSize,
    sortBy,
    sortDesc,
    severity: severity === '' ? null : Number(severity),
    status: status === '' ? null : Number(status),
    region: region === '' ? null : Number(region),
    service: service === '' ? null : Number(service),
    search: debouncedSearch,
  });

  const inc = createIncidents(() => query);

  const rows = $derived(inc.page?.rows ?? []);
  const filtered = $derived(inc.page?.filtered ?? 0);
  const total = $derived(inc.page?.total ?? 0);
  const pageCount = $derived(Math.max(1, Math.ceil(filtered / pageSize)));
  const timing = $derived(
    inc.page && inc.roundTripMs != null
      ? `scan ${inc.page.scanMs.toFixed(0)}ms + sort ${inc.page.sortMs.toFixed(0)}ms, round-trip ${inc.roundTripMs.toFixed(0)}ms`
      : ''
  );

  // Any filter change restarts pagination
  const resetPage = () => (pageIndex = 0);

  function toggleSort(key: string) {
    if (sortBy !== key) { sortBy = key; sortDesc = false; }
    else if (!sortDesc) sortDesc = true;
    else sortBy = null;
  }
  const prevPage = () => { if (pageIndex > 0) pageIndex--; };
  const nextPage = () => { if (pageIndex < pageCount - 1) pageIndex++; };
</script>

{#if !inc.ready}
  <main>
    <h1>Telecom Incident Explorer</h1>
    <p class="subtitle">Seeding 1,000,000 incident records into shared memory…</p>
    <div class="progress"><div class="progress-fill" style="width: {inc.seedProgress}%"></div></div>
    <p class="subtitle">{fmtInt(inc.seedProgress)}% — {fmtInt(inc.seedProgress * 10_000)} records</p>
  </main>
{:else}
  <main class="wide">
    <h1>Telecom Incident Explorer</h1>
    <p class="subtitle">
      {fmtInt(total)} fixed-layout records in shared memory — the worker filters, sorts, and aggregates;
      only the visible page crosses postMessage.
    </p>

    <div class="metrics">
      <div class="metric"><span class="metric-value">{inc.metrics ? fmtInt(inc.metrics.total) : '—'}</span><span>total</span></div>
      <div class="metric"><span class="metric-value st-open">{inc.metrics ? fmtInt(inc.metrics.open) : '—'}</span><span>open</span></div>
      <div class="metric"><span class="metric-value st-ack">{inc.metrics ? fmtInt(inc.metrics.acknowledged) : '—'}</span><span>acknowledged</span></div>
      <div class="metric"><span class="metric-value st-resolved">{inc.metrics ? fmtInt(inc.metrics.resolved) : '—'}</span><span>resolved</span></div>
      <div class="metric"><span class="metric-value sev-critical">{inc.metrics ? fmtInt(inc.metrics.critical) : '—'}</span><span>critical</span></div>
      <div class="metric"><span class="metric-value">{inc.metrics ? fmtInt(inc.metrics.customersAffected) : '—'}</span><span>customers</span></div>
      <div class="metric"><span class="metric-value">{inc.metrics ? fmtDur(inc.metrics.avgDurationMin) : '—'}</span><span>avg duration</span></div>
    </div>
    {#if inc.metrics}
      <p class="subtitle">metrics aggregated by worker in {inc.metrics.scanMs.toFixed(0)}ms{timing ? ` · last query: ${timing}` : ''}</p>
    {/if}

    <div class="toolbar">
      <select bind:value={severity} onchange={resetPage}>
        <option value="">all severities</option>
        {#each SEVERITIES as s, i}<option value={i}>{s}</option>{/each}
      </select>
      <select bind:value={status} onchange={resetPage}>
        <option value="">all statuses</option>
        {#each STATUSES as s, i}<option value={i}>{s}</option>{/each}
      </select>
      <select bind:value={region} onchange={resetPage}>
        <option value="">all regions</option>
        {#each REGIONS as s, i}<option value={i}>{s}</option>{/each}
      </select>
      <select bind:value={service} onchange={resetPage}>
        <option value="">all services</option>
        {#each SERVICES as s, i}<option value={i}>{s}</option>{/each}
      </select>
      <input type="text" placeholder="search site…" value={search} oninput={onSearch} />
      <span class="filtered">{fmtInt(filtered)} matching{inc.isFetching ? ' · updating…' : ''}</span>
    </div>

    <table>
      <thead>
        <tr>
          {#each columns as col (col.key)}
            <th class="sortable" onclick={() => toggleSort(col.key)}>
              {col.label}{sortBy === col.key ? (sortDesc ? ' ▼' : ' ▲') : ''}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr>
            {#each columns as col (col.key)}
              <td>
                {#if col.badge}<span class="badge {col.badge(row)}">{col.text(row)}</span>{:else}{col.text(row)}{/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="pager">
      <button onclick={prevPage} disabled={pageIndex === 0}>‹ prev</button>
      <span>page {pageIndex + 1} / {pageCount}</span>
      <button onclick={nextPage} disabled={pageIndex >= pageCount - 1}>next ›</button>
      <select bind:value={pageSize}>
        {#each [25, 50, 100, 200] as s}<option value={s}>{s} / page</option>{/each}
      </select>
    </div>
  </main>
{/if}
