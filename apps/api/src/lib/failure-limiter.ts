/**
 * In-memory limiter that counts failures (not requests) inside a sliding window.
 * Single-instance only: with several API instances each keeps its own counts (known limit, see docs).
 */
export class FailureLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  /** Seconds until another attempt is allowed, or 0 if the key is not blocked. */
  retryAfterSeconds(key: string): number {
    const list = this.recent(key);
    if (list.length < this.max) return 0;
    const oldest = list[list.length - this.max] as number;
    return Math.max(1, Math.ceil((oldest + this.windowMs - this.now()) / 1000));
  }

  fail(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.prune();
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(): void {
    for (const key of [...this.hits.keys()]) this.recent(key);
  }
}
