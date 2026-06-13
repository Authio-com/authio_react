import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest doesn't auto-register testing-library's afterEach cleanup
// unless `globals: true`. Wire it up explicitly so each test starts
// with a clean DOM and React tree.
afterEach(() => {
  cleanup();
});

// jsdom exposes window.location but not all of its methods. The
// no-op default for assign keeps us from accidentally navigating
// during a test run; individual tests can spy on it.
if (typeof window !== "undefined") {
  const orig = window.location.assign;
  if (!orig) {
    Object.defineProperty(window.location, "assign", {
      value: () => {},
      writable: true,
    });
  }
}
