import { describe, expect, it } from "vitest";
import { FailureLimiter } from "./failure-limiter.js";

describe("FailureLimiter", () => {
  it("blocks only after max failures and reports a retry time", () => {
    let t = 1_000_000;
    const l = new FailureLimiter(3, 60_000, () => t);
    for (let i = 0; i < 2; i++) l.fail("k");
    expect(l.retryAfterSeconds("k")).toBe(0);
    l.fail("k");
    expect(l.retryAfterSeconds("k")).toBe(60);
    t += 20_000;
    expect(l.retryAfterSeconds("k")).toBe(40);
  });

  it("unblocks once the window has passed", () => {
    let t = 0;
    const l = new FailureLimiter(2, 1000, () => t);
    l.fail("k");
    l.fail("k");
    expect(l.retryAfterSeconds("k")).toBeGreaterThan(0);
    t += 1001;
    expect(l.retryAfterSeconds("k")).toBe(0);
  });

  it("keeps keys independent and supports reset", () => {
    const l = new FailureLimiter(1, 60_000);
    l.fail("a");
    expect(l.retryAfterSeconds("a")).toBeGreaterThan(0);
    expect(l.retryAfterSeconds("b")).toBe(0);
    l.reset("a");
    expect(l.retryAfterSeconds("a")).toBe(0);
  });

  it("slides: old failures age out one by one", () => {
    let t = 0;
    const l = new FailureLimiter(2, 1000, () => t);
    l.fail("k"); // t=0
    t = 600;
    l.fail("k"); // t=600 -> blocked
    expect(l.retryAfterSeconds("k")).toBe(1);
    t = 1001; // first one aged out, only one left
    expect(l.retryAfterSeconds("k")).toBe(0);
  });
});
