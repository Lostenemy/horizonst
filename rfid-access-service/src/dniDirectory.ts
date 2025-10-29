import fs from 'node:fs/promises';
import path from 'node:path';
import axios, { AxiosInstance } from 'axios';
import { logger } from './logger.js';
import { normalizeMac } from './utils.js';
import type { DirectoryConfig, MacDniMap } from './types.js';

const parseKeyValueLines = (raw: string): MacDniMap => {
  return Object.fromEntries(
    raw
      .split(/\r?\n|,/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((entry) => {
        const [mac, dni] = entry.split('=');
        return [normalizeMac(mac), (dni || '').trim()];
      })
      .filter(([mac, dni]) => Boolean(mac) && Boolean(dni)) as [string, string][]
  );
};

const coerceMapping = (value: unknown): MacDniMap => {
  if (!value) {
    return {};
  }

  if (Array.isArray(value)) {
    const result: [string, string][] = [];
    for (const entry of value) {
      if (typeof entry === 'string') {
        const [mac, dni] = entry.split('=');
        if (mac && dni) {
          result.push([normalizeMac(mac), dni.trim()]);
        }
        continue;
      }

      if (entry && typeof entry === 'object') {
        const macField =
          'mac' in entry
            ? (entry.mac as string)
            : 'macAddress' in entry
            ? (entry.macAddress as string)
            : 'readerMac' in entry
            ? (entry.readerMac as string)
            : undefined;
        const dniField =
          'dni' in entry
            ? (entry.dni as string)
            : 'document' in entry
            ? (entry.document as string)
            : 'documentNumber' in entry
            ? (entry.documentNumber as string)
            : 'document_number' in entry
            ? (entry.document_number as string)
            : undefined;
        const mac = macField;
        const dni = dniField;
        if (mac && dni) {
          result.push([normalizeMac(mac), dni.trim()]);
        }
      }
    }
    return Object.fromEntries(result);
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([mac, dni]) => {
          const normalizedMac = normalizeMac(mac);
          let normalizedDni: string | null = null;

          if (typeof dni === 'string') {
            normalizedDni = dni.trim();
          } else if (dni != null) {
            normalizedDni = String(dni).trim();
          }

          return [normalizedMac, normalizedDni];
        })
        .filter(([mac, dni]) => Boolean(mac) && Boolean(dni)) as [string, string][]
    );
  }

  if (typeof value === 'string') {
    try {
      return coerceMapping(JSON.parse(value));
    } catch (error) {
      return parseKeyValueLines(value);
    }
  }

  return {};
};

interface RemoteDirectoryConfig {
  url: string;
  apiKey?: string;
  timeoutMs: number;
}

export class DniDirectory {
  private map = new Map<string, string>();
  private refreshTimer?: NodeJS.Timeout;
  private initialized = false;

  constructor(private readonly config: DirectoryConfig) {}

  async initialize(): Promise<void> {
    await this.reload();

    const refreshEvery = this.config.refreshIntervalMs ?? 0;
    const shouldRefreshRemote =
      this.config.remote && this.config.lookupStrategy === 'eager';

    if (refreshEvery > 0 && (this.config.filePath || shouldRefreshRemote)) {
      this.refreshTimer = setInterval(() => {
        this.reload().catch((error) => {
          logger.error({ err: error }, 'Error reloading DNI directory');
        });
      }, refreshEvery);
      this.refreshTimer.unref();
    }
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  async getDni(mac: string): Promise<string | null> {
    const normalized = normalizeMac(mac);
    if (!normalized) {
      return null;
    }
    if (this.map.has(normalized)) {
      return this.map.get(normalized) ?? null;
    }

    if (this.config.remote && this.config.lookupStrategy === 'on-demand') {
      try {
        const remoteData = await this.fetchRemote(this.config.remote);
        if (remoteData[normalized]) {
          this.map.set(normalized, remoteData[normalized]);
          return remoteData[normalized];
        }
      } catch (error) {
        logger.error({ err: error, mac: normalized }, 'Failed on-demand lookup for DNI directory');
      }
    }

    return null;
  }

  private async reload(): Promise<void> {
    const nextMap = new Map<string, string>();

    if (this.config.inline && Object.keys(this.config.inline).length > 0) {
      for (const [mac, dni] of Object.entries(this.config.inline)) {
        const normalized = normalizeMac(mac);
        if (normalized && dni) {
          nextMap.set(normalized, dni.trim());
        }
      }
    }

    if (this.config.filePath) {
      try {
        const fileContent = await fs.readFile(path.resolve(this.config.filePath), 'utf-8');
        const parsed = coerceMapping(fileContent);
        for (const [mac, dni] of Object.entries(parsed)) {
          const normalized = normalizeMac(mac);
          if (normalized && dni) {
            nextMap.set(normalized, dni.trim());
          }
        }
      } catch (error) {
        logger.error({ err: error, file: this.config.filePath }, 'Failed to load DNI directory file');
      }
    }

    if (this.config.remote && this.config.lookupStrategy === 'eager') {
      try {
        const remoteData = await this.fetchRemote(this.config.remote);
        for (const [mac, dni] of Object.entries(remoteData)) {
          const normalized = normalizeMac(mac);
          if (normalized && dni) {
            nextMap.set(normalized, dni.trim());
          }
        }
      } catch (error) {
        logger.error({ err: error, url: this.config.remote.url }, 'Failed to preload DNI directory from remote source');
      }
    }

    this.map = nextMap;

    if (!this.initialized) {
      logger.info({ entries: this.map.size }, 'Loaded DNI directory');
      this.initialized = true;
    } else {
      logger.debug({ entries: this.map.size }, 'Refreshed DNI directory');
    }
  }

  private async fetchRemote(config: RemoteDirectoryConfig): Promise<MacDniMap> {
    const axiosInstance: AxiosInstance = axios.create({ timeout: config.timeoutMs });
    if (config.apiKey) {
      axiosInstance.defaults.headers.common.Authorization = `Bearer ${config.apiKey}`;
    }

    const response = await axiosInstance.get(config.url);
    return coerceMapping(response.data);
  }
}
