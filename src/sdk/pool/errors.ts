/** Task queue is at `maxQueue` — dispatch rejected without ever running. */
export class PoolQueueFullError extends Error {
  constructor(message = 'WorkerPool task queue is full') {
    super(message);
    this.name = 'PoolQueueFullError';
  }
}

/** The task's AbortSignal fired — never dispatched, or reply discarded. */
export class TaskAbortedError extends Error {
  constructor(message = 'task aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

/** The task exceeded its `timeout` / pool `taskTimeout` budget. */
export class TaskTimeoutError extends Error {
  constructor(message = 'task timed out') {
    super(message);
    this.name = 'TaskTimeoutError';
  }
}

/** The worker errored/exited, or the pool was terminated mid-flight. */
export class WorkerCrashedError extends Error {
  constructor(message = 'worker crashed') {
    super(message);
    this.name = 'WorkerCrashedError';
  }
}
