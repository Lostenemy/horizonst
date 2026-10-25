'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { environment } = require('./run-suites.cjs');
const root = path.resolve(__dirname, '../..');
if (process.versions.node !== '22.23.4') throw new Error('Node 22.23.4 required');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'horizonst-store-lifecycle-'));
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'horizonst-store-lifecycle-evidence-'));
const service = path.join(workspace, 'horizonst-store');
fs.mkdirSync(service);
for (const item of ['src', 'test', 'integration', 'scripts', 'resources', 'migrations',
  'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'Dockerfile']) {
  fs.cpSync(path.join(root, 'horizonst-store', item), path.join(service, item), {
    recursive: true, filter: file => !path.basename(file).startsWith('.env')
  });
}
fs.mkdirSync(path.join(service, 'web'));
for (const item of ['src', 'public', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts']) {
  fs.cpSync(path.join(root, 'horizonst-store/web', item), path.join(service, 'web', item), {
    recursive: true, filter: file => !path.basename(file).startsWith('.env')
  });
}
for (const location of ['horizonst-store', 'horizonst-store/web']) {
  fs.symlinkSync(path.join(root, location, 'node_modules'), path.join(workspace, location, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir');
}
fs.mkdirSync(path.join(workspace, 'scripts'));
fs.copyFileSync(path.join(root, 'docker-compose.yml'), path.join(workspace, 'docker-compose.yml'));
for (const item of ['auth-rate-limit-contract.cjs', 'reset-transaction-fixture.cjs', 'trusted-proxy-contract.cjs']) {
  fs.copyFileSync(path.join(root, 'scripts', item), path.join(workspace, 'scripts', item));
}
const env = { ...environment(), STORE_JWT_SECRET: require('node:crypto').randomBytes(32).toString('hex') };
const results = [];
const run = (name, args) => {
  const r = spawnSync(process.execPath, args, { cwd: service, env, encoding: 'utf8', timeout: 150_000,
    maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  fs.writeFileSync(path.join(evidence, name + '.log'), (r.stdout || '') + (r.stderr || ''));
  const counts = {};
  for (const m of (r.stdout || '').matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)$/gm)) counts[m[1]] = +m[2];
  results.push({ name, exitCode: r.status, ...counts });
  console.log(JSON.stringify(results.at(-1)));
};
console.log(JSON.stringify({ workspace, evidence, runtime: process.version }));
const tsc = path.join(service, 'node_modules/typescript/bin/tsc');
run('typecheck', [tsc, '--noEmit']);
run('backend-build', [tsc, '-p', 'tsconfig.build.json']);
run('frontend-build', [path.join(service, 'web/node_modules/vite/bin/vite.js'), 'build', 'web']);
// Compile beside sources ONLY inside the acquired workspace: preserve import.meta.url fixtures.
// Avoid TSX's optional watch IPC entirely; no loader or dependency is modified.
const ts = require(path.join(service, 'node_modules/typescript'));
const compile = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) compile(file);
    else if (/\.tsx?$/.test(file) && !file.endsWith('.d.ts')) {
      const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
          jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
      const code = result.outputText.replace(/((?:from\s*|import\s*\()\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,
        (all, prefix, specifier, quote) => {
          const base = path.resolve(path.dirname(file), specifier);
          if (fs.existsSync(base + '.ts') || fs.existsSync(base + '.tsx')) return prefix + specifier + '.js' + quote;
          if (fs.existsSync(path.join(base, 'index.ts'))) return prefix + specifier + '/index.js' + quote;
          return all;
        });
      fs.writeFileSync(file.replace(/\.tsx?$/, '.js'), code);
    }
  }
};
for (const item of ['src', 'web/src', 'test', 'integration']) compile(path.join(service, item));
const preload = path.join(__dirname, 'offline-preload.cjs');
run('suite', ['--require', preload, '--input-type=module', '-e', `
  import {readdir} from 'node:fs/promises'; import {pathToFileURL} from 'node:url'; import path from 'node:path';
  const files=(await readdir('test')).filter(n=>n.endsWith('.test.js')).sort();
  for(const file of files){await import(pathToFileURL(path.resolve('test',file)).href);console.log('Store module passed: '+file);}
  console.log('Store modules passed: '+files.length);
`]);
for (let i = 1; i <= 3; i++) run(`lifecycle-${i}`, ['--require', preload,
  '--test', '--test-reporter=tap', 'integration/lifecycle.unit.test.js']);
fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify({ workspace, evidence, runtime: process.version, results }, null, 2));
process.exitCode = results.some(r => r.exitCode !== 0) ? 1 : 0;
