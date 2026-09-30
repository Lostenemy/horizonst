const MAC_REGEX = /^[0-9A-F]{12}$/i;

/** Inventario: hexadecimal compacto o seis octetos con un separador uniforme.
 * No elimina basura para convertir un identificador inválido en uno válido. */
export function normalizeInventoryMac(input: unknown, entity: 'device' | 'gateway'): string | null {
  if (typeof input !== 'string' || !/^(?:[0-9a-f]{12}|(?:[0-9a-f]{2}:){5}[0-9a-f]{2}|(?:[0-9a-f]{2}-){5}[0-9a-f]{2})$/i.test(input.trim())) return null;
  const mac = input.trim().replace(/[:-]/g, '');
  return entity === 'gateway' ? mac.toLowerCase() : mac.toUpperCase();
}

/** Solo columnas estáticas del código; nunca nombres suministrados por cliente. */
export function inventoryMacSql(column: string, entity: 'device' | 'gateway'): string {
  if (!/^[a-z_]+(?:\.[a-z_]+)?$/.test(column)) throw new Error('Invalid inventory MAC column');
  return `${entity === 'gateway' ? 'lower' : 'upper'}(regexp_replace(btrim(${column}), '[:-]', '', 'g'))`;
}

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

export function normalizeGatewayMac(input: unknown): string | null {
  return normalizeMacAddress(input)?.toLowerCase() ?? null;
}

export function buildMk3ClientId(input: unknown): string | null {
  const normalized = normalizeMacAddress(input);
  if (!normalized) {
    return null;
  }
  return `mk3-${normalized.toLowerCase()}`;
}
