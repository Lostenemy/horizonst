import { randomUUID } from 'node:crypto';
import { connect as netConnect, Socket } from 'node:net';
import { connect as tlsConnect, TLSSocket } from 'node:tls';
import { env } from '../config/env';

interface SmtpResponse {
  code: number;
  message: string;
}

const SMTP_TIMEOUT_MS = 15000;

class SmtpClient {
  private socket: Socket | TLSSocket | null = null;

  async connect() {
    if (!env.MAIL_ENABLED) throw new Error('mail_disabled');
    this.socket = env.MAIL_SECURE
      ? tlsConnect({
          host: env.MAIL_HOST,
          port: env.MAIL_PORT,
          servername: env.MAIL_HOST,
          rejectUnauthorized: env.MAIL_TLS_REJECT_UNAUTHORIZED
        })
      : netConnect({ host: env.MAIL_HOST, port: env.MAIL_PORT });

    await new Promise<void>((resolve, reject) => {
      const socket = this.ensureSocket();
      const readyEvent = env.MAIL_SECURE ? 'secureConnect' : 'connect';
      const onReady = () => {
        socket.off('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        socket.off(readyEvent, onReady);
        reject(error);
      };
      socket.once(readyEvent, onReady);
      socket.once('error', onError);
    });

    this.expect(await this.readResponse(), [220]);
    this.expect(await this.send(`EHLO ${env.MAIL_EHLO_DOMAIN}`), [250]);
    this.expect(await this.send('AUTH LOGIN'), [334]);
    this.expect(await this.send(Buffer.from(env.MAIL_USER).toString('base64')), [334]);
    this.expect(await this.send(Buffer.from(env.MAIL_PASSWORD).toString('base64')), [235]);
  }

  async sendMail(to: string, subject: string, text: string) {
    this.expect(await this.send(`MAIL FROM:<${env.MAIL_FROM}>`), [250]);
    this.expect(await this.send(`RCPT TO:<${to}>`), [250, 251]);
    this.expect(await this.send('DATA'), [354]);

    const now = new Date();
    const body = [
      `Message-ID: <${randomUUID()}@${env.MAIL_EHLO_DOMAIN}>`,
      `Date: ${now.toUTCString()}`,
      `From: ${env.MAIL_FROM}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
    ].join('\r\n');

    const dataPayload = `${body}\r\n.\r\n`;
    await this.write(dataPayload);
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
    await new Promise<void>((resolve, reject) => {
      socket.write(data, (error) => (error ? reject(error) : resolve()));
    });
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
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error('smtp_timeout'));
      };
      const onData = (chunk: Buffer) => {
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

export async function sendMail(to: string, subject: string, text: string) {
  const client = new SmtpClient();
  try {
    await client.connect();
    await client.sendMail(to, subject, text);
    await client.close();
  } catch (error) {
    await client.close();
    throw error;
  }
}
