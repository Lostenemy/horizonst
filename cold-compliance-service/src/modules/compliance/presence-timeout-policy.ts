export function shouldClosePresenceSession(params: {
  nowMs: number;
  lastPresenceAtMs: number;
  timeoutMs: number;
  controlledOperation?: { startedAtMs: number; hardDeadlineMs: number; protectUntilMs: number };
}): boolean {
  if (!Number.isFinite(params.nowMs) || !Number.isFinite(params.lastPresenceAtMs)) return false;
  const operation = params.controlledOperation;
  if (operation && [operation.startedAtMs, operation.hardDeadlineMs, operation.protectUntilMs].every(Number.isFinite)
      && operation.startedAtMs <= params.nowMs && operation.hardDeadlineMs > operation.startedAtMs
      && operation.hardDeadlineMs <= operation.startedAtMs + 120_000
      && operation.protectUntilMs >= operation.startedAtMs && operation.protectUntilMs <= operation.hardDeadlineMs
      && params.nowMs < Math.min(operation.protectUntilMs,params.lastPresenceAtMs+60_000)) return false;
  return params.nowMs - params.lastPresenceAtMs > Math.max(1000, params.timeoutMs);
}
