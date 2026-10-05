/**
 * User Timing bridge: `performance.measure` entries for atoll work, so the
 * browser's own Performance panel shows tasks next to the app's frames.
 * Callers gate on `devtoolsEnabled()`; this module never checks it itself.
 *
 * `detail.devtools` is Chrome's extensibility payload: entries land on a
 * custom track inside an 'atoll' track group. Other engines ignore the
 * detail and record a plain measure.
 */

/** Chrome's extensibility palette names. */
export type TimingColor = 'primary' | 'primary-light' | 'secondary' | 'tertiary' | 'error' | 'warning';

export interface TimingTrack {
  /** Track label inside the 'atoll' group, e.g. a pool id. */
  track: string;
  color?: TimingColor;
  properties?: [string, string | number][];
  tooltipText?: string;
}

type MeasureFn = (name: string, options: { start: number; end: number; detail?: unknown }) => unknown;

/**
 * Record `[start, end]` (performance.now() ms on this thread) as `name`.
 * The entry is cleared from the timeline buffer right away: the Performance
 * panel captures it at measure time, and per-task measures would otherwise
 * grow the buffer without bound (and trip Node's buffer-size warning).
 */
export const measureAtoll = (name: string, start: number, end: number, t: TimingTrack): void => {
  const perf = globalThis.performance as
    | (Performance & { measure?: MeasureFn; clearMeasures?: (name?: string) => void })
    | undefined;
  if (typeof perf?.measure !== 'function') return;
  try {
    perf.measure(name, {
      start,
      end: Math.max(end, start),
      detail: {
        devtools: {
          dataType: 'track-entry',
          track: t.track,
          trackGroup: 'atoll',
          color: t.color ?? 'primary',
          properties: t.properties,
          tooltipText: t.tooltipText,
        },
      },
    });
    perf.clearMeasures?.(name);
  } catch {
    /* engines without the options-object measure signature */
  }
};

/** Main-thread span of one call, dispatch → settle, on the runner's track. */
export const measureTaskCall = (
  runnerId: string,
  taskId: string,
  callId: number,
  slot: number,
  start: number,
  end: number,
  ok: boolean,
): void =>
  measureAtoll(`atoll task ${taskId}`, start, end, {
    track: runnerId,
    color: ok ? 'primary' : 'error',
    properties: [['runner', runnerId], ['slot', slot], ['call', callId], ['outcome', ok ? 'ok' : 'error']],
    tooltipText: `${taskId} on ${runnerId}#${slot}: ${(end - start).toFixed(1)}ms`,
  });
