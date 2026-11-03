// MCP 设置镜像单测（存储迁移批 1 收尾）：persisted 优先于 effective（环境变
// 量覆盖不得被回推）、get 载荷提取容错、store 播种/坏档自愈、集合等值比较
// （connectionScope 顺序不稳定不触发收敛）。pluginStore 走 node 内存档。
import { describe, expect, it } from "vitest";
import { pluginStore } from "./pluginStore";
import {
  extractMcpSettingsMirror,
  loadMcpSettingsMirror,
  mcpSettingsMirrorEquals,
  MCP_LIMIT_CEILING_MIB,
  MCP_SETTINGS_STORE_KEY,
  MIB,
  mibField,
  parseMibInput,
  persistMcpSettingsMirror,
} from "./settingsModel";

describe("extractMcpSettingsMirror", () => {
  it("prefers persisted permission fields over effective values (env override must not round-trip)", () => {
    const mirror = extractMcpSettingsMirror({
      maxReadBytes: 8 * 1024 * 1024,
      maxUploadBytes: 1024,
      maxDownloadBytes: 2048,
      localTransferRoot: "/device/local", // 设备本地路径：不进镜像
      execPermissionMode: "autonomous", // 生效值（env 覆盖）
      connectionScope: ["prod-*"],
      persistedExecPermissionMode: "confirm",
      persistedConnectionScope: ["prod-a", "prod-b"],
    });
    expect(mirror).toEqual({
      maxReadBytes: 8 * 1024 * 1024,
      maxUploadBytes: 1024,
      maxDownloadBytes: 2048,
      execPermissionMode: "confirm",
      connectionScope: ["prod-a", "prod-b"],
    });
  });

  it("falls back to effective values on old sidecars without persisted fields", () => {
    const mirror = extractMcpSettingsMirror({ execPermissionMode: "confirm", connectionScope: ["x"] });
    expect(mirror.execPermissionMode).toBe("confirm");
    expect(mirror.connectionScope).toEqual(["x"]);
  });

  it("defaults missing size fields to sidecar defaults and sanitizes scope entries", () => {
    const mirror = extractMcpSettingsMirror({ connectionScope: ["  ", "ok", 42, null] });
    expect(mirror.maxReadBytes).toBe(256 * 1024);
    expect(mirror.maxUploadBytes).toBe(16 * 1024 * 1024);
    expect(mirror.maxDownloadBytes).toBe(1024 * 1024);
    expect(mirror.execPermissionMode).toBe("autonomous");
    expect(mirror.connectionScope).toEqual(["ok"]);
  });

  it("tolerates non-object payloads", () => {
    expect(extractMcpSettingsMirror(null).connectionScope).toEqual([]);
    expect(extractMcpSettingsMirror("garbage").execPermissionMode).toBe("autonomous");
  });
});

describe("mirror store round-trip (存储迁移批 1)", () => {
  // 顺序依赖：本文件首个断言在首个 persist 之前（pluginStore 模块缓存同文件共享）。
  it("loadMcpSettingsMirror returns null while the key is absent (seed pending)", () => {
    expect(loadMcpSettingsMirror()).toBeNull();
  });

  it("persist then load round-trips; corrupt JSON self-heals to null (reseed from sidecar)", () => {
    persistMcpSettingsMirror({
      maxReadBytes: 1024,
      maxUploadBytes: 2048,
      maxDownloadBytes: 4096,
      execPermissionMode: "confirm",
      connectionScope: ["a"],
    });
    expect(loadMcpSettingsMirror()).toEqual({
      maxReadBytes: 1024,
      maxUploadBytes: 2048,
      maxDownloadBytes: 4096,
      execPermissionMode: "confirm",
      connectionScope: ["a"],
    });
    pluginStore.setItem(MCP_SETTINGS_STORE_KEY, "{broken");
    // 与批 1 权威数据不同：镜像是派生载荷，坏档回落 null 触发下次播种自愈。
    expect(loadMcpSettingsMirror()).toBeNull();
  });
});

describe("mcpSettingsMirrorEquals", () => {
  const base = { maxReadBytes: 1, maxUploadBytes: 2, maxDownloadBytes: 3, execPermissionMode: "confirm", connectionScope: ["b", "a"] };

  it("compares connectionScope as a set (order drift must not trigger convergence)", () => {
    expect(mcpSettingsMirrorEquals(base, { ...base, connectionScope: ["a", "b"] })).toBe(true);
  });

  it("is strict on numbers and permission mode", () => {
    expect(mcpSettingsMirrorEquals(base, { ...base, maxReadBytes: 9 })).toBe(false);
    expect(mcpSettingsMirrorEquals(base, { ...base, execPermissionMode: "autonomous" })).toBe(false);
    expect(mcpSettingsMirrorEquals(base, { ...base, connectionScope: ["a"] })).toBe(false);
    expect(mcpSettingsMirrorEquals(base, { ...base })).toBe(true);
  });
});

// 回归 #241：读取上限默认 256 KiB，回填不能四舍五入成 0（否则整段 MCP 表单
// 永远非法、保存被静默跳过）；越界值必须在提交前挡住，而不是让 RPC 报错。
describe("MCP 尺寸输入（issue #241）", () => {
  it("formats sub-MiB values without rounding them to zero", () => {
    expect(mibField(256 * 1024)).toBe("0.25");
    expect(mibField(512 * 1024)).toBe("0.5");
    expect(mibField(16 * MIB)).toBe("16");
    expect(mibField(2048 * MIB)).toBe("2048");
    expect(mibField(0)).toBe("");
    expect(mibField(undefined)).toBe("");
  });

  it("round-trips formatted values back to the same byte count", () => {
    for (const bytes of [256 * 1024, 512 * 1024, MIB, 16 * MIB, 2048 * MIB]) {
      const field = mibField(bytes);
      expect(parseMibInput(field, MCP_LIMIT_CEILING_MIB.download)).toBe(bytes);
    }
  });

  it("parses decimals and trims whitespace", () => {
    expect(parseMibInput("0.25", MCP_LIMIT_CEILING_MIB.read)).toBe(256 * 1024);
    expect(parseMibInput(" 16 ", MCP_LIMIT_CEILING_MIB.upload)).toBe(16 * MIB);
    expect(parseMibInput("8", MCP_LIMIT_CEILING_MIB.read)).toBe(8 * MIB);
    // number 输入形状来自 `<input type="number">` 的 v-model（Vue 自动转型）。
    expect(parseMibInput(0.25, MCP_LIMIT_CEILING_MIB.read)).toBe(256 * 1024);
  });

  it("rejects non-positive, malformed and over-ceiling values", () => {
    expect(parseMibInput("0", MCP_LIMIT_CEILING_MIB.read)).toBeNull();
    expect(parseMibInput("-1", MCP_LIMIT_CEILING_MIB.read)).toBeNull();
    expect(parseMibInput("abc", MCP_LIMIT_CEILING_MIB.read)).toBeNull();
    expect(parseMibInput("1e3", MCP_LIMIT_CEILING_MIB.read)).toBeNull();
    // 用户填 1024 MiB 读取上限（本 issue 的场景）：sidecar 上限 8 MiB，客户端先拦。
    expect(parseMibInput("1024", MCP_LIMIT_CEILING_MIB.read)).toBeNull();
    expect(parseMibInput("8.1", MCP_LIMIT_CEILING_MIB.read)).toBeNull();
    expect(parseMibInput("2049", MCP_LIMIT_CEILING_MIB.download)).toBeNull();
  });
});
