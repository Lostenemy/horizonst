export type PresenceEventType = 'enter' | 'exit' | 'heartbeat' | 'movement' | 'telemetry';

export interface ParsedPresenceEvent {
  eventId: string;
  gatewayMac: string;
  tagId: string;
  cameraCode?: string;
  eventType: PresenceEventType;
  timestamp: string;
  rssi?: number;
  battery?: number;
  rawPayload: Record<string, unknown>;
}
