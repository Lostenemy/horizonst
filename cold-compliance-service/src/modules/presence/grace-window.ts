export function graceWindow(lastDetectionAt: string | Date, minutes: number): { startedAt: string; until: string } {
  const detectedMs = new Date(lastDetectionAt).getTime();
  if (!Number.isFinite(detectedMs) || !Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('Invalid grace window input');
  }
  return {
    startedAt: new Date(detectedMs).toISOString(),
    until: new Date(detectedMs + minutes * 60_000).toISOString()
  };
}
