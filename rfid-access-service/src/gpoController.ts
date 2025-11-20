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

  constructor(private readonly config: ReaderControlConfig) {
    this.enabled = Boolean(config.enabled && config.baseUrl && config.deviceId);
    this.http = axios.create({
      baseURL: this.normalizeBaseUrl(config.baseUrl),
      timeout: config.timeoutMs
    });
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
