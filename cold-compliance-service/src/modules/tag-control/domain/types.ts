export type CommandKind = 'led' | 'buzzer' | 'vibration';

export interface LedCommandData { state: 0 | 1; duration: number; }
export interface BuzzerCommandData { state: 0 | 1; frequency: number; duration: number; }
export interface VibrationCommandData { state: 0 | 1; intensity: number; duration: number; }

export interface SendTagCommandInput {
  workerId?: string;
  tagId?: string;
  tagUid?: string;
  gatewayMac?: string;
  templateCode?: string;
  commandKind?: CommandKind;
  commandData?: LedCommandData | BuzzerCommandData | VibrationCommandData;
  triggerSource: 'compliance' | 'user' | 'system';
  triggerReason: string;
  timeoutMs?: number;
}

export interface GatewayReplyPayload {
  msg_id?: number;
  device_info?: { mac?: string };
  result_code?: number;
  result_msg?: string;
  [k: string]: unknown;
}
