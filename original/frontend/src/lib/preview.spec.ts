import { describe, expect, it } from "vitest";
import { canEditBytes, hexDump, PREVIEW_MAX_BYTES, READ_MAX_BYTES, SUDO_READ_MAX_BYTES } from "./preview";

describe("limits", () => {
  it("stays within the sidecar per-chunk clamps", () => {
    // sftp/read 的 bounded_bytes 钳到 1MiB，sudo/readFile 钳到 8MiB。
    expect(READ_MAX_BYTES).toBe(1024 * 1024);
    expect(SUDO_READ_MAX_BYTES).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(PREVIEW_MAX_BYTES).toBe(256 * 1024 * 1024);
  });
});

describe("canEditBytes", () => {
  it("accepts payloads within the inline write cap and rejects the rest", () => {
    expect(canEditBytes(0)).toBe(true);
    expect(canEditBytes(4 * 1024 * 1024)).toBe(true);
    expect(canEditBytes(4 * 1024 * 1024 + 1)).toBe(false);
    expect(canEditBytes(-1)).toBe(false);
  });
});

describe("hexDump", () => {
  it("renders offset, hex columns and ascii column", () => {
    const bytes = new Uint8Array(17);
    for (let i = 0; i < 16; i += 1) bytes[i] = i;
    bytes[16] = 0x41;
    const dump = hexDump(bytes);
    const lines = dump.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^00000000  00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f/);
    expect(lines[0]).toContain("|................|");
    expect(lines[1]).toMatch(/^00000010  41/);
    expect(lines[1]).toContain("|A|");
  });

  it("masks non-printable bytes as dots", () => {
    const dump = hexDump(new Uint8Array([0x48, 0x00, 0xff, 0x69]));
    expect(dump).toContain("|H..i|");
  });
});
