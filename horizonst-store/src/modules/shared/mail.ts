import { randomUUID } from 'node:crypto';
import { connect as netConnect, Socket } from 'node:net';
import { connect as tlsConnect, TLSSocket } from 'node:tls';
import { env } from '../../config/env.js';
import type { StoreMailConfig } from '../../config/env.js';

type SmtpResponse = { code: number; message: string };
type SmtpSocket = Socket | TLSSocket;
type SmtpConnector = (config: StoreMailConfig) => { socket: SmtpSocket; readyEvent: string };

export type MailContent = { to: string; subject: string; text: string; html: string };
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
export type AppccGuideEmailInput = { email: string };
export type EmailVerificationEmailInput = { email: string; fullName: string; verificationUrl: string; expiresInSeconds: number };
export type PrereservationEmailInput = {
  prereservation: { id: string; email: string; code: string; confirmedAt: string | Date };
  offer: {
    hardware: { name: string; priceCents: number; coverageSquareMeters: number | null };
    webPlan: { name: string; priceCents: number };
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
  };
};

const SMTP_TIMEOUT_MS = 15000;
const AUTO_FOOTER = 'HorizonST — Este correo ha sido generado automáticamente.';

const formatMoney = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const baseUrl = () => env.publicBaseUrl.replace(/\/$/, '');
const quotesUrl = () => `${baseUrl()}/quotes`;
const ordersUrl = () => `${baseUrl()}/orders`;
const adminOrderUrl = (orderId: string) => `${baseUrl()}/admin/orders/${orderId}`;
const adminPrereservationUrl = (id: string) => `${baseUrl()}/admin/prereservations/${id}`;

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

  async sendMail(to: string, subject: string, text: string, html?: string) {
    this.expect(await this.send(`MAIL FROM:<${this.config.from}>`), [250]);
    this.expect(await this.send(`RCPT TO:<${to}>`), [250, 251]);
    this.expect(await this.send('DATA'), [354]);
    const plainText = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const body = html ? [
      `Message-ID: <${randomUUID()}@${this.config.ehloDomain}>`, `Date: ${new Date().toUTCString()}`, `From: ${this.config.from}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="horizonst-${randomUUID()}"`, '',
      // The boundary is repeated below from the header to produce a standards-compliant alternative body.
    ].join('\r\n') : [
      `Message-ID: <${randomUUID()}@${this.config.ehloDomain}>`,
      `Date: ${new Date().toUTCString()}`,
      `From: ${this.config.from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      plainText
    ].join('\r\n');
    if (!html) { await this.write(`${body}\r\n.\r\n`); this.expect(await this.readResponse(), [250]); return; }
    const boundary = body.match(/boundary="([^"]+)"/)?.[1];
    if (!boundary) throw new Error('smtp_multipart_boundary_missing');
    const multipart = `${body}\r\n--${boundary}\r\nContent-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${plainText}\r\n--${boundary}\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${html.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')}\r\n--${boundary}--`;
    await this.write(`${multipart}\r\n.\r\n`);
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

const textHtml = (text: string) => `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#08233f">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`;
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sendMail({ to, subject, text, html }: MailContent) {
  if (!env.mail.enabled) return;
  const client = new SmtpClient();
  try {
    await client.connect();
    await client.sendMail(to, subject, text, html);
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
    ].join('\n'), html: textHtml(`Hola ${name},\n\nTu presupuesto ${quote.quote_number} ya está disponible en HorizonST Store.`)
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
    ].filter((line) => line !== null).join('\n'), html: textHtml(`Presupuesto aceptado: ${quote.quote_number}\nPedido: ${order.order_number}`)
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
    ].join('\n'), html: textHtml(`Hola ${name},\n\nHemos registrado tu pedido ${order.order_number}.`)
  };
}

