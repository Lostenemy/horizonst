import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { SmtpClient, deliverNotificationMail } from '../src/modules/shared/mail.js';
import type { StoreMailConfig } from '../src/config/env.js';

const config: StoreMailConfig = { enabled: true, host: 'fixture.invalid', port: 2525, secure: false,
  user: 'fixture', password: randomBytes(32).toString('hex'), from: 'from@example.invalid',
  ehloDomain: 'example.invalid', tlsRejectUnauthorized: true, commercialTo: 'to@example.invalid', appccGuideUrl: '' };
const content = { to: 'to@example.invalid', subject: 'fictitious', text: 'not persisted', html: '<p>not persisted</p>' };

class Socket extends EventEmitter {
  destroyed = false;
  setTimeout(_ms: number) {}
  destroy() { this.destroyed = true; this.emit('close'); }
  write(_data: string, callback: (error?: Error) => void) {
    callback(new Error('fictitious write failure ' + config.password));
    // Native sockets also emit error after a failed write callback, between response waiters.
    queueMicrotask(() => this.emit('error', new Error('fictitious transport error')));
  }
}
{
  const socket = new Socket();
  const client = new SmtpClient(config, () => {
    queueMicrotask(() => { socket.emit('connect'); setImmediate(() => socket.emit('data', Buffer.from('220 ready\r\n'))); });
    return { socket: socket as any, readyEvent: 'connect' };
  });
  const result = await deliverNotificationMail(content, client, 1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result, { state: 'failed_before_send', resultCode: 'before_data' });
  assert.equal(socket.destroyed, true);
  assert.ok(!JSON.stringify(result).includes(config.password));
}
{
  const socket = new Socket();
  const client = new SmtpClient(config, () => {
    queueMicrotask(() => socket.emit('connect')); // Ready TCP, but greeting never arrives.
    return { socket: socket as any, readyEvent: 'connect' };
  });
  assert.deepEqual(await deliverNotificationMail(content, client, 5), { state: 'failed_before_send', resultCode: 'before_data' });
  for (const event of ['data','timeout','close','end']) assert.equal(socket.listenerCount(event),0,`${event} waiter cleaned`);
  assert.equal(socket.destroyed,true);
}
