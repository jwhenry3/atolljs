export const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
export const fmtDur = (m: number) => (m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m.toFixed(0)}m`);
export const fmtDate = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ');
