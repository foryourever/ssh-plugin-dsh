// TextPreview（CodeMirror 预览）的主题构造。纯数据、零框架依赖——抽出来是
// 为了让 vitest 能直接锁住下面的透明度契约（issue #214）。
//
// #214 根因：drawSelection 的选区层是 above:false（z-index -1，画在文本内容
// 之下），而 `.cm-line` 自身的背景色画在它上面。`.cm-activeLine` 若使用
// 不透明背景色（宿主 appearance 的 accent 是 rgb(245 245 245)/rgb(46 47 51)
// 这类实色），光标所在行——多行拉选的起始行、双击选中词所在行——的选区
// 会被整行盖住，表现为「选中的那一行没有高亮」。因此 activeLine 必须半透
// 明（color-mix 掺 transparent），选区色才能透过混合显现。selectionBackground
// 本身保持 #155 定下的 0xad 透明度观感。

export interface TextPreviewPalette {
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  border: string;
}

export interface TextPreviewTerminalFont {
  fontFamily: string;
  fontSize: number;
}

export interface TextPreviewThemeColors {
  /** 选区背景（明/暗两套，#155 加深后的观感）。 */
  selectionBackground: string;
}

/** activeLine 透明度：既保住「当前行」的可辨识度，又能让 z=-1 的选区层透出。 */
export const ACTIVE_LINE_ALPHA_PERCENT = 60;

export function textPreviewSelectionColors(colorScheme: "light" | "dark"): TextPreviewThemeColors {
  return {
    selectionBackground: colorScheme === "dark" ? "#6481b8ad" : "#7cabecad",
  };
}

/** 生成 EditorView.theme() 的样式对象（组件侧再包一层 EditorView.theme）。 */
export function textPreviewTheme(
  colors: TextPreviewPalette,
  colorScheme: "light" | "dark",
  font: TextPreviewTerminalFont,
): Record<string, Record<string, string>> {
  const { selectionBackground } = textPreviewSelectionColors(colorScheme);
  return {
    "&": { height: "100%", backgroundColor: colors.background, color: colors.foreground },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: font.fontFamily,
      fontSize: `${font.fontSize}px`,
    },
    ".cm-gutters": { backgroundColor: colors.muted, color: colors.mutedForeground, borderRightColor: colors.border },
    // 半透明契约见文件头注释：实色会盖住选区层的选区（issue #214）。
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: `color-mix(in srgb, ${colors.accent} ${ACTIVE_LINE_ALPHA_PERCENT}%, transparent)`,
    },
    // 选区色随明暗切换，与终端 xterm selectionBackground 保持同一观感。
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: selectionBackground,
    },
  };
}
