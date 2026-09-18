const sensitiveKey = /(pass(word|wd)?|secret|token|credential|authorization|private.?key|cert.*url|key.*url)/i;

export function redactHardwarePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactHardwarePayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key,
    sensitiveKey.test(key) ? '[REDACTED]' : redactHardwarePayload(nested)
  ]));
}
