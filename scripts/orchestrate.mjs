import { execFileSync, spawn, spawnSync } from 'node:child_process';
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

/** Returns the set of PIDs listening on the given ports (pid → Set<port>). */
function listenersByPort(ports) {
  const pids = new Map();
  const add = (pid, port) => {
    if (!pids.has(pid)) pids.set(pid, new Set());
    pids.get(pid).add(port);
  };

  if (windows) {
    // netstat -ano: proto  local  foreign  state  pid
    // NOTE: no -p flag — `-p tcp` on Windows lists IPv4 TCP only, hiding
    // [::1]:port listeners. Plain -ano covers both families; the LISTENING
    // filter excludes UDP rows (they carry no state).
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1];
      const pid = Number(cols.at(-1));
      for (const port of ports) {
        if (local.endsWith(`:${port}`)) add(pid, port);
      }
    }
  } else {
    for (const port of ports) {
      try {
        const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
          encoding: 'utf8',
        });
        for (const pid of out.trim().split('\n')) {
          if (pid) add(Number(pid), port);
        }
      } catch {
        // lsof exits non-zero when nothing listens on the port.
      }
    }
  }
  return pids;
}

/**
 * Kill whatever is listening on the given ports — the "stop stale servers"
 * step: orphaned servers from a force-killed orchestrator would otherwise
 * fail the next serve with EADDRINUSE. Returns true when the ports are
 * clear (nothing listened, or every listener was killed).
 */
export function killStaleServers(ports) {
  const pids = listenersByPort(ports);
  if (pids.size === 0) return true;
  let allKilled = true;
  for (const [pid, listened] of pids) {
    const label = [...listened].map((p) => `:${p}`).join(', ');
    const result = windows
      ? spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'inherit' })
      : spawnSync('kill', ['-9', String(pid)], { stdio: 'inherit' });
    console.log(
      result.status === 0
        ? `stopped stale server pid ${pid} (${label})`
        : `failed to kill pid ${pid} (${label})`,
    );
    if (result.status !== 0) allKilled = false;
  }
  return allKilled;
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
