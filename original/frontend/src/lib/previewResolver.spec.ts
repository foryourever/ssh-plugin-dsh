import { describe, expect, it } from "vitest";
import { extensionFor, resolvePreview } from "./previewResolver";

describe("extensionFor", () => {
  it("extracts the normalized final extension", () => {
    expect(extensionFor("/var/log/app.LOG")).toBe("log");
    expect(extensionFor("C:\\data\\report.tar.gz")).toBe("tar.gz");
  });

  it("treats dotfiles and trailing dots as extensionless", () => {
    expect(extensionFor("/etc/profile.d/.env")).toBe("");
    expect(extensionFor("notes.")).toBe("");
    expect(extensionFor("Makefile")).toBe("");
  });
});

describe("resolvePreview", () => {
  it("routes plain text/code to the editable codemirror lane", () => {
    const resolution = resolvePreview("/srv/app/main.rs");
    expect(resolution.kind).toBe("text");
    expect(resolution.previewStrategy).toBe("codemirror");
    expect(resolution.editable).toBe(true);
    expect(resolution.editorStrategy).toBe("codemirror");
    expect(resolution.mime).toBe("text/x-rust");
  });

  it("routes browser-native images to the image lane", () => {
    const resolution = resolvePreview("/srv/img/photo.PNG");
    expect(resolution.kind).toBe("image");
    expect(resolution.previewStrategy).toBe("image");
    expect(resolution.editable).toBe(false);
    expect(resolution.mime).toBe("image/png");
  });

  it("routes decodable-only images (heic/tiff) to the viewer lane", () => {
    const resolution = resolvePreview("/srv/img/scan.tiff");
    expect(resolution.kind).toBe("image");
    expect(resolution.previewStrategy).toBe("file-viewer");
  });

  it("routes office/pdf/media to the embedded viewer", () => {
    expect(resolvePreview("a.docx").previewStrategy).toBe("file-viewer");
    expect(resolvePreview("a.pdf").previewStrategy).toBe("file-viewer");
    expect(resolvePreview("a.mp4").previewStrategy).toBe("file-viewer");
    expect(resolvePreview("a.xlsx").previewStrategy).toBe("file-viewer");
    expect(resolvePreview("a.pptx").previewStrategy).toBe("file-viewer");
    expect(resolvePreview("a.csv").previewStrategy).toBe("file-viewer");
    expect(resolvePreview("a.rtf").previewStrategy).toBe("file-viewer");
  });

  it("keeps html on codemirror so the theme follows the host", () => {
    const resolution = resolvePreview("/srv/index.html");
    expect(resolution.previewStrategy).toBe("codemirror");
    expect(resolution.mime).toBe("text/html");
  });

  it("keeps unknown extensions on the hex/text heuristic lane", () => {
    const resolution = resolvePreview("/srv/blob/unknown.xyz");
    expect(resolution.kind).toBe("unknown");
    expect(resolution.previewStrategy).toBe("hex");
    expect(resolution.editable).toBe(false);
    expect(resolution.fallback).toBe(true);
    expect(resolution.fallbackReason).toBe("unknown-extension");
  });

  it("treats archives as unknown extensions (no archiveList in the ssh sidecar)", () => {
    const resolution = resolvePreview("/srv/backup.tar.gz");
    expect(resolution.extension).toBe("tar.gz");
    expect(resolution.previewStrategy).toBe("hex");
  });

  it("keaves markdown editable with the markdown mime", () => {
    const resolution = resolvePreview("README.md");
    expect(resolution.mime).toBe("text/markdown");
    expect(resolution.editable).toBe(true);
  });
});
