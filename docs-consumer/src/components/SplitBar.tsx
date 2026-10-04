/** Worker's share of a combined two-thread quantity (0 when none). */
export const workerShare = (main: number, worker: number): number =>
  worker ? Math.round((worker / (main + worker)) * 100) : 0;

export interface Segment {
  value: number;
  className: string;
  title: string;
}

export function SplitBar({
  main,
  worker,
  label,
}: {
  main: number;
  worker: number;
  label: string;
}) {
  const workerPct = workerShare(main, worker);
  return (
    <Segments
      segments={[
        {
          value: main,
          className: 'loadbar-main',
          title: `main thread, ${100 - workerPct}% of ${label}`,
        },
        {
          value: worker,
          className: 'loadbar-worker',
          title: `worker thread, ${workerPct}% of ${label}`,
        },
      ]}
    />
  );
}

/** N-way bar: each segment's width is its share of the segment total. */
export function Segments({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div className="loadbar">
      {segments.map((s, i) => (
        <div
          key={i}
          className={s.className}
          style={{ width: `${(100 * s.value) / total}%` }}
          title={s.title}
        />
      ))}
    </div>
  );
}