export function buildAppccGuideEmail({ email }: AppccGuideEmailInput, guideUrl = env.mail.appccGuideUrl): MailContent {
  if (!guideUrl) throw new Error('appcc_guide_resource_not_configured');
  return {
    to: email,
    subject: 'Tu guía para mejorar la seguridad de trabajadores en cámaras congeladoras',
    text: [
      'Gracias por solicitar la guía de HorizonST.',
      '',
      'Guía 2026 para la seguridad de trabajadores en cámaras congeladoras:',
      guideUrl,
      '',
      'Encontrarás riesgos habituales, control de permanencias, alertas, actuación ante incidencias y un checklist de revisión interna.',
      'HorizonST permite centralizar la supervisión de trabajadores, generar alertas y mantener un historial operativo mediante tecnologías inalámbricas.',
      'Conoce nuestras soluciones: https://horizonst.com.es/planes',
      'Privacidad: https://horizonst.com.es/privacidad',
      'Contacto: comercial@horizonst.es',
      '',
      AUTO_FOOTER
    ].join('\n'),
    html: `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#edf4f6;font-family:Arial,Helvetica,sans-serif;color:#08233f"><div style="display:none;max-height:0;overflow:hidden;opacity:0">Recomendaciones prácticas para controlar permanencias, alertas e incidencias en entornos de frío extremo.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf4f6"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden"><tr><td style="padding:24px 32px;background:#08233f;color:#ffffff;font-size:22px;font-weight:bold">HorizonST <span style="color:#4bd6d3">/</span> Seguridad operativa</td></tr><tr><td style="padding:36px 32px"><p style="margin:0 0 12px;color:#008d99;font-size:12px;font-weight:bold;letter-spacing:1.2px">GUÍA 2026</p><h1 style="margin:0 0 18px;font-size:30px;line-height:1.18;color:#08233f">Protege mejor a tus trabajadores en cámaras congeladoras</h1><p style="margin:0 0 14px;font-size:16px;line-height:1.6">Gracias por solicitar la guía de HorizonST.</p><p style="margin:0 0 26px;font-size:16px;line-height:1.6">Hemos preparado un documento breve y práctico para ayudarte a revisar cómo controlas la entrada, permanencia y seguridad de los trabajadores que acceden a cámaras congeladoras.</p><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:6px;background:#008d99"><a href="${guideUrl}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-weight:bold">Abrir la guía</a></td></tr></table><div style="margin-top:30px;padding:20px;background:#eef8f8;border-left:4px solid #008d99"><strong style="font-size:16px">En la guía encontrarás:</strong><p style="margin:12px 0 0;line-height:1.75">• Riesgos habituales en cámaras congeladoras.<br>• Medidas para controlar tiempos de permanencia.<br>• Alertas y actuación ante incidencias.<br>• Checklist de revisión interna.<br>• Cómo mejorar la trazabilidad de accesos.</p></div><p style="margin:28px 0 12px;font-size:15px;line-height:1.6">HorizonST permite centralizar la supervisión de trabajadores, generar alertas y mantener un historial operativo mediante tecnologías inalámbricas.</p><p style="margin:0"><a href="https://horizonst.com.es/planes" style="color:#007b86;font-weight:bold">Conocer los planes de HorizonST</a></p></td></tr><tr><td style="padding:20px 32px;background:#f5f8f9;color:#536471;font-size:12px;line-height:1.6">Contacto: <a href="mailto:comercial@horizonst.es" style="color:#007b86">comercial@horizonst.es</a> · <a href="https://horizonst.com.es/privacidad" style="color:#007b86">Privacidad</a><br>HorizonST — Este correo ha sido generado automáticamente.</td></tr></table></td></tr></table></body></html>`
  };
}

export function buildEmailVerificationEmail({ email, fullName, verificationUrl, expiresInSeconds }: EmailVerificationEmailInput): MailContent {
  const hours = Math.max(1, Math.ceil(expiresInSeconds / 3600));
  const safeName = escapeHtml(fullName);
  return {
    to: email,
    subject: 'Verifica tu cuenta de HorizonST',
    text: [`Hola ${fullName},`, '', 'Hemos creado tu cuenta de HorizonST. Verifica tu dirección de correo para activarla:', verificationUrl, '', `El enlace caduca en ${hours} hora${hours === 1 ? '' : 's'}. Si no solicitaste el alta, puedes ignorar este correo.`, '', AUTO_FOOTER].join('\n'),
    html: `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#edf4f6;font-family:Arial,Helvetica,sans-serif;color:#08233f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px"><tr><td style="padding:28px;background:#08233f;color:#fff;font-size:22px;font-weight:bold">HorizonST</td></tr><tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:26px">Verifica tu cuenta</h1><p>Hola ${safeName},</p><p>Hemos creado tu cuenta de HorizonST. Verifica tu dirección de correo para activarla.</p><p style="margin:28px 0"><a href="${verificationUrl}" style="display:inline-block;padding:14px 22px;background:#008d99;color:#fff;text-decoration:none;font-weight:bold;border-radius:6px">Verificar mi cuenta</a></p><p>Este enlace caduca en ${hours} hora${hours === 1 ? '' : 's'}. Si no solicitaste el alta, puedes ignorar este correo.</p><p style="word-break:break-all;color:#536471">${verificationUrl}</p></td></tr><tr><td style="padding:18px 32px;background:#f5f8f9;color:#536471;font-size:12px">${AUTO_FOOTER}</td></tr></table></td></tr></table></body></html>`
  };
}

