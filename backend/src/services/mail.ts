import { randomUUID } from 'crypto';
import { connect as netConnect, Socket } from 'net';
import { connect as tlsConnect, TLSSocket } from 'tls';
import { config } from '../config';

interface SmtpResponse {
  code: number;
  lines: string[];
  message: string;
}

interface MailPayload {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
}

const SMTP_TIMEOUT_MS = 15000;

class SmtpClient {
  private socket: Socket | TLSSocket | null = null;

  async connect(): Promise<void> {
    if (!config.mail.enabled) {
      throw new Error('Mail delivery disabled by configuration.');
    }
    this.socket = config.mail.secure
      ? tlsConnect({
          host: config.mail.host,
          port: config.mail.port,
          servername: config.mail.host,
          rejectUnauthorized: config.mail.tlsRejectUnauthorized
        })
      : netConnect({ host: config.mail.host, port: config.mail.port });

    await new Promise<void>((resolve, reject) => {
      const socket = this.ensureSocket();
      const readyEvent = config.mail.secure ? 'secureConnect' : 'connect';
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

    const greeting = await this.readResponse();
    this.ensureStatus(greeting, [220]);

    const ehlo = await this.sendCommand(`EHLO ${config.mail.ehloDomain}`);
    this.ensureStatus(ehlo, [250]);
  }

  async authenticate(): Promise<void> {
    const socket = this.ensureSocket();
    socket.setTimeout(SMTP_TIMEOUT_MS);

    const auth = await this.sendCommand('AUTH LOGIN');
    this.ensureStatus(auth, [334]);

    const userResponse = await this.sendCommand(Buffer.from(config.mail.user, 'utf-8').toString('base64'));
    this.ensureStatus(userResponse, [334]);

    const passResponse = await this.sendCommand(Buffer.from(config.mail.password, 'utf-8').toString('base64'));
    this.ensureStatus(passResponse, [235]);
  }

  async send(payload: MailPayload): Promise<void> {
    const recipients = payload.to;
    if (!recipients.length) {
      throw new Error('At least one recipient is required.');
    }

    const mailFrom = await this.sendCommand(`MAIL FROM:<${config.mail.from}>`);
    this.ensureStatus(mailFrom, [250]);

    for (const rcpt of recipients) {
      const recipientResponse = await this.sendCommand(`RCPT TO:<${rcpt}>`);
      this.ensureStatus(recipientResponse, [250, 251]);
    }

    const dataResponse = await this.sendCommand('DATA');
    this.ensureStatus(dataResponse, [354]);

    const message = createMessage(payload, recipients);
    await this.write(`${message}\r\n.`);
    const finalResponse = await this.readResponse();
    this.ensureStatus(finalResponse, [250]);
  }

  async quit(): Promise<void> {
    if (!this.socket) {
      return;
    }
    try {
      await this.sendCommand('QUIT');
    } catch {
      // ignore failures while closing the session
    } finally {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
  }

  destroy(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  private ensureSocket(): Socket | TLSSocket {
    if (!this.socket) {
      throw new Error('SMTP socket not initialized');
    }
    return this.socket;
  }

  private async write(data: string): Promise<void> {
    const socket = this.ensureSocket();
    return new Promise((resolve, reject) => {
      const payload = data.endsWith('\r\n') ? data : `${data}\r\n`;
      socket.write(payload, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private async sendCommand(command: string): Promise<SmtpResponse> {
    await this.write(command);
    return this.readResponse();
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
        reject(new Error('SMTP timeout'));
      };
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        if (!buffer.endsWith('\r\n')) {
          return;
        }
        const lines = buffer.split(/\r\n/).filter((line) => line.length > 0);
        const lastLine = lines[lines.length - 1] ?? '';
        if (!/^\d{3} [\s\S]*$/.test(lastLine)) {
          return;
        }
        cleanup();
        const code = Number.parseInt(lastLine.slice(0, 3), 10);
        resolve({ code, lines, message: lastLine.slice(4).trim() });
      };

      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
      socket.setTimeout(SMTP_TIMEOUT_MS);
    });
  }

  private ensureStatus(response: SmtpResponse, expectedCodes: number[]): void {
    if (!expectedCodes.includes(response.code)) {
      throw new Error(`Unexpected SMTP response ${response.code}: ${response.message}`);
    }
  }
}

const normalizeRecipients = (value: string | string[]): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter((item) => item.length > 0);
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const escapeDots = (text: string): string => text.replace(/^\./gm, '..');

const createMessage = (payload: MailPayload, recipients: string[]): string => {
  const now = new Date();
  const formattedText = escapeDots(payload.text.replace(/\r?\n/g, '\r\n'));
  const headers: string[] = [
    `Message-ID: <${randomUUID()}@${config.mail.ehloDomain}>`,
    `Date: ${now.toUTCString()}`,
    `From: ${config.mail.from}`,
    `To: ${recipients.join(', ')}`,
    `Subject: ${payload.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: HorizonST Platform'
  ];
  if (payload.replyTo) {
    headers.splice(3, 0, `Reply-To: ${payload.replyTo}`);
  }
  return `${headers.join('\r\n')}\r\n\r\n${formattedText}\r\n`;
};

export const sendMail = async (options: { to: string | string[]; subject: string; text: string; replyTo?: string }): Promise<void> => {
  const recipients = normalizeRecipients(options.to);
  const client = new SmtpClient();
  try {
    await client.connect();
    await client.authenticate();
    await client.send({
      to: recipients,
      subject: options.subject,
      text: options.text,
      replyTo: options.replyTo
    });
    await client.quit();
  } catch (error) {
    client.destroy();
    throw error;
  }
};

export const verifyMailConnection = async (): Promise<boolean> => {
  if (!config.mail.enabled) {
    return false;
  }
  const client = new SmtpClient();
  try {
    await client.connect();
    await client.authenticate();
    await client.quit();
    return true;
  } catch (error) {
    client.destroy();
    throw error;
  }
};
