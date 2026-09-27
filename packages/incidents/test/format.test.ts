import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDur, fmtInt } from '../src/format';
import { incidentColumns, SEVERITY_CLASSES, STATUS_CLASSES } from '../src/table';
import { INCIDENT_FIELDS } from '../src/contract/memory.contracts';

describe('format', () => {
  it('fmtInt renders grouped integers without decimals', () => {
    expect(fmtInt(1000000)).toBe((1000000).toLocaleString());
    expect(fmtInt(3.7)).toBe('4');
  });

  it('fmtDur switches to hours at 60m', () => {
    expect(fmtDur(45)).toBe('45m');
    expect(fmtDur(90)).toBe('1.5h');
  });

  it('fmtDate renders YYYY-MM-DD HH:mm', () => {
    expect(fmtDate(1700000000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

describe('incidentColumns', () => {
  it('covers renderable fields and labels', () => {
    for (const col of incidentColumns) {
      expect(INCIDENT_FIELDS).toContain(col.key);
      expect(col.label).toBeTruthy();
    }
  });

  it('badge classes exist for severity and status', () => {
    const sev = incidentColumns.find((c) => c.key === 'severity');
    const st = incidentColumns.find((c) => c.key === 'status');
    expect(sev?.badge?.({ severity: 3 } as any)).toBe(SEVERITY_CLASSES[3]);
    expect(st?.badge?.({ status: 2 } as any)).toBe(STATUS_CLASSES[2]);
  });
});
