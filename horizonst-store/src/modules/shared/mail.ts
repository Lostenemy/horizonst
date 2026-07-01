import { randomUUID } from 'node:crypto';
import { connect as netConnect, Socket } from 'node:net';
import { connect as tlsConnect, TLSSocket } from 'node:tls';
import { env } from '../../config/env.js';

type SmtpResponse = { code: number; message: string };

export type QuoteEmailInput = {
  quote: {
    id: string;
    quote_number: string;
    total_cents: number;
    email: string;
    full_name?: string | null;
  };
};

export type QuoteAcceptedCommercialEmailInput = QuoteEmailInput & {
  order?: { id: string; order_number: string } | null;
};

export type OrderConfirmationEmailInput = QuoteEmailInput & {
  order: { id: string; order_number: string };
};

const SMTP_TIMEOUT_MS = 15000;

const formatMoney = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const quoteUrl = (quoteId: string) => `${env.publicBaseUrl.replace(/\/$/, '')}/quotes/${quoteId}`;

class SmtpClient {
  private socket: Socket | TLSSocket | null = null;

  async connect() {
    if (!env.mail.enabled) throw new Error('mail_disabled');
    this.socket = env.mail.secure
      ? tlsConnect({ host: env.mail.host, port: env.mail.port, servername: env.mail.host, rejectUnauthorized: env.mail.tlsRejectUnauthorized })
      : netConnect({ host: env.mail.host, port: env.mail.port });

    await new Promise<void>((resolve, reject) => {
      const socket = this.ensureSocket();
      const readyEvent = env.mail.secure ? 'secureConnect' : 'connect';
      const onReady = () => { socket.off('error', onError); resolve(); };
      const onError = (error: Error) => { socket.off(readyEvent, onReady); reject(error); };
      socket.once(readyEvent, onReady);
      socket.once('error', onError);
    });

    this.expect(await this.readResponse(), [220]);
    this.expect(await this.send(`EHLO ${env.mail.ehloDomain}`), [250]);
    this.expect(await this.send('AUTH LOGIN'), [334]);
    this.expect(await this.send(Buffer.from(env.mail.user).toString('base64')), [334]);
    this.expect(await this.send(Buffer.from(env.mail.password).toString('base64')), [235]);
  }

  async sendMail(to: string, subject: string, text: string) {
    this.expect(await this.send(`MAIL FROM:<${env.mail.from}>`), [250]);
    this.expect(await this.send(`RCPT TO:<${to}>`), [250, 251]);
    this.expect(await this.send('DATA'), [354]);
    const body = [
      `Message-ID: <${randomUUID()}@${env.mail.ehloDomain}>`,
      `Date: ${new Date().toUTCString()}`,
      `From: ${env.mail.from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
    ].join('\r\n');
    await this.write(`${body}\r\n.\r\n`);
    this.expect(await this.readResponse(), [250]);
  }

  async close() {
    if (!this.socket) return;
    try { await this.send('QUIT'); } catch {}
    this.socket.end();
    this.socket.destroy();
    this.socket = null;
  }

  private ensureSocket() {
    if (!this.socket) throw new Error('smtp_socket_not_initialized');
    return this.socket;
  }

  private expect(response: SmtpResponse, codes: number[]) {
    if (!codes.includes(response.code)) throw new Error(`smtp_${response.code}_${response.message}`);
  }

  private async send(command: string) {
    await this.write(command.endsWith('\r\n') ? command : `${command}\r\n`);
    return this.readResponse();
  }

  private async write(data: string) {
    const socket = this.ensureSocket();
    await new Promise<void>((resolve, reject) => socket.write(data, (error) => error ? reject(error) : resolve()));
  }

  private readResponse(): Promise<SmtpResponse> {
    const socket = this.ensureSocket();
    return new Promise((resolve, reject) => {
      let buffer = '';
      const cleanup = () => {
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('timeout', onTimeout);
        socket.setTimeout(0);
      };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onTimeout = () => { cleanup(); reject(new Error('smtp_timeout')); };
      const onData = (chunk: any) => {
        buffer += chunk.toString('utf-8');
        if (!buffer.endsWith('\r\n')) return;
        const lines = buffer.split(/\r\n/).filter(Boolean);
        const last = lines[lines.length - 1] ?? '';
        if (!/^\d{3} /.test(last)) return;
        cleanup();
        resolve({ code: Number(last.slice(0, 3)), message: last.slice(4).trim() });
      };
      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
      socket.setTimeout(SMTP_TIMEOUT_MS);
    });
  }
}

async function sendMail(to: string, subject: string, text: string) {
  if (!env.mail.enabled) return;
  const client = new SmtpClient();
  try {
    await client.connect();
    await client.sendMail(to, subject, text);
  } finally {
    await client.close();
  }
}

export async function sendQuoteAvailableEmail({ quote }: QuoteEmailInput) {
  const name = quote.full_name || 'cliente';
  await sendMail(quote.email, `Presupuesto ${quote.quote_number} disponible`, [
    `Hola ${name},`,
    '',
    `Tu presupuesto ${quote.quote_number} ya esta disponible en HorizonST Store.`,
    `Importe total: ${formatMoney(quote.total_cents)}.`,
    `Puedes revisarlo en: ${quoteUrl(quote.id)}`,
    '',
    'Gracias,',
    'Equipo HorizonST'
  ].join('\n'));
}

export async function sendQuoteAcceptedCommercialEmail({ quote, order }: QuoteAcceptedCommercialEmailInput) {
  await sendMail(env.mail.commercialTo, `Presupuesto aceptado ${quote.quote_number}`, [
    `El cliente ${quote.full_name || quote.email} ha aceptado el presupuesto ${quote.quote_number}.`,
    `Email cliente: ${quote.email}`,
    `Importe total: ${formatMoney(quote.total_cents)}.`,
    order ? `Pedido generado: ${order.order_number}` : 'Pedido generado desde aceptacion administrativa.',
    `Presupuesto: ${quoteUrl(quote.id)}`
  ].join('\n'));
}

export async function sendOrderConfirmationEmail({ quote, order }: OrderConfirmationEmailInput) {
  const name = quote.full_name || 'cliente';
  await sendMail(quote.email, `Confirmacion de pedido ${order.order_number}`, [
    `Hola ${name},`,
    '',
    `Hemos registrado tu pedido ${order.order_number} a partir del presupuesto ${quote.quote_number}.`,
    `Importe total: ${formatMoney(quote.total_cents)}.`,
    'Nuestro equipo comercial contactara contigo para los siguientes pasos.',
    '',
    'Gracias,',
    'Equipo HorizonST'
  ].join('\n'));
}

export const sanitizeMailError = (error: unknown) => {
  let message = error instanceof Error ? error.message : String(error);
  if (env.mail.password) message = message.replaceAll(env.mail.password, '[redacted]');
  if (env.mail.user) message = message.replaceAll(env.mail.user, '[redacted]');
  return message;
};

export const commercialMailRecipient = env.mail.commercialTo;
