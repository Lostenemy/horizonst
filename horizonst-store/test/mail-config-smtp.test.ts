import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { validateStoreMailConfig, type StoreMailConfig } from '../src/config/env.js';
import { automaticMailFooter, buildAppccGuideEmail, buildDistributorWelcomeEmail, buildEmailVerificationEmail, buildOrderConfirmationEmail, buildPrereservationCommercialEmail, buildPrereservationConfirmationEmail, buildQuoteAcceptedCommercialEmail, buildQuoteAvailableEmail, sendAppccGuideEmail, sanitizeMailError, SmtpClient } from '../src/modules/shared/mail.js';

const quoteId = '11111111-1111-4111-8111-111111111111';
const orderId = '44444444-4444-4444-8444-444444444444';
const quote = { id: quoteId, quote_number: 'Q-1', total_cents: 1210, email: 'u@example.com', full_name: 'User Test', role: 'customer' };
const order = { id: orderId, order_number: 'ORD-Q-1' };

const mailConfig: StoreMailConfig = {
  enabled: true,
  host: 'mail.horizonst.es',
  port: 465,
  secure: true,
  user: 'smtp@horizonst.es',
  password: 'valid-password',
  from: 'no_reply@horizonst.es',
  ehloDomain: 'horizonst.es',
  tlsRejectUnauthorized: true,
  commercialTo: 'comercial@horizonst.es',
  appccGuideUrl: 'https://horizonst.es/guia-appcc.pdf'
};

const prereservationInput = {
  prereservation: { id: '33333333-3333-4333-8333-333333333333', email: 'interesado@example.test', code: 'professional', confirmedAt: '2026-08-01T10:00:00.000Z' },
  offer: { hardware: { name: 'Pack Professional', priceCents: 650000, coverageSquareMeters: 1000 }, webPlan: { name: 'Professional', priceCents: 90000 }, subtotalCents: 740000, discountCents: 37000, taxCents: 147630, totalCents: 850630 }
};

