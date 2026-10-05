/**
 * The ops console's CPU work, with no React and no island imports, so
 * compute.worker.ts stays a lean bundle. Render workers import it too
 * (row A runs it inline on purpose, to show the stall).
 */
const REGIONS = ['us-east', 'us-west', 'eu-central', 'ap-south', 'sa-east'];

export interface AggregateResult {
  rows: number;
  ms: number;
  p1: number;
  meanDur: number;
}

/**
 * A deliberately synchronous aggregation over pseudo incidents: severity
 * histogram + mean duration per region, run until `budgetMs` has elapsed.
 * Stands in for real report/forecast work (CSV export, model scoring) that
 * holds the thread for a second or more.
 */
export function aggregate(budgetMs: number, region?: string): AggregateResult {
  const t0 = performance.now();
  let rows = 0;
  let p1 = 0;
  let durSum = 0;
  let matched = 0;
  for (let i = 0; ; i++) {
    const r = REGIONS[i % REGIONS.length];
    if (region === undefined || r === region) {
      const sev = (i * 31) % 100;
      const dur = ((i * 104729) % 977) % 60;
      if (sev > 75) p1++;
      durSum += Math.sqrt(dur * dur + sev);
      matched++;
    }
    rows++;
    if ((i & 0x3fff) === 0 && performance.now() - t0 >= budgetMs) break;
  }
  return { rows, ms: performance.now() - t0, p1, meanDur: matched ? durSum / matched : 0 };
}
