export interface RfidScanMessage {
  readerMac: string;
  cardId: string;
  timestamp?: string;
  additional?: Record<string, unknown>;
}

export interface AuthApiResponse {
  accepted: boolean;
  reason?: string;
  [key: string]: unknown;
}

export type MacDniMap = Record<string, string>;

export type LookupStrategy = 'eager' | 'on-demand';

export interface DirectoryConfig {
  inline?: MacDniMap;
  filePath?: string;
  remote?: {
    url: string;
    apiKey?: string;
    timeoutMs: number;
  } | null;
  refreshIntervalMs?: number;
  lookupStrategy: LookupStrategy;
}
