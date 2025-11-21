import axios, { AxiosInstance } from 'axios';
import type { AccessDecision } from './types.js';
import { logger } from './logger.js';

interface ReaderControlConfig {
  baseUrl: string;
  deviceId: string;
  timeoutMs: number;
  enabled: boolean;
  username?: string;
  password?: string;
}

export interface ReaderGpoToggleResult {
  line: number;
  state: boolean;
  status: number;
  data: unknown;
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

  private disabledReason: 'MISSING_BASE_URL' | 'MISSING_DEVICE_ID' | 'DISABLED_FLAG' | null;

  private deviceId: string;

  private readonly allowedLines = [4, 5, 6];

  private readonly config: ReaderControlConfig;

  constructor(config: ReaderControlConfig) {
    const normalizedBaseUrl = this.normalizeBaseUrl(config.baseUrl || '');
    const normalizedDeviceId = (config.deviceId || '').trim();

    this.disabledReason = null;
    this.enabled = false;
    this.credentials = null;
    this.deviceId = normalizedDeviceId;
    this.http = axios.create({
      baseURL: normalizedBaseUrl,
      timeout: config.timeoutMs
    });

    this.config = {
      ...config,
      baseUrl: normalizedBaseUrl,
      deviceId: normalizedDeviceId
    };

    this.updateCredentials({ username: config.username, password: config.password });
    this.recomputeState();
  }

  async handleDecision(decision: AccessDecision): Promise<ReaderGpoActionResult[]> {
    if (!this.enabled) {
      throw new Error('GPO_DISABLED');
    }

    if (decision === 'GRANTED') {
      return [await this.pulse(4, 5000)];
    }

    const [line5, line6] = await Promise.all([this.pulse(5, 10000), this.pulse(6, 5000)]);
    return [line5, line6];
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  status() {
    return {
      enabled: this.enabled,
      baseUrl: this.normalizeBaseUrl(this.config.baseUrl),
      deviceId: this.deviceId,
      allowedLines: this.allowedLines,
      disabledReason: this.disabledReason,
      auth: {
        username: this.credentials?.username ?? null,
        configured: Boolean(this.credentials)
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

  updateCredentials(credentials: { username?: string; password?: string } | null): void {
    const username = credentials?.username?.trim() ?? '';
    const password = credentials?.password ?? '';

    if (!username || !password) {
      this.credentials = null;
      return;
    }

    this.credentials = { username, password };
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
    return baseUrl.replace(/\/+$/, '');
  }

  private async pulse(line: number, durationMs: number): Promise<ReaderGpoPulseResult> {
    const on = await this.setGpo(line, true);
    await sleep(durationMs);
    const off = await this.setGpo(line, false);

    return { line, durationMs, on, off };
  }

  private async setGpo(line: number, state: boolean): Promise<ReaderGpoToggleResult> {
    try {
      const path = `/devices/${encodeURIComponent(this.deviceId)}/setGPO/${line}/${state}`;
      const response = await this.http.get(path, {
        auth: this.credentials ?? undefined
      });
      logger.debug({ line, state }, 'Toggled reader GPO');
      return { line, state, status: response.status, data: response.data };
    } catch (error) {
      logger.error({ err: error, line, state }, 'Failed to toggle reader GPO state');
      throw error;
    }
  }

  private recomputeState(): void {
    if (!this.config.enabled) {
      this.disabledReason = 'DISABLED_FLAG';
    } else if (!this.config.baseUrl) {
      this.disabledReason = 'MISSING_BASE_URL';
    } else if (!this.deviceId) {
      this.disabledReason = 'MISSING_DEVICE_ID';
    } else {
      this.disabledReason = null;
    }

    this.enabled = !this.disabledReason;
  }
}
