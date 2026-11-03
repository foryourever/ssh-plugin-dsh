import { describe, expect, it } from "vitest";
import { ACTIVE_LINE_ALPHA_PERCENT, textPreviewSelectionColors, textPreviewTheme } from "./textPreviewTheme";

// issue #214 契约：drawSelection 的选区层 above:false（z-index -1）画在文本
// 内容之下，`.cm-line` 的背景色画在其上——`.cm-activeLine` 一旦是实色，光标
// 所在行（多行拉选的起始行、双击选中词所在行）的选区就被整行盖住。这里锁住
// 「activeLine 必须半透明」的样式契约，防止未来改回实色时回归。

const LIGHT = {
  background: "rgb(255 255 255)",
  foreground: "rgb(10 10 10)",
  muted: "rgb(245 245 245)",
  mutedForeground: "rgb(115 115 115)",
  accent: "rgb(245 245 245)",
  border: "rgb(229 229 229)",
} as const;

const DARK = { ...LIGHT, accent: "rgb(46 47 51)" } as const;

describe("textPreviewTheme", () => {
  it("keeps the active line translucent so the selection layer shows through", () => {
    for (const palette of [LIGHT, DARK]) {
      const theme = textPreviewTheme(palette, "light", { fontFamily: "Maple Mono NF", fontSize: 14 });
      const activeLine = theme[".cm-activeLine, .cm-activeLineGutter"].backgroundColor;
      expect(activeLine).toContain("color-mix");
      expect(activeLine).toContain("transparent");
      expect(activeLine).toContain(palette.accent);
      expect(activeLine).toContain(`${ACTIVE_LINE_ALPHA_PERCENT}%`);
      // 回归哨兵：绝不允许退回实色 accent（#214 的根因）。
      expect(activeLine).not.toBe(palette.accent);
    }
  });

  it("keeps the #155 selection colors for both color schemes", () => {
    expect(textPreviewSelectionColors("light").selectionBackground).toBe("#7cabecad");
    expect(textPreviewSelectionColors("dark").selectionBackground).toBe("#6481b8ad");
    const light = textPreviewTheme(LIGHT, "light", { fontFamily: "Mono", fontSize: 14 });
    const dark = textPreviewTheme(DARK, "dark", { fontFamily: "Mono", fontSize: 14 });
    expect(light[".cm-selectionBackground, &.cm-focused .cm-selectionBackground"].backgroundColor).toBe("#7cabecad");
    expect(dark[".cm-selectionBackground, &.cm-focused .cm-selectionBackground"].backgroundColor).toBe("#6481b8ad");
  });

  it("applies the terminal font to the scroller", () => {
    const theme = textPreviewTheme(LIGHT, "light", { fontFamily: "Maple Mono NF", fontSize: 17 });
    expect(theme[".cm-scroller"].fontFamily).toBe("Maple Mono NF");
    expect(theme[".cm-scroller"].fontSize).toBe("17px");
  });
});