export function buildPrereservationConfirmationEmail({ prereservation, offer }: PrereservationEmailInput): MailContent {
  const coverage = offer.hardware.coverageSquareMeters && offer.hardware.coverageSquareMeters > 0
    ? `Cobertura aproximada: hasta ${new Intl.NumberFormat('es-ES').format(offer.hardware.coverageSquareMeters)} m²`
    : null;
  const summary = [
    `Plan Web: ${offer.webPlan.name} (${formatMoney(offer.webPlan.priceCents)})`,
    `Pack hardware: ${offer.hardware.name} (${formatMoney(offer.hardware.priceCents)})`,
    coverage,
    `Precio base: ${formatMoney(offer.subtotalCents)}`,
    `Descuento de prerreserva (5 %): -${formatMoney(offer.discountCents)}`,
    `IVA: ${formatMoney(offer.taxCents)}`,
    `Total prerreservado: ${formatMoney(offer.totalCents)}`
  ];
  const text = [
    'Tu prerreserva de HorizonST ha quedado confirmada.', '', ...summary.filter((line): line is string => line !== null), '',
    'La campaña es válida hasta el 1 de septiembre de 2026.',
    'No se ha realizado ningún cobro ni se ha generado un pedido definitivo.',
    'HorizonST contactará contigo para formalizar la propuesta.', '',
    'Contacto: comercial@horizonst.es', AUTO_FOOTER
  ].join('\n');
  const safePlan = escapeHtml(offer.webPlan.name);
  const safePack = escapeHtml(offer.hardware.name);
  const priceRow = (label: string, value: string, accent = false) => `<tr><td style="padding:10px 0;color:${accent ? '#008d99' : '#536471'};font-size:14px;font-weight:${accent ? '700' : '400'}">${label}</td><td align="right" style="padding:10px 0;color:${accent ? '#008d99' : '#08233f'};font-size:${accent ? '18px' : '14px'};font-weight:700">${value}</td></tr>`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#edf4f6;font-family:Arial,Helvetica,sans-serif;color:#08233f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#edf4f6"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 36px rgba(8,35,63,.12)"><tr><td style="padding:24px 30px;background:#08233f;color:#ffffff;font-size:24px;font-weight:800">HorizonST <span style="color:#4bd6d3">/</span> Prerreserva</td></tr><tr><td style="padding:32px 30px"><p style="margin:0 0 8px;color:#008d99;font-size:12px;font-weight:700;letter-spacing:1.2px">PRERRESERVA CONFIRMADA</p><h1 style="margin:0 0 14px;color:#08233f;font-size:28px;line-height:1.2">Gracias por confiar en HorizonST</h1><p style="margin:0 0 24px;color:#536471;font-size:16px;line-height:1.6">Hemos registrado tu interés. No se ha realizado ningún cobro ni se ha creado un pedido definitivo.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin-bottom:22px;background:#eef8f8;border-left:4px solid #008d99;border-radius:10px"><tr><td style="padding:20px"><p style="margin:0 0 6px;color:#008d99;font-size:12px;font-weight:700;letter-spacing:1px">OFERTA SELECCIONADA</p><p style="margin:0;color:#08233f;font-size:22px;font-weight:800">Plan Web ${safePlan}</p><p style="margin:8px 0 0;color:#536471;font-size:15px">${safePack}${coverage ? `<br>${escapeHtml(coverage)}` : ''}</p></td></tr></table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">${priceRow('Plan Web', formatMoney(offer.webPlan.priceCents))}${priceRow('Pack hardware', formatMoney(offer.hardware.priceCents))}${priceRow('Precio base', formatMoney(offer.subtotalCents))}${priceRow('Descuento de prerreserva (5 %)', `-${formatMoney(offer.discountCents)}`, true)}${priceRow('IVA', formatMoney(offer.taxCents))}<tr><td style="padding:16px 0 4px;border-top:2px solid #dce9ed;color:#08233f;font-size:17px;font-weight:800">Total final</td><td align="right" style="padding:16px 0 4px;border-top:2px solid #dce9ed;color:#08233f;font-size:23px;font-weight:800">${formatMoney(offer.totalCents)}</td></tr></table><div style="margin:26px 0;padding:18px;background:#f5f8f9;border-radius:10px;color:#536471;font-size:14px;line-height:1.6"><strong style="color:#08233f">Campaña válida hasta el 1 de septiembre de 2026.</strong><br>HorizonST contactará contigo para formalizar la propuesta. Esta confirmación no supone un cobro ni la creación de un pedido definitivo.</div><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:999px;background:#18c3cf"><a href="mailto:comercial@horizonst.es" style="display:inline-block;padding:14px 24px;color:#08233f;text-decoration:none;font-size:15px;font-weight:800">Contactar con HorizonST</a></td></tr></table></td></tr><tr><td style="padding:20px 30px;background:#08233f;color:#c9e5e8;font-size:12px;line-height:1.6">comercial@horizonst.es<br>HorizonST — Este correo ha sido generado automáticamente.</td></tr></table></td></tr></table></body></html>`;
  return {
    to: prereservation.email,
    subject: `Prerreserva confirmada: ${offer.webPlan.name}`,
    text,
    html
  };
}

