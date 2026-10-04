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
  runtime: 'browser' | 'node';
  /** Browser location.href / process title — whatever helps identify it. */
  hint?: string;
  /**
   * Set by the server once the app's socket closes. Closed sessions are
   * retained (bounded) so dashboards can keep post-mortem history instead of
   * orphaning their pools/tasks/memory state.
   */
  closed?: boolean;
}

export interface HelloMessage {
  type: 'hello';
  session: SessionInfo;
}

export interface BatchMessage {
  type: 'batch';
  events: EmittedDevtoolsEvent[];
}

/** What an instrumented app sends on /events. */
export type ClientMessage = HelloMessage | BatchMessage;

/** What a dashboard viewer receives on /view. */
export type ViewerMessage =
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'batch'; session: SessionInfo; events: EmittedDevtoolsEvent[] };

/** What a dashboard viewer sends on /view. */
export type ViewerRequest =
  /** Drop a closed session and its replayed history. Live sessions are ignored. */
  | { type: 'dismiss'; sessionId: string };
