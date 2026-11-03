import { describe, expect, it } from "vitest";
import {
  FLAG_HINTS,
  resolveFlagHint,
  shouldShowFlagHint,
  trailingFlagToken,
} from "./flagHints";

describe("trailingFlagToken", () => {
  it("extracts the trailing flag token", () => {
    expect(trailingFlagToken("git commit --amend")).toBe("--amend");
    expect(trailingFlagToken("git push -f")).toBe("-f");
    expect(trailingFlagToken("kubectl get pods -o")).toBe("-o");
    expect(trailingFlagToken("kubectl get -o wide pods -w")).toBe("-w");
  });

  it("returns null when the line does not end with a flag", () => {
    expect(trailingFlagToken("git status")).toBeNull();
    expect(trailingFlagToken("git commit -m \"msg\"")).toBeNull();
    expect(trailingFlagToken("")).toBeNull();
    expect(trailingFlagToken("ls -la /tmp")).toBeNull();
  });
});

describe("resolveFlagHint", () => {
  it("resolves long flags for a corpus command", () => {
    expect(resolveFlagHint("git commit --amend")).toEqual({
      flag: "--amend",
      description: FLAG_HINTS.git.flags["--amend"],
      command: "git",
    });
    expect(resolveFlagHint("git push --force-with-lease")).toEqual({
      flag: "--force-with-lease",
      description: FLAG_HINTS.git.flags["--force-with-lease"],
      command: "git",
    });
  });

  it("resolves short flags by bare letter", () => {
    expect(resolveFlagHint("kubectl get pods -o")?.description).toBe(FLAG_HINTS.kubectl.flags.o);
    expect(resolveFlagHint("docker run -d")?.description).toBe(FLAG_HINTS.docker.flags["detach"] ?? FLAG_HINTS.docker.flags.d);
    expect(resolveFlagHint("git commit -m")?.description).toBe(FLAG_HINTS.git.flags.m);
  });

  it("normalizes --x=y assignments to the bare long flag", () => {
    expect(resolveFlagHint("git commit --message=hello")?.flag).toBe("--message");
    expect(resolveFlagHint("kubectl get pods --output=json")?.flag).toBe("--output");
  });

  it("skips env prefixes and sudo to find the leading command", () => {
    expect(resolveFlagHint("sudo systemctl restart --now")?.command).toBe("systemctl");
    expect(resolveFlagHint("FOO=1 GIT_DIR=. git commit --amend")?.command).toBe("git");
  });

  it("returns null for commands outside the corpus", () => {
    expect(resolveFlagHint("curl -sS https://x")).toBeNull();
    expect(resolveFlagHint("ls -la")).toBeNull();
  });

  it("returns null for unknown flags of corpus commands", () => {
    expect(resolveFlagHint("git commit --zzz")).toBeNull();
    expect(resolveFlagHint("git commit -z")).toBeNull();
  });

  it("returns null when no flag token is being typed", () => {
    expect(resolveFlagHint("git commit")).toBeNull();
    expect(resolveFlagHint("git commit -m \"msg\"")).toBeNull();
  });

  it("does not trigger on the bare dash still being typed", () => {
    expect(resolveFlagHint("git commit -")).toBeNull();
    expect(resolveFlagHint("git commit --")).toBeNull();
  });

  it("does not trigger on mid-line flags (trailing-token semantics)", () => {
    // -v 出现在中间、行尾 token 非 flag：不提示（设计稿裁决：仅行尾 token）。
    expect(resolveFlagHint("git -v commit now")).toBeNull();
  });

  it("covers all corpus commands with at least one flag", () => {
    for (const [command, entry] of Object.entries(FLAG_HINTS)) {
      expect(Object.keys(entry.flags).length, command).toBeGreaterThan(0);
      expect(entry.source, command).toMatch(/\S/);
    }
  });
});

describe("shouldShowFlagHint", () => {
  const base = {
    enabled: true,
    hint: true,
    alternateActive: false,
    commandRunning: false,
    transferBusy: false,
    overlayOpen: false,
  };

  it("shows when enabled and hit with no overlays", () => {
    expect(shouldShowFlagHint(base)).toBe(true);
  });

  it("hides when disabled or no hint hit", () => {
    expect(shouldShowFlagHint({ ...base, enabled: false })).toBe(false);
    expect(shouldShowFlagHint({ ...base, hint: false })).toBe(false);
  });

  it("yields to alternate buffer, running commands, transfers and overlays", () => {
    expect(shouldShowFlagHint({ ...base, alternateActive: true })).toBe(false);
    expect(shouldShowFlagHint({ ...base, commandRunning: true })).toBe(false);
    expect(shouldShowFlagHint({ ...base, transferBusy: true })).toBe(false);
    expect(shouldShowFlagHint({ ...base, overlayOpen: true })).toBe(false);
  });
});
