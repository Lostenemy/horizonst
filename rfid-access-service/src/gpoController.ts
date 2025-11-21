import axios, { AxiosInstance } from 'axios';
import type { AccessDecision } from './types.js';
import { logger } from './logger.js';

interface ReaderControlConfig {
  baseUrl: string;
  timeoutMs: number;
  enabled: boolean;
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

  private disabledReason: 'MISSING_BASE_URL' | 'DISABLED_FLAG' | null;

  private readonly allowedLines = [4, 5, 6];

  private readonly config: ReaderControlConfig;

  constructor(config: ReaderControlConfig) {
    const normalizedBaseUrl = this.normalizeBaseUrl(config.baseUrl || '');

    this.disabledReason = null;
    this.enabled = false;
    this.http = axios.create({
      baseURL: normalizedBaseUrl,
      timeout: config.timeoutMs
    });

    this.config = {
      ...config,
      baseUrl: normalizedBaseUrl
    };

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
      allowedLines: this.allowedLines,
      disabledReason: this.disabledReason
    } as const;
  }

  updateBaseUrl(baseUrl: string): void {
    const normalizedBaseUrl = this.normalizeBaseUrl(baseUrl || '');
    this.config.baseUrl = normalizedBaseUrl;
    this.http.defaults.baseURL = normalizedBaseUrl;
    this.recomputeState();
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
      const path = `/setGPO/${line}/${state}`;
      const response = await this.http.get(path);
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
    } else {
      this.disabledReason = null;
    }

    this.enabled = !this.disabledReason;
  }
}
