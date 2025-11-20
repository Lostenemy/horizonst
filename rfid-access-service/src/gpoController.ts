import axios, { AxiosInstance } from 'axios';
import type { AccessDecision } from './types.js';
import { logger } from './logger.js';

interface ReaderControlConfig {
  baseUrl: string;
  deviceId: string;
  timeoutMs: number;
  enabled: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ReaderGpoController {
  private readonly http: AxiosInstance;

  private readonly enabled: boolean;

  private readonly disabledReason: 'MISSING_BASE_URL' | 'MISSING_DEVICE_ID' | 'DISABLED_FLAG' | null;

  private readonly allowedLines = [4, 5, 6];

  private readonly config: ReaderControlConfig;

  constructor(config: ReaderControlConfig) {
    const normalizedBaseUrl = this.normalizeBaseUrl(config.baseUrl || '');
    const normalizedDeviceId = (config.deviceId || '').trim();

    if (!config.enabled) {
      this.disabledReason = 'DISABLED_FLAG';
    } else if (!normalizedBaseUrl) {
      this.disabledReason = 'MISSING_BASE_URL';
    } else if (!normalizedDeviceId) {
      this.disabledReason = 'MISSING_DEVICE_ID';
    } else {
      this.disabledReason = null;
    }

    this.enabled = !this.disabledReason;
    this.http = axios.create({
      baseURL: normalizedBaseUrl,
      timeout: config.timeoutMs
    });

    this.config = {
      ...config,
      baseUrl: normalizedBaseUrl,
      deviceId: normalizedDeviceId
    };
  }

  async handleDecision(decision: AccessDecision): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (decision === 'GRANTED') {
      await this.pulse(4, 5000);
      return;
    }

    await Promise.all([this.pulse(5, 10000), this.pulse(6, 5000)]);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  status() {
    return {
      enabled: this.enabled,
      deviceId: this.config.deviceId,
      baseUrl: this.normalizeBaseUrl(this.config.baseUrl),
      allowedLines: this.allowedLines,
      disabledReason: this.disabledReason
    } as const;
  }

  async triggerDecision(decision: AccessDecision): Promise<void> {
    await this.handleDecision(decision);
  }

  async controlLine(
    line: number,
    action: 'on' | 'off' | 'pulse',
    durationMs: number | undefined = 1000
  ): Promise<void> {
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
      await this.pulse(line, parsedDuration);
      return;
    }

    await this.setGpo(line, action === 'on');
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
  }

  private async pulse(line: number, durationMs: number): Promise<void> {
    try {
      await this.setGpo(line, true);
      await sleep(durationMs);
      await this.setGpo(line, false);
    } catch (error) {
      logger.error({ err: error, line, durationMs }, 'Failed to pulse reader GPO');
    }
  }

  private async setGpo(line: number, state: boolean): Promise<void> {
    try {
      const path = `/devices/${this.config.deviceId}/setGPO/${line}/${state}`;
      await this.http.get(path);
      logger.debug({ line, state }, 'Toggled reader GPO');
    } catch (error) {
      logger.error({ err: error, line, state }, 'Failed to toggle reader GPO state');
      throw error;
    }
  }
}
