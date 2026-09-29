import type { ColumnDef } from '@tanstack/react-table';
import {
  fmtDate,
  fmtDur,
  fmtInt,
  REGIONS,
  SERVICES,
  SEVERITIES,
  SEVERITY_CLASSES,
  STATUSES,
  STATUS_CLASSES,
  type IncidentRow,
} from '@atolljs/incidents';

export const incidentColumns: ColumnDef<IncidentRow>[] = [
  { accessorKey: 'id', header: 'ID', size: 70 },
  { accessorKey: 'site', header: 'Site', size: 90 },
  {
    accessorKey: 'severity',
    header: 'Severity',
    cell: (c) => <span className={`badge ${SEVERITY_CLASSES[c.getValue<number>()]}`}>{SEVERITIES[c.getValue<number>()]}</span>,
    size: 90,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: (c) => <span className={`badge ${STATUS_CLASSES[c.getValue<number>()]}`}>{STATUSES[c.getValue<number>()]}</span>,
    size: 110,
  },
  { accessorKey: 'region', header: 'Region', cell: (c) => REGIONS[c.getValue<number>()], size: 90 },
  { accessorKey: 'service', header: 'Service', cell: (c) => SERVICES[c.getValue<number>()], size: 100 },
  { accessorKey: 'openedAt', header: 'Opened', cell: (c) => fmtDate(c.getValue<number>()), size: 130 },
  { accessorKey: 'durationMin', header: 'Duration', cell: (c) => fmtDur(c.getValue<number>()), size: 80 },
  { accessorKey: 'customers', header: 'Customers', cell: (c) => fmtInt(c.getValue<number>()), size: 90 },
  { accessorKey: 'alarms', header: 'Alarms', size: 70 },
];
