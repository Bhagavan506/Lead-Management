import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Under load (a full parallel test run) the default 1 s wait can be too tight for multi-step flows.
configure({ asyncUtilTimeout: 4000 });

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
