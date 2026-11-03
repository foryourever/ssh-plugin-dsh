// 预览辅助（自 files 插件 preview.ts 移植）：读上限、hex dump、分块预览硬上限。
// sftp/read 单片 ≤1MiB（sidecar bounded_bytes 钳制）；sudo/readFile 上限 8MiB。
// 分块预览经 sftp/stat + sftp/read(offset) 流式拼装，单文件 ≤256MiB 才进浏览器内存。

export const READ_MAX_BYTES = 1024 * 1024;
// sudo 车道单片读上限（sudo_fs MAX_READ_BYTES = 8MiB，留安全余量）。
export const SUDO_READ_MAX_BYTES = 4 * 1024 * 1024;
// 分块预览的硬上限（read 流式拼装，单文件 ≤256MiB 才进浏览器内存）。
export const PREVIEW_MAX_BYTES = 256 * 1024 * 1024;
// 多格式预览（PDF/Office/媒体）的“先询问”阈值：超过后不自动整文件进内存，
// 改为引导下载 / 本地打开；用户仍可显式选择「仍要预览」。文本链路不受影响。
export const PREVIEW_CONFIRM_BYTES = 32 * 1024 * 1024;

/** 编辑保存前的大小判断：序列化后字节数 ≤ sftp/write 直写上限才允许直接写回。 */
export function canEditBytes(byteLength: number): boolean {
  return byteLength >= 0 && byteLength <= 4 * 1024 * 1024;
}

function hexByte(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

function asciiByte(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
}

/**
 * 十六进制 dump：每行 16 字节 —— 偏移(8位hex) + hex 两列 + ASCII。
 * 仅渲染传入字节（调用方负责截取前 512B）。
 */
export function hexDump(bytes: Uint8Array, bytesPerRow = 16): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += bytesPerRow) {
    const row = bytes.subarray(offset, Math.min(offset + bytesPerRow, bytes.length));
    const hexParts: string[] = [];
    const ascii: string[] = [];
    for (const byte of row) {
      hexParts.push(hexByte(byte));
      ascii.push(asciiByte(byte));
    }
    while (hexParts.length < bytesPerRow) hexParts.push("  ");
    const mid = bytesPerRow / 2;
    const hex = `${hexParts.slice(0, mid).join(" ")}  ${hexParts.slice(mid).join(" ")}`;
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii.join("")}|`);
  }
  return lines.join("\n");
}
