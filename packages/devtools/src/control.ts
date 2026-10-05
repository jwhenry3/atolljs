/**
 * App side of the control channel: answer a dashboard `control` frame by
 * running the named command (`registerDevtoolsCommand` in @atolljs/core)
 * and replying with a `control-result`. Both transports share this.
 */
import { runDevtoolsCommand } from '@atolljs/core';
import type { ControlRequest, ControlResult, SessionEnv } from './protocol';

/** Make a command result transport-safe: JSON round-trip, functions dropped. */
const jsonSafe = (v: unknown): unknown => {
  if (v === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
};

export const answerControl = async (
  req: ControlRequest,
  reply: (res: ControlResult) => void,
): Promise<void> => {
  try {
    const result = await runDevtoolsCommand(req.cmd, req.args ?? {});
    reply({ type: 'control-result', sessionId: req.sessionId, id: req.id, ok: true, result: jsonSafe(result) });
  } catch (err) {
    reply({
      type: 'control-result',
      sessionId: req.sessionId,
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/** Runtime facts for the session's `env` — what the audits panel reasons over. */
export const captureEnv = (): SessionEnv => {
  const g = globalThis as {
    crossOriginIsolated?: boolean;
    navigator?: { hardwareConcurrency?: number; userAgent?: string };
    process?: { version?: string };
  };
  return {
    crossOriginIsolated: g.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    hardwareConcurrency: g.navigator?.hardwareConcurrency,
    userAgent: g.navigator?.userAgent,
    node: g.navigator ? undefined : g.process?.version,
  };
};
