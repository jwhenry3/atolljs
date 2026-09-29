import { spawn } from 'node:child_process';
import net from 'node:net';

const windows = process.platform === 'win32';
export const npmCmd = windows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
export const npmScript = (script) => npmArgs('run', script);
export const npmArgs = (...args) =>
  windows ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args;

let stopping = false;
const children = new Set();

function pipePrefixed(name, stream) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) process.stdout.write(`[${name}] ${line}\n`);
  });
  stream.on('end', () => {
    if (pending) process.stdout.write(`[${name}] ${pending}\n`);
  });
}

// Long-lived process — if it exits unexpectedly, everything stops.
export function launch(name, cwd, command, args) {
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: !windows,
  });
  children.add(child);
  pipePrefixed(name, child.stdout);
  pipePrefixed(name, child.stderr);
  child.on('error', (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping && code !== 0) {
      console.error(`[${name}] exited with ${signal ?? `code ${code}`}`);
      stop(code ?? 1);
    }
  });
  return child;
}

// Finite step (e.g. a build) — resolves on success, rejects on failure.
export function runStep(name, cwd, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    children.add(child);
    pipePrefixed(name, child.stdout);
    pipePrefixed(name, child.stderr);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`[${name}] exited with ${signal ?? `code ${code}`}`));
    });
  });
}

// Preflight — verify each app's port is free before spawning anything, so a
// stale server produces one clear message instead of a cascade of EADDRINUSE
// exits that kill the whole group.
export async function checkPorts(apps) {
  // apps: [name, port]
  const busy = [];
  await Promise.all(
    apps.map(
      ([name, port]) =>
        new Promise((resolve) => {
          let pending = 2;
          const mark = (host) => {
            const socket = net
              .connect({ port, host })
              .once('connect', () => {
                socket.destroy();
                busy.push(`${name} (:${port})`);
                resolve();
              })
              .once('error', () => {
                if (--pending === 0) resolve();
              });
          };
          // A stale server on either address family can collide with a new
          // bind, so probe both IPv4 and IPv6 loopback.
          mark('127.0.0.1');
          mark('::1');
        })
    )
  );
  if (busy.length) {
    console.error(`ports already in use: ${busy.join(', ')} — stop the stale servers first`);
    return false;
  }
  return true;
}

export function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.killed || child.exitCode !== null) continue;
    if (windows) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  }
  setTimeout(() => process.exit(code), 750);
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
process.on('uncaughtException', (error) => {
  console.error(error);
  stop(1);
});
