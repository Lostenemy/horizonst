// Solo para pruebas: no cargar .env ni permitir conexiones a servicios/hardware.
const Module = require('node:module');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === 'dotenv' || id === 'dotenv/config') return { config: () => ({ parsed: {} }) };
  return originalLoad.call(this, id, parent, isMain);
};

const hiddenEnv = (file) => {
  if (typeof file !== 'string' && !(file instanceof URL)) return false;
  const name = path.basename(String(file));
  return /^\.env(?:\.|$)/.test(name) && !name.endsWith('.example');
};
const missing = () => Object.assign(new Error('Local environment files disabled during isolated tests'), { code: 'ENOENT' });
const existsSync = fs.existsSync;
fs.existsSync = (file) => hiddenEnv(file) ? false : existsSync(file);
const readFileSync = fs.readFileSync;
fs.readFileSync = function (file, ...args) { if (hiddenEnv(file)) throw missing(); return readFileSync.call(this, file, ...args); };
const readFile = fs.readFile;
fs.readFile = function (file, ...args) { if (hiddenEnv(file)) { args.at(-1)(missing()); return; } return readFile.call(this, file, ...args); };
const readFileAsync = fs.promises.readFile;
fs.promises.readFile = async function (file, ...args) { if (hiddenEnv(file)) throw missing(); return readFileAsync.call(this, file, ...args); };

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof normalized[0] === 'object' ? normalized[0] : { port: normalized[0], host: typeof normalized[1] === 'string' ? normalized[1] : 'localhost' };
  const host = options.host || 'localhost';
  const port = Number(options.port);
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || !Number.isInteger(port) || port < 1024 || [1883, 8883, 5432, 5433, 6379].includes(port)) {
    throw new Error('External service connection blocked by security-test-isolation');
  }
  return originalConnect.apply(this, args);
};
Module.syncBuiltinESMExports();
