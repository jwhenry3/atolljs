// Node worker_threads entry — the shim binds self = parentPort BEFORE
// workerBootstrap evaluates; import order is the contract.
import '@atolljs/node/shim';
import '@atolljs/core/worker/workerBootstrap';
import { TaskRegistry } from '@atolljs/core';
import { jobsMemory, ProcessJob } from './jobs.contract';

// A job is a bounded CPU loop — a stand-in for real batch work (report
// generation, encoding, import parsing). Each completion is a shared-memory
// write, not a message back to the API thread.
TaskRegistry.register(ProcessJob, (id, workMs = 50) => {
  const t0 = performance.now();
  let acc = 0;
  while (performance.now() - t0 < workMs) acc += Math.sqrt(acc);
  const completed = jobsMemory.completed.read() + 1;
  jobsMemory.completed.write(completed);
  jobsMemory.lastMs.write(performance.now() - t0);
  return { id, ms: performance.now() - t0, completed };
});
