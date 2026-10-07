/** Small TTL cache that also de-duplicates concurrent identical requests (spec 10.3). */
export class TtlCache {
  private store = new Map<string, { at: number; value: Promise<unknown> }>();
  constructor(private readonly ttlMs: number) {}

  async getOrSet<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.store.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.value as Promise<T>;
    const value = fn();
    this.store.set(key, { at: now, value });
    // never cache a failure
    value.catch(() => {
      if (this.store.get(key)?.value === value) this.store.delete(key);
    });
    if (this.store.size > 500) this.prune(now);
    return value;
  }

  private prune(now: number) {
    for (const [k, v] of this.store) if (now - v.at >= this.ttlMs) this.store.delete(k);
  }

  clear() {
    this.store.clear();
  }
}
