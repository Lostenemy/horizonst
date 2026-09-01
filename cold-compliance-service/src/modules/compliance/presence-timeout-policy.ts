export function shouldClosePresenceSession(params: {
  nowMs: number;
  lastPresenceAtMs: number;
  timeoutMs: number;
}): boolean {
  if (!Number.isFinite(params.nowMs) || !Number.isFinite(params.lastPresenceAtMs)) return false;
  return params.nowMs - params.lastPresenceAtMs > Math.max(1000, params.timeoutMs);
}
