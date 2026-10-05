/**
 * The wire protocol between instrumented apps, the devtools server, and
 * dashboard viewers — all JSON text frames over WebSocket.
 *
 *   app      → server  /events   { hello } then { batch } frames
 *   server   → viewer  /view     { sessions } on connect, then { batch } per app frame
 */
import type { EmittedDevtoolsEvent } from '@atolljs/core';

/** Identifies one connected app (one page, one Node process). */
export interface SessionInfo {
  /** Client-generated id — stable for the socket's lifetime. */
  id: string;
  /** Human label — config `name`, app title, process argv, etc. */
  name?: string;
  /**
   * The shell's own framework ('react', 'vue', 'svelte', 'solid', 'angular',
   * 'vanilla', …): drawn as the main-thread hub's mark on the app map.
   */
  framework?: string;
  runtime: 'browser' | 'node';
  /** Browser location.href / process title — whatever helps identify it. */
  hint?: string;
  /**
   * Set by the server once the app's socket closes. Closed sessions are
   * retained (bounded) so dashboards can keep post-mortem history instead of
   * orphaning their pools/tasks/memory state.
   */
  closed?: boolean;
  /** Server clock (ms) when the socket closed — drives the cleanup sweep. */
  closedAt?: number;
  /** Viewer-pinned closed sessions are exempt from the retention sweep. */
  pinned?: boolean;
  /** Runtime facts captured at connect, for the dashboard's audits. */
  env?: SessionEnv;
}

export interface SessionEnv {
  /** `crossOriginIsolated` — false means no SharedArrayBuffer doorbell (islands poll). */
  crossOriginIsolated?: boolean;
  sharedArrayBuffer?: boolean;
  hardwareConcurrency?: number;
  userAgent?: string;
  /** Node `process.version` on the Node path. */
  node?: string;
}

export interface HelloMessage {
  type: 'hello';
  session: SessionInfo;
}

export interface BatchMessage {
  type: 'batch';
  events: EmittedDevtoolsEvent[];
}

/**
 * Dashboard → app command (`runDevtoolsCommand` on the app side). `id` is
 * viewer-generated and echoed on the result.
 */
export interface ControlRequest {
  type: 'control';
  sessionId: string;
  id: string;
  cmd: string;
  args?: Record<string, unknown>;
}

/** App → dashboard reply to a ControlRequest. */
export interface ControlResult {
  type: 'control-result';
  sessionId: string;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** What an instrumented app sends on /events. */
export type ClientMessage = HelloMessage | BatchMessage | ControlResult;

/** What the server sends an instrumented app on /events. */
export type AppMessage = ControlRequest;

/** What a dashboard viewer receives on /view. */
export type ViewerMessage =
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'batch'; session: SessionInfo; events: EmittedDevtoolsEvent[] }
  | ControlResult;

/** What a dashboard viewer sends on /view. */
export type ViewerRequest =
  /** Drop a closed session and its replayed history. Live sessions are ignored. */
  | { type: 'dismiss'; sessionId: string }
  /** Exempt a closed session from the retention sweep (or release it). */
  | { type: 'pin'; sessionId: string; pinned: boolean }
  /** Relay a command to the live app with this session id. */
  | ControlRequest;

/**
 * Pure-client transport: frames on a same-origin BroadcastChannel named
 * 'atoll-devtools'. Origin scoping replaces the server's session list —
 * a dashboard on the app's own origin sees exactly the apps on that origin.
 */
export const DEVTOOLS_CHANNEL = 'atoll-devtools';

export type BroadcastMessage =
  | { type: 'hello'; session: SessionInfo }
  | { type: 'batch'; session: SessionInfo; events: EmittedDevtoolsEvent[] }
  /** Posted on close/pagehide so dashboards can mark the session ended. */
  | { type: 'bye'; sessionId: string }
  /** Dashboard announcing itself — apps re-hello and replay their tail. */
  | { type: 'view' }
  /** Dashboard → app command; only the app whose session id matches answers. */
  | ControlRequest
  | ControlResult;
