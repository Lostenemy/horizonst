'use strict';
const Module = require('node:module');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const load = Module._load;
// Only test processes: prevent application config from opening any .env file.
Module._load = function (name, parent, main) {
  if (name === 'dotenv' || name === 'dotenv/config') return { config: () => ({ parsed: {} }) };
  return load.call(this, name, parent, main);
};
const read = fs.readFileSync;
const sensitive = file => /(?:^\.env(?:\.|$)|\.env$)/i.test(path.basename(String(file)));
fs.readFileSync = function (file, ...args) {
  if (sensitive(file)) throw new Error('OFFLINE_TEST_ENV_FILE_DENIED');
  return read.call(this, file, ...args);
};
// Permit only HTTP fixtures owned by this process; reject PostgreSQL/MQTT/SMTP/providers.
const ports = new Set();
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  this.once('listening', () => {
    const address = this.address();
    if (address && typeof address === 'object') {
      ports.add(address.port);
      this.once('close', () => ports.delete(address.port));
    }
  });
  return listen.apply(this, args);
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof normalized[0] === 'object' ? normalized[0]
    : { port: normalized[0], host: typeof normalized[1] === 'string' ? normalized[1] : 'localhost' };
  if (!['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(options.host || 'localhost')
      || !ports.has(Number(options.port))) {
    process.exitCode = 1; // A caught accidental connection still fails this test worker.
    console.error('OFFLINE_TEST_NETWORK_DENIED');
    throw new Error('OFFLINE_TEST_NETWORK_DENIED: transport must be mocked');
  }
  return connect.apply(this, args);
};
