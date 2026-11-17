import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom has no matchMedia. Tests run as a wide (desktop) screen unless they say otherwise.
export function setDesktop(desktop: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: desktop,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
beforeEach(() => setDesktop(true));
afterEach(() => cleanup());
