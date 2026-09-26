import { REGIONS, SERVICES, SEVERITIES, STATUSES, type IncidentRow } from './contract/memory.contracts';
import { fmtDate, fmtDur, fmtInt } from './format';

export interface IncidentColumn {
  key: keyof IncidentRow;
  label: string;
  text: (row: IncidentRow) => string;
  badge?: (row: IncidentRow) => string;
}

export const SEVERITY_CLASSES = ['sev-info', 'sev-minor', 'sev-major', 'sev-critical'];
export const STATUS_CLASSES = ['st-open', 'st-ack', 'st-resolved'];

export const incidentColumns: IncidentColumn[] = [
  { key: 'id', label: 'ID', text: (r) => String(r.id) },
  { key: 'site', label: 'Site', text: (r) => r.site },
  { key: 'severity', label: 'Severity', text: (r) => SEVERITIES[r.severity], badge: (r) => SEVERITY_CLASSES[r.severity] },
  { key: 'status', label: 'Status', text: (r) => STATUSES[r.status], badge: (r) => STATUS_CLASSES[r.status] },
  { key: 'region', label: 'Region', text: (r) => REGIONS[r.region] },
  { key: 'service', label: 'Service', text: (r) => SERVICES[r.service] },
  { key: 'openedAt', label: 'Opened', text: (r) => fmtDate(r.openedAt) },
  { key: 'durationMin', label: 'Duration', text: (r) => fmtDur(r.durationMin) },
  { key: 'customers', label: 'Customers', text: (r) => fmtInt(r.customers) },
  { key: 'alarms', label: 'Alarms', text: (r) => String(r.alarms) },
];