export function buildPrereservationCommercialEmail({ prereservation, offer }: PrereservationEmailInput): MailContent {
  const text = [
    'Nueva prerreserva pública confirmada.',
    `Interesado: ${prereservation.email}`,
    `Oferta: ${prereservation.code}`,
    `Total: ${formatMoney(offer.totalCents)}`,
    `Fecha: ${new Date(prereservation.confirmedAt).toISOString()}`,
    `Identificador: ${prereservation.id}`,
    `Administración: ${adminPrereservationUrl(prereservation.id)}`,
    '', AUTO_FOOTER
  ].join('\n');
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#edf4f6;font-family:Arial,Helvetica,sans-serif;color:#08233f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#edf4f6"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden"><tr><td style="padding:22px 28px;background:#08233f;color:#ffffff;font-size:21px;font-weight:800">HorizonST · Aviso comercial</td></tr><tr><td style="padding:28px"><h1 style="margin:0 0 20px;font-size:24px;color:#08233f">Nueva prerreserva confirmada</h1><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;font-size:14px;line-height:1.6"><tr><td style="padding:7px 0;color:#536471">Interesado</td><td align="right" style="padding:7px 0;font-weight:700">${escapeHtml(prereservation.email)}</td></tr><tr><td style="padding:7px 0;color:#536471">Oferta</td><td align="right" style="padding:7px 0;font-weight:700">${escapeHtml(prereservation.code)}</td></tr><tr><td style="padding:7px 0;color:#536471">Total</td><td align="right" style="padding:7px 0;font-weight:700">${formatMoney(offer.totalCents)}</td></tr><tr><td style="padding:7px 0;color:#536471">Identificador</td><td align="right" style="padding:7px 0;font-weight:700">${escapeHtml(prereservation.id)}</td></tr></table><p style="margin:24px 0 0"><a href="${adminPrereservationUrl(prereservation.id)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#18c3cf;color:#08233f;text-decoration:none;font-weight:800">Consultar en administración</a></p></td></tr><tr><td style="padding:18px 28px;background:#f5f8f9;color:#536471;font-size:12px">${AUTO_FOOTER}</td></tr></table></td></tr></table></body></html>`;
  return {
    to: env.mail.commercialTo,
    subject: `Prerreserva confirmada: ${prereservation.code}`,
    text,
    html
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

export async function sendAppccGuideEmail(input: AppccGuideEmailInput, deliver: (content: MailContent) => Promise<void> = sendMail, guideUrl = env.mail.appccGuideUrl) {
  const content = buildAppccGuideEmail(input, guideUrl);
  if (!env.mail.enabled && deliver === sendMail) throw new Error('mail_disabled');
  await deliver(content);
}

export async function sendEmailVerificationEmail(input: EmailVerificationEmailInput, deliver: (content: MailContent) => Promise<void> = sendMail) {
  await deliver(buildEmailVerificationEmail(input));
}

export async function sendPrereservationConfirmationEmail(input: PrereservationEmailInput, deliver: (content: MailContent) => Promise<void> = sendMail) {
  await deliver(buildPrereservationConfirmationEmail(input));
}

export async function sendPrereservationCommercialEmail(input: PrereservationEmailInput, deliver: (content: MailContent) => Promise<void> = sendMail) {
  await deliver(buildPrereservationCommercialEmail(input));
}

export const sanitizeMailError = (error: unknown, mail: Pick<StoreMailConfig, 'user' | 'password'> = env.mail) => {
  let message = error instanceof Error ? error.message : String(error);
  if (mail.password) message = message.replaceAll(mail.password, '[redacted]');
  if (mail.user) message = message.replaceAll(mail.user, '[redacted]');
  return message;
};

export const commercialMailRecipient = env.mail.commercialTo;
export const automaticMailFooter = AUTO_FOOTER;
