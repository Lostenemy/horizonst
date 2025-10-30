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

export type AccessDecision = 'GRANTED' | 'DENIED';

export interface PublishedCommand {
  topic: string;
  payload: string;
  qos: 0 | 1 | 2;
  retain: boolean;
}

export interface AccessEvaluationResult {
  decision: AccessDecision;
  reason?: string;
  dni: string | null;
  publications: PublishedCommand[];
}

export interface SimulationRequest {
  mac: string;
  cardId: string;
  timestamp?: string;
  additional?: Record<string, unknown>;
}

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
