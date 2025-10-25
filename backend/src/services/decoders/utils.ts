export const hexToBuffer = (hex: string): Buffer => {
  return Buffer.from(hex, 'hex');
};

export const parseInt16 = (buf: Buffer, offset: number): number => {
  return buf.readInt16BE(offset);
};

export const parseUInt16 = (buf: Buffer, offset: number): number => {
  return buf.readUInt16BE(offset);
};

export const parseTemperatureFromEddystone = (buf: Buffer, offset: number): number | null => {
  const raw = buf.readInt16BE(offset);
  if (raw === 0x8000) {
    return null;
  }
  return raw / 256;
};
