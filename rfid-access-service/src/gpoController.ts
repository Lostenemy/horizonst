import axios, { AxiosInstance } from 'axios';
import type { AccessDecision } from './types.js';
import { logger } from './logger.js';

type ReaderAuthType = 'none' | 'basic' | 'digest';

interface ReaderControlConfig {
  baseUrl: string;
  deviceId: string;
  timeoutMs: number;
  enabled: boolean;
  username?: string;
  password?: string;
  singleDeviceMode?: boolean;
  authType?: ReaderAuthType;
}

export interface ReaderGpoToggleResult {
  line: number;
  state: boolean;
  status: number;
  data: unknown;
  url: string;
}

export interface ReaderGpoPulseResult {
  line: number;
  durationMs: number;
  on: ReaderGpoToggleResult;
  off: ReaderGpoToggleResult;
}

export type ReaderGpoActionResult = ReaderGpoToggleResult | ReaderGpoPulseResult;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ReaderGpoController {
  private readonly http: AxiosInstance;

  private enabled: boolean;

  private credentials: { username: string; password: string } | null;

  private authType: ReaderAuthType;

  private disabledReason: 'MISSING_BASE_URL' | 'MISSING_DEVICE_ID' | 'DISABLED_FLAG' | null;

  private deviceId: string;

  private singleDeviceMode: boolean;

  private digestClient: any | null;

  private readonly allowedLines = [1, 2, 3, 4, 5, 6, 7, 8];

  private readonly config: ReaderControlConfig;

  constructor(config: ReaderControlConfig) {
    const normalizedBaseUrl = this.normalizeBaseUrl(config.baseUrl || '');
    const normalizedDeviceId = (config.deviceId || '').trim();
    const singleDeviceMode = Boolean(config.singleDeviceMode);
    const authType = this.normalizeAuthType(config.authType);

    this.disabledReason = null;
    this.enabled = false;
    this.credentials = null;
    this.deviceId = normalizedDeviceId;
    this.singleDeviceMode = singleDeviceMode;
    this.authType = authType;
    this.digestClient = null;
    this.http = axios.create({
      baseURL: normalizedBaseUrl,
      timeout: config.timeoutMs
    });

    this.config = {
      ...config,
      baseUrl: normalizedBaseUrl,
      deviceId: normalizedDeviceId,
      singleDeviceMode,
      authType
    };

    this.updateCredentials({ username: config.username, password: config.password });
    this.recomputeState();
  }

  async handleDecision(decision: AccessDecision): Promise<ReaderGpoActionResult[]> {
    if (!this.enabled) {
      throw new Error('GPO_DISABLED');
    }

    if (decision === 'GRANTED') {
      return [await this.pulse(1, 5000)];
    }

    const [line2, line3] = await Promise.all([this.pulse(2, 10000), this.pulse(3, 5000)]);
    return [line2, line3];
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  status() {
    return {
      enabled: this.enabled,
      baseUrl: this.normalizeBaseUrl(this.config.baseUrl),
      deviceId: this.deviceId,
      pathMode: this.singleDeviceMode ? 'single-device' : 'multi-device',
      singleDeviceMode: this.singleDeviceMode,
      allowedLines: this.allowedLines,
      disabledReason: this.disabledReason,
      auth: {
        username: this.credentials?.username ?? null,
        configured: Boolean(this.credentials),
        type: this.authType
      }
    } as const;
  }

  updateBaseUrl(baseUrl: string): void {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl || '');
    this.config.baseUrl = normalizedBaseUrl;
    this.http.defaults.baseURL = normalizedBaseUrl;
    this.recomputeState();
  }

  updateDeviceId(deviceId: string): void {
    const normalizedDeviceId = deviceId.trim();
    this.deviceId = normalizedDeviceId;
    this.config.deviceId = normalizedDeviceId;
    this.recomputeState();
  }

  updatePathMode(singleDeviceMode: boolean): void {
    this.singleDeviceMode = Boolean(singleDeviceMode);
    this.config.singleDeviceMode = this.singleDeviceMode;
    this.recomputeState();
  }

  updateCredentials(credentials: { username?: string; password?: string } | null): void {
    const username = credentials?.username?.trim() ?? '';
    const password = credentials?.password ?? '';

    if (!username || !password) {
      this.credentials = null;
      this.digestClient = null;
      return;
    }

    this.credentials = { username, password };
    this.digestClient = null;
  }

  updateAuthType(authType: ReaderAuthType): void {
    this.authType = this.normalizeAuthType(authType);
    this.digestClient = null;
  }

  async triggerDecision(decision: AccessDecision): Promise<ReaderGpoActionResult[]> {
    return this.handleDecision(decision);
  }

  async controlLine(
    line: number,
    action: 'on' | 'off' | 'pulse',
    durationMs: number | undefined = 1000
  ): Promise<ReaderGpoActionResult> {
    if (!this.enabled) {
      throw new Error('GPO_DISABLED');
    }

    if (!this.allowedLines.includes(line)) {
      throw new Error('INVALID_LINE');
    }

    if (action === 'pulse') {
      const parsedDuration = Number.isFinite(durationMs)
        ? Math.min(Math.max(1, durationMs), 60000)
        : 1000;
      return this.pulse(line, parsedDuration);
    }

    return this.setGpo(line, action === 'on');
  }

  private normalizeBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim();

    if (!trimmed) {
      return '';
    }

    try {
      const parsed = new URL(trimmed);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return trimmed.replace(/\/+$/, '');
    }
  }

  private async pulse(line: number, durationMs: number): Promise<ReaderGpoPulseResult> {
    const on = await this.setGpo(line, true);
    await sleep(durationMs);
    const off = await this.setGpo(line, false);

    return { line, durationMs, on, off };
  }

  private async setGpo(line: number, state: boolean): Promise<ReaderGpoToggleResult> {
    const useDigest = this.credentials && this.authType === 'digest';
    const authHeader = this.credentials && this.authType === 'basic'
      ? {
          Authorization: `Basic ${Buffer.from(`${this.credentials.username}:${this.credentials.password}`).toString(
            'base64'
          )}`
        }
      : undefined;

    try {
      const path = this.singleDeviceMode
        ? `/device/setGPO/${line}/${state}`
        : `/devices/${encodeURIComponent(this.deviceId)}/setGPO/${line}/${state}`;
      const url = `${this.config.baseUrl}${path}`;
      if (useDigest) {
        const digestResponse = await this.performDigestRequest(path);
        logger.debug({ line, state }, 'Toggled reader GPO with digest auth');
        return { line, state, status: digestResponse.status, data: digestResponse.data, url };
      }

      const response = await this.http.get(path, {
        headers: authHeader
      });
      logger.debug({ line, state }, 'Toggled reader GPO');
      return { line, state, status: response.status, data: response.data, url };
    } catch (error) {
      logger.error({ err: error, line, state }, 'Failed to toggle reader GPO state');
      (error as any).requestUrl = `${this.config.baseUrl}${
        this.singleDeviceMode
          ? `/device/setGPO/${line}/${state}`
          : `/devices/${encodeURIComponent(this.deviceId)}/setGPO/${line}/${state}`
      }`;
      throw error;
    }
  }

  private async performDigestRequest(path: string): Promise<{ status: number; data: unknown }> {
    if (!this.credentials) {
      throw new Error('MISSING_CREDENTIALS');
    }

    if (!this.digestClient) {
      const { default: DigestFetch } = await import('digest-fetch');
      this.digestClient = new DigestFetch(this.credentials.username, this.credentials.password, {
        algorithm: 'MD5',
        basic: false
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const url = `${this.config.baseUrl}${path}`;
      const response = await this.digestClient.fetch(url, { method: 'GET', signal: controller.signal });
      const text = await response.text();
      let data: unknown = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!response.ok) {
        const error: any = new Error(`Digest request failed with status ${response.status}`);
        error.response = { status: response.status, data };
        throw error;
      }

      return { status: response.status, data };
    } catch (error) {
      logger.error({ err: error, path }, 'Digest authentication request failed');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeAuthType(authType?: string | ReaderAuthType): ReaderAuthType {
    if (!authType) return 'digest';

    const normalized = `${authType}`.trim().toLowerCase();
    if (normalized === 'none' || normalized === 'basic' || normalized === 'digest') {
      return normalized;
    }

    return 'digest';
  }

  private recomputeState(): void {
    if (!this.config.enabled) {
      this.disabledReason = 'DISABLED_FLAG';
    } else if (!this.config.baseUrl) {
      this.disabledReason = 'MISSING_BASE_URL';
    } else if (!this.singleDeviceMode && !this.deviceId) {
      this.disabledReason = 'MISSING_DEVICE_ID';
    } else {
      this.disabledReason = null;
    }

    this.enabled = !this.disabledReason;
  }
}