{
  const email = buildPrereservationConfirmationEmail(prereservationInput);
  assert.equal(email.to, 'interesado@example.test');
  assert.match(email.text, /Pack Professional/);
  assert.match(email.text, /Cobertura aproximada: hasta 1000 m²/);
  assert.match(email.text, /Professional/);
  assert.match(email.text, /900,00/, 'the email renders the plan price supplied by the current database calculation');
  assert.match(email.text, /5 %/);
  assert.match(email.text, /IVA/);
  assert.match(email.text, /1 de septiembre de 2026/);
  assert.match(email.text, /No se ha realizado ningún cobro/);
  assert.match(email.text, /ni se ha generado un pedido definitivo/i);
  assert.match(email.text, /HorizonST contactará contigo/);
  assert.doesNotMatch(email.text + email.html, /token|access_token_hash/i);
  assert.match(email.html, /<!doctype html>/i);
  assert.match(email.html, /width="100%"/);
  assert.match(email.html, /style="[^"]+"/);
  assert.match(email.html, /Contactar con HorizonST/);
  assert.match(email.html, /mailto:comercial@horizonst\.es/);
  assert.doesNotMatch(email.html, /<img|src="https?:\/\//i, 'the customer email loads no external resources');
}

{
  const email = buildPrereservationCommercialEmail(prereservationInput);
  assert.match(email.text, /interesado@example\.test/);
  assert.match(email.text, /professional/);
  assert.match(email.text, /33333333-3333-4333-8333-333333333333/);
  assert.match(email.text, /\/admin\/prereservations\/33333333-3333-4333-8333-333333333333/);
  assert.doesNotMatch(email.text + email.html, /token|access_token_hash/i);
  assert.match(email.html, /Aviso comercial/);
  assert.match(email.html, /Consultar en administración/);
  assert.doesNotMatch(email.html, /<img|src="https?:\/\//i, 'the commercial email loads no external resources');
}

{
  const email = buildQuoteAvailableEmail({ quote });
  assert.equal(email.to, 'u@example.com');
  assert.equal(email.subject, 'Presupuesto disponible: Q-1');
  assert.match(email.text, /está disponible/);
  assert.match(email.text, /descargar el PDF, aceptarlo o rechazarlo/);
  assert.match(email.text, /https:\/\/tienda\.horizonst\.es\/quotes/);
  assert.doesNotMatch(email.text, new RegExp(`/quotes/${quoteId}`));
  assert.match(email.text, new RegExp(automaticMailFooter));
}

{
  const verificationUrl = 'https://tienda.horizonst.es/verify-email?token=verification-token-for-test';
  const email = buildEmailVerificationEmail({ email: 'ana@example.test', fullName: 'Ana', verificationUrl, expiresInSeconds: 3600 });
  assert.equal(email.to, 'ana@example.test');
  assert.equal(email.subject, 'Verifica tu cuenta de HorizonST');
  assert.ok(email.text.includes(verificationUrl));
  assert.ok(email.html.includes(verificationUrl));
  assert.match(email.html, /Verificar mi cuenta/);
  assert.doesNotMatch(email.html, /<script|stylesheet/i);
}

{
  const verificationUrl = 'https://tienda.horizonst.es/verify-email?token=distributor-verification-token';
  const brochure = Buffer.from('%PDF-1.7 distributor brochure');
  const email = buildDistributorWelcomeEmail({ email: 'distribuidor@example.test', fullName: 'Distribuidor', verificationUrl, expiresInSeconds: 7200 }, brochure);
  assert.equal(email.subject, 'Bienvenido a HorizonST: verifica tu cuenta de distribuidor');
  assert.match(email.text, /Bienvenido al portal de distribuidores/);
  assert.match(email.text, /HorizonST_Frio\.pdf/);
  assert.ok(email.html.includes(verificationUrl));
  assert.equal(email.attachments?.length, 1);
  assert.equal(email.attachments?.[0]?.filename, 'HorizonST_Frio.pdf');
  assert.equal(email.attachments?.[0]?.contentType, 'application/pdf');
  assert.deepEqual(email.attachments?.[0]?.content, brochure);
}

{
  const email = buildQuoteAcceptedCommercialEmail({ quote, order });
  assert.equal(email.to, 'comercial@horizonst.es');
  assert.equal(email.subject, 'Presupuesto aceptado: Q-1');
  assert.match(email.text, /Cliente: User Test/);
  assert.match(email.text, /Email: u@example\.com/);
  assert.match(email.text, /Rol: customer/);
  assert.match(email.text, /Presupuesto: Q-1/);
  assert.match(email.text, /Pedido: ORD-Q-1/);
  assert.match(email.text, new RegExp(`https:\/\/tienda\.horizonst\.es\/admin\/orders\/${orderId}`));
  assert.match(email.text, new RegExp(automaticMailFooter));
}

{
  const email = buildOrderConfirmationEmail({ quote, order });
  assert.equal(email.subject, 'Pedido confirmado: ORD-Q-1');
  assert.match(email.text, /presupuesto Q-1/);
  assert.match(email.text, /pedido ORD-Q-1/);
  assert.match(email.text, /https:\/\/tienda\.horizonst\.es\/orders/);
  assert.match(email.text, /contactará contigo/);
  assert.match(email.text, new RegExp(automaticMailFooter));
}

{
  let delivered: { to: string } | undefined;
  const guideUrl = 'https://horizonst.es/recursos/guia-appcc-2026.pdf';
  const content = buildAppccGuideEmail({ email: 'ana@example.test' }, guideUrl);
  assert.equal(content.to, 'ana@example.test');
  assert.match(content.text, new RegExp(guideUrl));
  assert.match(content.html, new RegExp(guideUrl));
  assert.match(content.html, /Abrir la guía/);
  assert.match(content.html, /https:\/\/horizonst\.es\/planes/);
  assert.match(content.html, /https:\/\/horizonst\.es\/privacidad/);
  assert.match(content.html, /comercial@horizonst\.es/);
  assert.doesNotMatch(content.html, /<script|stylesheet/i);
  await sendAppccGuideEmail({ email: 'ana@example.test' }, async (mail) => { delivered = mail; }, guideUrl);
  assert.equal(delivered?.to, 'ana@example.test');
}

for (const invalid of [
  { user: '', password: 'valid-password' },
  { user: 'smtp@horizonst.es', password: '' },
  { user: 'store-smtp-user@example.com', password: 'valid-password' },
  { user: 'smtp@example.com', password: 'valid-password' },
  { user: 'smtp@example.invalid', password: 'valid-password' },
  { user: 'smtp@horizonst.es', password: 'change-me' },
  { user: 'smtp@horizonst.es', password: 'change_me' }
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
    '250-mail.horizonst.es\r\n250 AUTH LOGIN\r\n',
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
  setTimeout(() => socket.emit('data', Buffer.from('220-mail.horizonst.es\r\n220 ready\r\n')), 0);
  await connectPromise;
  await client.sendMail('u@example.com', 'Subject', '.line', '<strong>HTML</strong>', [{ filename: 'HorizonST_Frio.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-test') }]);
  await client.close();
  assert.ok(socket.writes.some((write) => write.includes('\r\n..line\r\n--')), 'DATA applies dot-stuffing');
  assert.ok(socket.writes.some((write) => write.includes('multipart/alternative')), 'DATA includes HTML alternative');
  assert.ok(socket.writes.some((write) => write.includes('multipart/mixed')), 'DATA wraps messages with attachments in a mixed multipart');
  assert.ok(socket.writes.some((write) => write.includes('filename="HorizonST_Frio.pdf"')), 'DATA identifies the attached brochure');
  assert.ok(socket.writes.some((write) => write.includes(Buffer.from('%PDF-test').toString('base64'))), 'DATA includes the base64 attachment');
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

assert.equal(sanitizeMailError(new Error('smtp@horizonst.es failed secret-password'), { user: 'smtp@horizonst.es', password: 'secret-password' }), '[redacted] failed [redacted]');
