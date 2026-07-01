import { randomUUID } from 'node:crypto';
import { connect as netConnect, Socket } from 'node:net';
import { connect as tlsConnect, TLSSocket } from 'node:tls';
import { env } from '../../config/env.js';
import type { StoreMailConfig } from '../../config/env.js';

type SmtpResponse = { code: number; message: string };
type SmtpSocket = Socket | TLSSocket;
type SmtpConnector = (config: StoreMailConfig) => { socket: SmtpSocket; readyEvent: string };

export type MailContent = { to: string; subject: string; text: string };
export type QuoteEmailInput = {
  quote: {
    id: string;
    quote_number: string;
    total_cents: number;
    email: string;
    full_name?: string | null;
    role?: string | null;
  };
};

export type QuoteAcceptedCommercialEmailInput = QuoteEmailInput & {
  order: { id: string; order_number: string };
};

export type OrderConfirmationEmailInput = QuoteEmailInput & {
  order: { id: string; order_number: string };
};

const SMTP_TIMEOUT_MS = 15000;
const AUTO_FOOTER = 'HorizonST — Este correo ha sido generado automáticamente.';

const formatMoney = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const baseUrl = () => env.publicBaseUrl.replace(/\/$/, '');
const quotesUrl = () => `${baseUrl()}/quotes`;
const ordersUrl = () => `${baseUrl()}/orders`;
const adminOrderUrl = (orderId: string) => `${baseUrl()}/admin/orders/${orderId}`;

const defaultConnector: SmtpConnector = (config) => ({
  socket: config.secure
    ? tlsConnect({ host: config.host, port: config.port, servername: config.host, rejectUnauthorized: config.tlsRejectUnauthorized })
    : netConnect({ host: config.host, port: config.port }),
  readyEvent: config.secure ? 'secureConnect' : 'connect'
});

export class SmtpClient {
  private socket: SmtpSocket | null = null;

  constructor(private readonly config: StoreMailConfig = env.mail, private readonly connector: SmtpConnector = defaultConnector) {}

  async connect() {
    if (!this.config.enabled) throw new Error('mail_disabled');
    const connection = this.connector(this.config);
    this.socket = connection.socket;

    await new Promise<void>((resolve, reject) => {
      const socket = this.ensureSocket();
      const onReady = () => { socket.off('error', onError); resolve(); };
      const onError = (error: Error) => { socket.off(connection.readyEvent, onReady); reject(error); };
      socket.once(connection.readyEvent, onReady);
      socket.once('error', onError);
    });

    this.expect(await this.readResponse(), [220]);
    this.expect(await this.send(`EHLO ${this.config.ehloDomain}`), [250]);
    this.expect(await this.send('AUTH LOGIN'), [334]);
    this.expect(await this.send(Buffer.from(this.config.user).toString('base64')), [334]);
    this.expect(await this.send(Buffer.from(this.config.password).toString('base64')), [235]);
  }

  async sendMail(to: string, subject: string, text: string) {
    this.expect(await this.send(`MAIL FROM:<${this.config.from}>`), [250]);
    this.expect(await this.send(`RCPT TO:<${to}>`), [250, 251]);
    this.expect(await this.send('DATA'), [354]);
    const body = [
      `Message-ID: <${randomUUID()}@${this.config.ehloDomain}>`,
      `Date: ${new Date().toUTCString()}`,
      `From: ${this.config.from}`,
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

async function sendMail({ to, subject, text }: MailContent) {
  if (!env.mail.enabled) return;
  const client = new SmtpClient();
  try {
    await client.connect();
    await client.sendMail(to, subject, text);
  } finally {
    await client.close();
  }
}

export function buildQuoteAvailableEmail({ quote }: QuoteEmailInput): MailContent {
  const name = quote.full_name || 'cliente';
  return {
    to: quote.email,
    subject: `Presupuesto disponible: ${quote.quote_number}`,
    text: [
      `Hola ${name},`,
      '',
      `Tu presupuesto ${quote.quote_number} ya está disponible en HorizonST Store.`,
      `Importe total: ${formatMoney(quote.total_cents)}.`,
      `Puedes revisarlo, descargar el PDF, aceptarlo o rechazarlo en: ${quotesUrl()}`,
      '',
      AUTO_FOOTER
    ].join('\n')
  };
}

export function buildQuoteAcceptedCommercialEmail({ quote, order }: QuoteAcceptedCommercialEmailInput): MailContent {
  return {
    to: env.mail.commercialTo,
    subject: `Presupuesto aceptado: ${quote.quote_number}`,
    text: [
      `Cliente: ${quote.full_name || quote.email}`,
      `Email: ${quote.email}`,
      quote.role ? `Rol: ${quote.role}` : null,
      `Presupuesto: ${quote.quote_number}`,
      `Pedido: ${order.order_number}`,
      `Importe total: ${formatMoney(quote.total_cents)}.`,
      `Pedido administrativo: ${adminOrderUrl(order.id)}`,
      '',
      AUTO_FOOTER
    ].filter((line) => line !== null).join('\n')
  };
}

export function buildOrderConfirmationEmail({ quote, order }: OrderConfirmationEmailInput): MailContent {
  const name = quote.full_name || 'cliente';
  return {
    to: quote.email,
    subject: `Pedido confirmado: ${order.order_number}`,
    text: [
      `Hola ${name},`,
      '',
      `Hemos registrado tu pedido ${order.order_number} a partir del presupuesto ${quote.quote_number}.`,
      `Importe total: ${formatMoney(quote.total_cents)}.`,
      `Puedes consultar tus pedidos en: ${ordersUrl()}`,
      'Nuestro equipo comercial contactará contigo para los siguientes pasos.',
      '',
      AUTO_FOOTER
    ].join('\n')
  };
}

export async function sendQuoteAvailableEmail(input: QuoteEmailInput) {
  await sendMail(buildQuoteAvailableEmail(input));
}

export async function sendQuoteAcceptedCommercialEmail(input: QuoteAcceptedCommercialEmailInput) {
  await sendMail(buildQuoteAcceptedCommercialEmail(input));
}

export async function sendOrderConfirmationEmail(input: OrderConfirmationEmailInput) {
  await sendMail(buildOrderConfirmationEmail(input));
}

export const sanitizeMailError = (error: unknown, mail: Pick<StoreMailConfig, 'user' | 'password'> = env.mail) => {
  let message = error instanceof Error ? error.message : String(error);
  if (mail.password) message = message.replaceAll(mail.password, '[redacted]');
  if (mail.user) message = message.replaceAll(mail.user, '[redacted]');
  return message;
};

export const commercialMailRecipient = env.mail.commercialTo;
export const automaticMailFooter = AUTO_FOOTER;
