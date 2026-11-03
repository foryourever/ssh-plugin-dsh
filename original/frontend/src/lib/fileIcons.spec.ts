import { describe, expect, it } from "vitest";
import { fileIconClass, fileIconKind } from "./fileIcons";

describe("fileIconKind 按扩展名分类", () => {
  it.each([
    ["photo.png", "image"],
    ["snapshot.JPEG", "image"],
    ["报告.docx", "word"],
    ["预算表.xlsx", "excel"],
    ["data.csv", "excel"],
    ["路演.pptx", "ppt"],
    ["manual.pdf", "pdf"],
    ["backup.tar.gz", "archive"],
    ["release.zip", "archive"],
    ["app.vue", "code"],
    ["config.yaml", "code"],
    ["song.flac", "audio"],
    ["clip.mp4", "video"],
    ["notes.txt", "file"],
    ["Makefile", "file"],
    [".gitignore", "file"],
    ["noext.", "file"],
  ])("%s → %s", (name, expected) => {
    expect(fileIconKind(name)).toBe(expected);
  });
});

describe("fileIconClass 主题着色", () => {
  it("只给媒体/代码/归档上色，办公文档与未知类型保持中性", () => {
    expect(fileIconClass("photo.png")).toBe("ssh-fi-image");
    expect(fileIconClass("archive.zip")).toBe("ssh-fi-archive");
    expect(fileIconClass("manual.pdf")).toBe("ssh-fi-pdf");
    expect(fileIconClass("main.rs")).toBe("ssh-fi-code");
    expect(fileIconClass("song.mp3")).toBe("ssh-fi-audio");
    expect(fileIconClass("clip.mp4")).toBe("ssh-fi-video");
    expect(fileIconClass("report.docx")).toBe("");
    expect(fileIconClass("notes.txt")).toBe("");
  });
});
