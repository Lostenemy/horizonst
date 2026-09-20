const LOOPBACK_BINDING = /^127\.0\.0\.1:(\d+)$/;

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
