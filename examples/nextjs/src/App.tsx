import { useEffect, useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { incidentColumns } from './incidents.columns';
import { useIncidents } from './useIncidents';
import {
  fmtDur,
  fmtInt,
  REGIONS,
  SERVICES,
  SEVERITIES,
  STATUSES,
  type QueryArgs,
} from '@jwhenry123/mesh/incidents';

const NULL_SEL = '';

export function App() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [severity, setSeverity] = useState(NULL_SEL);
  const [status, setStatus] = useState(NULL_SEL);
  const [region, setRegion] = useState(NULL_SEL);
  const [service, setService] = useState(NULL_SEL);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce the site search box
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPagination((p) => ({ ...p, pageIndex: 0 })); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo<QueryArgs>(
    () => ({
      offset: pagination.pageIndex * pagination.pageSize,
      limit: pagination.pageSize,
      sortBy: sorting[0]?.id ?? null,
      sortDesc: sorting[0]?.desc ?? false,
      severity: severity === NULL_SEL ? null : Number(severity),
      status: status === NULL_SEL ? null : Number(status),
      region: region === NULL_SEL ? null : Number(region),
      service: service === NULL_SEL ? null : Number(service),
      search: debouncedSearch,
    }),
    [pagination, sorting, severity, status, region, service, debouncedSearch]
  );
  const { ready, seedProgress, metrics, page, roundTripMs, isFetching } = useIncidents(query);

  const rows = page?.rows ?? [];
  const filtered = page?.filtered ?? 0;
  const total = page?.total ?? 0;
  const timing =
    page && roundTripMs != null
      ? `scan ${page.scanMs.toFixed(0)}ms + sort ${page.sortMs.toFixed(0)}ms, round-trip ${roundTripMs.toFixed(0)}ms`
      : '';

  const table = useReactTable({
    data: rows,
    columns: incidentColumns,
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    manualPagination: true,
    manualSorting: true,
    pageCount: Math.ceil(filtered / pagination.pageSize),
    getCoreRowModel: getCoreRowModel(),
  });

  const onFilter = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };

  if (!ready) {
    return (
      <main>
        <h1>Telecom Incident Explorer</h1>
        <p className="subtitle">Seeding 1,000,000 incident records into shared memory…</p>
        <div className="progress"><div className="progress-fill" style={{ width: `${seedProgress}%` }} /></div>
        <p className="subtitle">{fmtInt(seedProgress)}% — {fmtInt(seedProgress * 10_000)} records</p>
      </main>
    );
  }

  return (
    <main className="wide">
      <h1>Telecom Incident Explorer</h1>
      <p className="subtitle">
        {fmtInt(total)} fixed-layout records in shared memory — the worker filters, sorts, and aggregates;
        only the visible page crosses postMessage.
      </p>

      <div className="metrics">
        <div className="metric"><span className="metric-value">{metrics ? fmtInt(metrics.total) : '—'}</span><span>total</span></div>
        <div className="metric"><span className="metric-value st-open">{metrics ? fmtInt(metrics.open) : '—'}</span><span>open</span></div>
        <div className="metric"><span className="metric-value st-ack">{metrics ? fmtInt(metrics.acknowledged) : '—'}</span><span>acknowledged</span></div>
        <div className="metric"><span className="metric-value st-resolved">{metrics ? fmtInt(metrics.resolved) : '—'}</span><span>resolved</span></div>
        <div className="metric"><span className="metric-value sev-critical">{metrics ? fmtInt(metrics.critical) : '—'}</span><span>critical</span></div>
        <div className="metric"><span className="metric-value">{metrics ? fmtInt(metrics.customersAffected) : '—'}</span><span>customers</span></div>
        <div className="metric"><span className="metric-value">{metrics ? fmtDur(metrics.avgDurationMin) : '—'}</span><span>avg duration</span></div>
      </div>
      {metrics && <p className="subtitle">metrics aggregated by worker in {metrics.scanMs.toFixed(0)}ms{timing ? ` · last query: ${timing}` : ''}</p>}

      <div className="toolbar">
        <select value={severity} onChange={onFilter(setSeverity)}>
          <option value="">all severities</option>
          {SEVERITIES.map((s, i) => <option key={s} value={i}>{s}</option>)}
        </select>
        <select value={status} onChange={onFilter(setStatus)}>
          <option value="">all statuses</option>
          {STATUSES.map((s, i) => <option key={s} value={i}>{s}</option>)}
        </select>
        <select value={region} onChange={onFilter(setRegion)}>
          <option value="">all regions</option>
          {REGIONS.map((s, i) => <option key={s} value={i}>{s}</option>)}
        </select>
        <select value={service} onChange={onFilter(setService)}>
          <option value="">all services</option>
          {SERVICES.map((s, i) => <option key={s} value={i}>{s}</option>)}
        </select>
        <input
          type="text"
          placeholder="search site…"
          value={search}
          onChange={(e) => setSearch(e.target.value.toUpperCase())}
        />
        <span className="filtered">
          {fmtInt(filtered)} matching{isFetching ? ' · updating…' : ''}
        </span>
      </div>

      <table>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  style={{ width: h.column.getSize() }}
                  onClick={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined}
                  className={h.column.getCanSort() ? 'sortable' : ''}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {h.column.getIsSorted() === 'asc' ? ' ▲' : h.column.getIsSorted() === 'desc' ? ' ▼' : ''}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pager">
        <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>‹ prev</button>
        <span>
          page {pagination.pageIndex + 1} / {table.getPageCount()}
        </span>
        <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>next ›</button>
        <select
          value={pagination.pageSize}
          onChange={(e) => table.setPageSize(Number(e.target.value))}
        >
          {[25, 50, 100, 200].map((s) => <option key={s} value={s}>{s} / page</option>)}
        </select>
      </div>
    </main>
  );
}
