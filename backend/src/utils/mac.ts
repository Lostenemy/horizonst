const MAC_REGEX = /^[0-9A-F]{12}$/i;

export function normalizeMacAddress(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const cleaned = input.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (!MAC_REGEX.test(cleaned)) {
    return null;
  }
  return cleaned;
}

export function isValidMacAddress(input: unknown): boolean {
  return normalizeMacAddress(input) !== null;
}
