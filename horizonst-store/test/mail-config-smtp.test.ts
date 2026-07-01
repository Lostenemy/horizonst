import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { validateStoreMailConfig, type StoreMailConfig } from '../src/config/env.js';
import { automaticMailFooter, buildOrderConfirmationEmail, buildQuoteAcceptedCommercialEmail, buildQuoteAvailableEmail, sanitizeMailError, SmtpClient } from '../src/modules/shared/mail.js';

const quoteId = '11111111-1111-4111-8111-111111111111';
const orderId = '44444444-4444-4444-8444-444444444444';
const quote = { id: quoteId, quote_number: 'Q-1', total_cents: 1210, email: 'u@example.com', full_name: 'User Test', role: 'customer' };
const order = { id: orderId, order_number: 'ORD-Q-1' };

const mailConfig: StoreMailConfig = {
  enabled: true,
  host: 'mail.horizonst.com.es',
  port: 465,
  secure: true,
  user: 'smtp@horizonst.com.es',
  password: 'valid-password',
  from: 'no_reply@horizonst.com.es',
  ehloDomain: 'horizonst.com.es',
  tlsRejectUnauthorized: true,
  commercialTo: 'comercial@horizonst.com.es'
};

{
  const email = buildQuoteAvailableEmail({ quote });
  assert.equal(email.to, 'u@example.com');
  assert.equal(email.subject, 'Presupuesto disponible: Q-1');
  assert.match(email.text, /está disponible/);
  assert.match(email.text, /descargar el PDF, aceptarlo o rechazarlo/);
  assert.match(email.text, /https:\/\/tienda\.horizonst\.com\.es\/quotes/);
  assert.doesNotMatch(email.text, new RegExp(`/quotes/${quoteId}`));
  assert.match(email.text, new RegExp(automaticMailFooter));
}

{
  const email = buildQuoteAcceptedCommercialEmail({ quote, order });
  assert.equal(email.to, 'comercial@horizonst.com.es');
  assert.equal(email.subject, 'Presupuesto aceptado: Q-1');
  assert.match(email.text, /Cliente: User Test/);
  assert.match(email.text, /Email: u@example\.com/);
  assert.match(email.text, /Rol: customer/);
  assert.match(email.text, /Presupuesto: Q-1/);
  assert.match(email.text, /Pedido: ORD-Q-1/);
  assert.match(email.text, new RegExp(`https:\/\/tienda\.horizonst\.com\.es\/admin\/orders\/${orderId}`));
  assert.match(email.text, new RegExp(automaticMailFooter));
}

{
  const email = buildOrderConfirmationEmail({ quote, order });
  assert.equal(email.subject, 'Pedido confirmado: ORD-Q-1');
  assert.match(email.text, /presupuesto Q-1/);
  assert.match(email.text, /pedido ORD-Q-1/);
  assert.match(email.text, /https:\/\/tienda\.horizonst\.com\.es\/orders/);
  assert.match(email.text, /contactará contigo/);
  assert.match(email.text, new RegExp(automaticMailFooter));
}

for (const invalid of [
  { user: '', password: 'valid-password' },
  { user: 'smtp@horizonst.com.es', password: '' },
  { user: 'store-smtp-user@example.com', password: 'valid-password' },
  { user: 'smtp@example.com', password: 'valid-password' },
  { user: 'smtp@example.invalid', password: 'valid-password' },
  { user: 'smtp@horizonst.com.es', password: 'change-me' },
  { user: 'smtp@horizonst.com.es', password: 'change_me' }
]) {
  assert.throws(() => validateStoreMailConfig({ ...mailConfig, ...invalid }, 'production'), /Store mail credentials/);
}

assert.doesNotThrow(() => validateStoreMailConfig({ ...mailConfig, enabled: false, user: '', password: '' }, 'development'));

class FakeSocket extends EventEmitter {
  writes: string[] = [];
  ended = false;
  destroyed = false;
  timeoutCalls = 0;
  constructor(private readonly responses: string[] = [], private readonly timeoutOnCall = 0, private readonly failQuit = false) { super(); }
  write(data: string, callback: (error?: Error) => void) {
    this.writes.push(data);
    if (this.failQuit && data.startsWith('QUIT')) { callback(new Error('quit boom')); return; }
    callback();
    const response = data.includes('\r\n.\r\n') ? '250 queued\r\n' : this.responses.shift();
    if (response) setTimeout(() => this.emit('data', Buffer.from(response)), 0);
  }
  setTimeout(ms: number) {
    if (ms > 0) {
      this.timeoutCalls += 1;
      if (this.timeoutOnCall === this.timeoutCalls) setTimeout(() => this.emit('timeout'), 0);
    }
  }
  end() { this.ended = true; }
  destroy() { this.destroyed = true; }
}

{
  const socket = new FakeSocket([
    '250-mail.horizonst.com.es\r\n250 AUTH LOGIN\r\n',
    '334 VXNlcm5hbWU6\r\n',
    '334 UGFzc3dvcmQ6\r\n',
    '235 authenticated\r\n',
    '250 sender ok\r\n',
    '250 recipient ok\r\n',
    '354 end data\r\n',
    '221 bye\r\n'
  ]);
  const client = new SmtpClient(mailConfig, () => ({ socket: socket as any, readyEvent: 'secureConnect' }));
  const connectPromise = client.connect();
  socket.emit('secureConnect');
  setTimeout(() => socket.emit('data', Buffer.from('220-mail.horizonst.com.es\r\n220 ready\r\n')), 0);
  await connectPromise;
  await client.sendMail('u@example.com', 'Subject', '.line');
  await client.close();
  assert.ok(socket.writes.some((write) => write.includes('\r\n..line\r\n.\r\n')), 'DATA applies dot-stuffing');
  assert.equal(socket.ended, true);
  assert.equal(socket.destroyed, true);
}

{
  const socket = new FakeSocket([], 2);
  const client = new SmtpClient(mailConfig, () => ({ socket: socket as any, readyEvent: 'secureConnect' }));
  const connectPromise = client.connect();
  socket.emit('secureConnect');
  setTimeout(() => socket.emit('data', Buffer.from('220 ready\r\n')), 0);
  await assert.rejects(connectPromise, /smtp_timeout/);
}

{
  const socket = new FakeSocket([], 0, true);
  const client = new SmtpClient(mailConfig, () => ({ socket: socket as any, readyEvent: 'secureConnect' }));
  (client as any).socket = socket;
  await client.close();
  assert.equal(socket.ended, true);
  assert.equal(socket.destroyed, true);
}

assert.equal(sanitizeMailError(new Error('smtp@horizonst.com.es failed secret-password'), { user: 'smtp@horizonst.com.es', password: 'secret-password' }), '[redacted] failed [redacted]');
