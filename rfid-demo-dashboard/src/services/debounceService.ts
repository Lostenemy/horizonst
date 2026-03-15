export class DebounceService {
  private readonly cache = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  shouldIgnore(epc: string, readerMac: string, antenna: number | null, eventTs: Date): boolean {
    const key = `${epc}|${readerMac}|${antenna ?? 'na'}`;
    const ts = eventTs.getTime();
    const previousTs = this.cache.get(key);

    if (previousTs !== undefined && ts - previousTs <= this.windowMs) {
      this.cache.set(key, ts);
      return true;
    }

    this.cache.set(key, ts);
    return false;
  }
}
