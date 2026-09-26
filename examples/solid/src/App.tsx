import { createMemo, createSignal, For, type JSX, type Setter } from 'solid-js';
import { createIncidents } from './incidents';
import { fmtDur, fmtInt, incidentColumns as columns, REGIONS, SERVICES, SEVERITIES, STATUSES, type QueryArgs } from '@jwhenry123/mesh/incidents';

export function App() {
  const [pageIndex, setPageIndex] = createSignal(0);
  const [pageSize, setPageSize] = createSignal(50);
  const [sortBy, setSortBy] = createSignal<string | null>(null);
  const [sortDesc, setSortDesc] = createSignal(false);
  const [severity, setSeverity] = createSignal('');
  const [status, setStatus] = createSignal('');
  const [region, setRegion] = createSignal('');
  const [service, setService] = createSignal('');
  const [search, setSearch] = createSignal('');
  const [debouncedSearch, setDebouncedSearch] = createSignal('');

  // Debounce the site search box
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const onSearch: JSX.EventHandler<HTMLInputElement, InputEvent> = (e) => {
    const v = e.currentTarget.value.toUpperCase();
    setSearch(v);
    clearTimeout(debounce);
    debounce = setTimeout(() => { setDebouncedSearch(v); setPageIndex(0); }, 300);
  };

  const query = createMemo<QueryArgs>(() => ({
    offset: pageIndex() * pageSize(),
    limit: pageSize(),
    sortBy: sortBy(),
    sortDesc: sortDesc(),
    severity: severity() === '' ? null : Number(severity()),
    status: status() === '' ? null : Number(status()),
    region: region() === '' ? null : Number(region()),
    service: service() === '' ? null : Number(service()),
    search: debouncedSearch(),
  }));

  const { ready, seedProgress, metrics, page, roundTripMs, isFetching } = createIncidents(query);

  const rows = () => page()?.rows ?? [];
  const filtered = () => page()?.filtered ?? 0;
  const total = () => page()?.total ?? 0;
  const pageCount = () => Math.max(1, Math.ceil(filtered() / pageSize()));
  const timing = () => {
    const p = page();
    const ms = roundTripMs();
    return p && ms != null ? `scan ${p.scanMs.toFixed(0)}ms + sort ${p.sortMs.toFixed(0)}ms, round-trip ${ms.toFixed(0)}ms` : '';
  };

  // Any filter change restarts pagination
  const onFilter = (set: Setter<string>): JSX.EventHandler<HTMLSelectElement, Event> => (e) => {
    set(e.currentTarget.value);
    setPageIndex(0);
  };

  const toggleSort = (key: string) => {
    if (sortBy() !== key) { setSortBy(key); setSortDesc(false); }
    else if (!sortDesc()) setSortDesc(true);
    else setSortBy(null);
  };
  const prevPage = () => { if (pageIndex() > 0) setPageIndex(pageIndex() - 1); };
  const nextPage = () => { if (pageIndex() < pageCount() - 1) setPageIndex(pageIndex() + 1); };

  const seeding = (
    <main>
      <h1>Telecom Incident Explorer</h1>
      <p class="subtitle">Seeding 1,000,000 incident records into shared memory…</p>
      <div class="progress"><div class="progress-fill" style={{ width: `${seedProgress()}%` }} /></div>
      <p class="subtitle">{fmtInt(seedProgress())}% — {fmtInt(seedProgress() * 10_000)} records</p>
    </main>
  );

  return (
    <>{ready() ? (
      <main class="wide">
        <h1>Telecom Incident Explorer</h1>
        <p class="subtitle">
          {fmtInt(total())} fixed-layout records in shared memory — the worker filters, sorts, and aggregates;
          only the visible page crosses postMessage.
        </p>

        <div class="metrics">
          <div class="metric"><span class="metric-value">{metrics() ? fmtInt(metrics()!.total) : '—'}</span><span>total</span></div>
          <div class="metric"><span class="metric-value st-open">{metrics() ? fmtInt(metrics()!.open) : '—'}</span><span>open</span></div>
          <div class="metric"><span class="metric-value st-ack">{metrics() ? fmtInt(metrics()!.acknowledged) : '—'}</span><span>acknowledged</span></div>
          <div class="metric"><span class="metric-value st-resolved">{metrics() ? fmtInt(metrics()!.resolved) : '—'}</span><span>resolved</span></div>
          <div class="metric"><span class="metric-value sev-critical">{metrics() ? fmtInt(metrics()!.critical) : '—'}</span><span>critical</span></div>
          <div class="metric"><span class="metric-value">{metrics() ? fmtInt(metrics()!.customersAffected) : '—'}</span><span>customers</span></div>
          <div class="metric"><span class="metric-value">{metrics() ? fmtDur(metrics()!.avgDurationMin) : '—'}</span><span>avg duration</span></div>
        </div>
        {metrics() && <p class="subtitle">metrics aggregated by worker in {metrics()!.scanMs.toFixed(0)}ms{timing() ? ` · last query: ${timing()}` : ''}</p>}

        <div class="toolbar">
          <select value={severity()} onChange={onFilter(setSeverity)}>
            <option value="">all severities</option>
            <For each={SEVERITIES}>{(s, i) => <option value={i()}>{s}</option>}</For>
          </select>
          <select value={status()} onChange={onFilter(setStatus)}>
            <option value="">all statuses</option>
            <For each={STATUSES}>{(s, i) => <option value={i()}>{s}</option>}</For>
          </select>
          <select value={region()} onChange={onFilter(setRegion)}>
            <option value="">all regions</option>
            <For each={REGIONS}>{(s, i) => <option value={i()}>{s}</option>}</For>
          </select>
          <select value={service()} onChange={onFilter(setService)}>
            <option value="">all services</option>
            <For each={SERVICES}>{(s, i) => <option value={i()}>{s}</option>}</For>
          </select>
          <input type="text" placeholder="search site…" value={search()} onInput={onSearch} />
          <span class="filtered">{fmtInt(filtered())} matching{isFetching() ? ' · updating…' : ''}</span>
        </div>

        <table>
          <thead>
            <tr>
              <For each={columns}>{(col) => (
                <th class="sortable" onClick={() => toggleSort(col.key)}>
                  {col.label}{sortBy() === col.key ? (sortDesc() ? ' ▼' : ' ▲') : ''}
                </th>
              )}</For>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>{(row) => (
              <tr>
                <For each={columns}>{(col) => (
                  <td>{col.badge ? <span class={`badge ${col.badge(row)}`}>{col.text(row)}</span> : col.text(row)}</td>
                )}</For>
              </tr>
            )}</For>
          </tbody>
        </table>

        <div class="pager">
          <button onClick={prevPage} disabled={pageIndex() === 0}>‹ prev</button>
          <span>page {pageIndex() + 1} / {pageCount()}</span>
          <button onClick={nextPage} disabled={pageIndex() >= pageCount() - 1}>next ›</button>
          <select value={pageSize()} onChange={(e) => setPageSize(Number(e.currentTarget.value))}>
            <For each={[25, 50, 100, 200]}>{(s) => <option value={s}>{s} / page</option>}</For>
          </select>
        </div>
      </main>
    ) : seeding}</>
  );
}
