import { describe, expect, it } from "vitest";
import { createConnectLog, latestConnectProgress } from "./connectLog";

describe("latestConnectProgress", () => {
  it("returns the newest entry message (newest-first ring buffer)", () => {
    const log = createConnectLog();
    log.push("info", "Starting workbench…");
    log.push("info", "Connecting (attempt 1)…");
    expect(latestConnectProgress(log.entries.value)).toBe("Connecting (attempt 1)…");
  });

  it("returns empty string for an empty buffer (static fallback)", () => {
    const log = createConnectLog();
    expect(latestConnectProgress(log.entries.value)).toBe("");
  });
});
