const LOOPBACK_BINDING = /^127\.0\.0\.1:(\d+)$/;
const INIT_COMPLETE_MARKER = 'PostgreSQL init process complete; ready for start up.';

const defaultSleep = (milliseconds) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

function redactTechnicalLogs(logs, redactValues) {
  let redacted = String(logs);
  for (const value of redactValues) {
    if (value) redacted = redacted.replaceAll(String(value), '[REDACTED]');
  }
  return redacted
    .replace(/(POSTGRES_PASSWORD\s*=\s*)\S+/gi, '$1[REDACTED]')
    .replace(/(password\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
    .slice(-8000);
}

export function waitForStablePostgres({
  readLogs,
  probeSql,
  timeoutMs,
  pollIntervalMs = 250,
  stableProbeIntervalMs = 250,
  now = Date.now,
  sleep = defaultSleep,
  redactValues = []
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('PostgreSQL stable-server timeout must be a positive finite number');
  }
  const deadline = now() + timeoutMs;
  let initComplete = false;
  let successfulProbes = 0;
  let lastLogs = '';

  while (now() < deadline) {
    lastLogs = readLogs();
    initComplete ||= lastLogs.includes(INIT_COMPLETE_MARKER);

    if (initComplete) {
      if (probeSql()) {
        successfulProbes += 1;
        if (successfulProbes === 2) return;
      } else {
        successfulProbes = 0;
      }
    }

    if (now() >= deadline) break;
    sleep(initComplete && successfulProbes === 1 ? stableProbeIntervalMs : pollIntervalMs);
  }

  const technicalLogs = redactTechnicalLogs(lastLogs, redactValues);
  throw new Error(
    `isolated PostgreSQL 15 did not reach a stable final server within ${timeoutMs}ms` +
    `\nLast technical container logs:\n${technicalLogs || '<none>'}`
  );
}

export function parseLoopbackBinding(portText) {
  const bindings = String(portText).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (bindings.length !== 1 || !LOOPBACK_BINDING.test(bindings[0])) {
    throw new Error(`PostgreSQL test port must have exactly one 127.0.0.1 binding; received: ${bindings.join(', ') || '<none>'}`);
  }
  const port = Number(bindings[0].match(LOOPBACK_BINDING)[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PostgreSQL test port is invalid');
  }
  return port;
}

export function startIsolatedPostgres({ docker, state }) {
  docker([
    'run', '--rm', '-d', '--name', state.name,
    '-e', 'POSTGRES_USER=fixture',
    '-e', `POSTGRES_PASSWORD=${state.password}`,
    '-e', 'POSTGRES_DB=horizonst',
    '-p', '127.0.0.1::5432',
    'postgres:15-alpine'
  ]);
  state.containerCreated = true;
  return parseLoopbackBinding(docker(['port', state.name, '5432/tcp']));
}

export function cleanupOwnedContainer({ spawn, state, cwd }) {
  if (!state.containerCreated) return;
  spawn('docker', ['rm', '-f', state.name], { cwd, stdio: 'ignore' });
}
