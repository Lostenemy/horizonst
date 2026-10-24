// Guard incremental: informa solo rutas y números de línea, nunca el valor detectado.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const fs = require('node:fs');

// These exact public trust assets are the only PEM exceptions. Validate the
// complete Git blob, not just added lines or a potentially modified checkout.
const publicCertificatePaths = new Set([
  'infrastructure/security/emudhra/certifi/priv/cacerts.pem',
  ...['dv', 'ov', 'ev'].flatMap((kind) => ['g3b', 'g3c'].flatMap((generation) =>
    ['', 'aaa-'].map((crossSign) => `infrastructure/security/emudhra/chains/${kind}-${generation}-${crossSign}emudhra.we-have-a-problem.com.pem`))),
  'infrastructure/security/emudhra/chains/dv-g3b-noct-emudhra.we-have-a-problem.com.pem',
  'infrastructure/security/emudhra/chains/dv-g3b-aaa-noct-emudhra.we-have-a-problem.com.pem',
]);
const containsOnlyPublicCertificates = (content) => {
  if (looksLikeSecret(content)) return false;
  const certificate = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  const blocks = content.match(certificate) || [];
  if (blocks.length === 0) return false;
  const remainder = content.replace(certificate, '').split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith('#'));
  if (remainder.length > 0) return false;
  try {
    for (const block of blocks) new X509Certificate(block);
    return true;
  } catch {
    return false;
  }
};

const forbiddenPath = (file) => {
  const name = path.posix.basename(file);
  if (name.endsWith('.example')) return false;
  return /^\.env(?:\.|$)/i.test(name) || /\.env$/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name) || /(?:^|\/)node_modules\//.test(file);
};
const looksLikeSecret = (line) => /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line);

if (process.argv.includes('--self-test')) {
  for (const file of ['backend/.env', 'release/backend-.env', 'release/mailserver.env', 'certs/client.key', 'backend/node_modules/a/index.js']) assert.equal(forbiddenPath(file), true);
  for (const file of ['backend/.env.example', 'src/config/env.ts', 'src/auth.ts']) assert.equal(forbiddenPath(file), false);
  assert.equal(looksLikeSecret('gh' + 'p_' + 'a'.repeat(36)), true);
  assert.equal(looksLikeSecret('JWT_SECRET: process.env.JWT_SECRET'), false);
  const fixturePath = 'infrastructure/security/emudhra/chains/dv-g3b-emudhra.we-have-a-problem.com.pem';
  const sample = fs.readFileSync(path.resolve(__dirname, '..', fixturePath), 'utf8');
  assert.equal(publicCertificatePaths.size, 15);
  assert.equal(publicCertificatePaths.has(fixturePath), true);
  assert.equal(publicCertificatePaths.has('certs/client.pem'), false);
  assert.equal(publicCertificatePaths.has('infrastructure/security/emudhra/chains/client.pem'), false);
  assert.equal(forbiddenPath(fixturePath), true); // No blanket PEM exemption.
  assert.equal(containsOnlyPublicCertificates(sample), true);
  assert.equal(containsOnlyPublicCertificates('# public chain\n' + sample), true);
  assert.equal(containsOnlyPublicCertificates('not a certificate'), false);
  assert.equal(containsOnlyPublicCertificates(sample + '\nunexpected payload'), false);
  assert.equal(containsOnlyPublicCertificates(sample + '\n# gh' + 'p_' + 'a'.repeat(36)), false);
  const privateMarker = '-----BEGIN ' + 'PRIVATE KEY-----\nnot-a-key\n-----END ' + 'PRIVATE KEY-----';
  assert.equal(containsOnlyPublicCertificates(sample + '\n' + privateMarker), false);
  assert.equal(containsOnlyPublicCertificates(privateMarker), false);
  assert.equal(containsOnlyPublicCertificates('-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----'), false);
  console.log('Security artifact guard: self-test OK');
  process.exit(0);
}

const baseIndex = process.argv.indexOf('--base');
const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : null;
if (baseIndex >= 0 && !/^[a-f0-9]{40}$/i.test(base || '')) throw new Error('Expected an immutable base SHA');
const comparison = base ? [base, 'HEAD'] : ['--cached'];
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
const files = git(['diff', '--name-only', '-z', '--diff-filter=AM', ...comparison, '--']).split('\0').filter(Boolean);
let failures = 0;
for (const file of files) {
  if (forbiddenPath(file)) {
    const publicCertificate = publicCertificatePaths.has(file)
      && containsOnlyPublicCertificates(git(['show', base ? `HEAD:${file}` : `:${file}`]));
    if (!publicCertificate) {
      console.error(`Blocked sensitive artifact: ${JSON.stringify(file)}`);
      failures++;
      continue; // No leer el contenido de archivos de entorno o claves.
    }
  }
  const diff = git(['diff', '--no-ext-diff', '--no-textconv', '--unified=0', ...comparison, '--', file]);
  let lineNumber = 0;
  for (const line of diff.split('\n')) {
    const hunk = /^@@ .* \+(\d+)/.exec(line);
    if (hunk) { lineNumber = Number(hunk[1]); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (looksLikeSecret(line.slice(1))) { console.error(`Potential secret: ${JSON.stringify(file)}:${lineNumber}`); failures++; }
    lineNumber++;
  }
}
console.log(`Security artifact guard: ${files.length} files checked, ${failures} findings. Historical secrets are outside this incremental check.`);
process.exitCode = failures ? 1 : 0;
