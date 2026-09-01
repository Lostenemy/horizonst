export interface PresenceSignalDecision {
  accepted: boolean;
  requiredRssi: number;
  reason?: 'gateway_not_registered' | 'rssi_below_threshold';
}

export function evaluatePresenceSignal(params: {
  gatewayRegistered: boolean;
  coldRoomId: string | null;
  hasOpenSession: boolean;
  rssi?: number;
  rssiThreshold: number;
  entryMarginDb: number;
}): PresenceSignalDecision {
  const requiredRssi = params.hasOpenSession
    ? params.rssiThreshold
    : Math.min(0, params.rssiThreshold + Math.max(0, params.entryMarginDb));

  if (!params.gatewayRegistered) {
    return { accepted: false, requiredRssi, reason: 'gateway_not_registered' };
  }
  if (typeof params.rssi === 'number' && params.rssi < requiredRssi) {
    return { accepted: false, requiredRssi, reason: 'rssi_below_threshold' };
  }
  return { accepted: true, requiredRssi };
}
