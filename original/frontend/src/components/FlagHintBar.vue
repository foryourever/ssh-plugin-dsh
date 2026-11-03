<script setup lang="ts">
// 命令参数即时提示条（issue #224 第 1 条）：键入 -X/--flag 时浮在光标行上方
// 的单行 hint——「flag 释义（出处）」。零按键纯展示（设计稿裁决）：不出候选、
// 不接管 Tab/Enter/↑↓/Esc，整条对指针透明、无任何交互面；浮层在场/运行中
// 让位逻辑在 App 的 shouldShowFlagHint 门，这里只管渲染与放置。
// 定位复用 TerminalPromptHints 同一坐标系（底边贴光标行顶、近顶翻下方、
// 锚点不可测贴终端底部）与主题令牌。
import { computed, ref } from "vue";
import { workbenchMessage } from "../lib/i18n";
import { flippedOverlayBottom, overlayBelowTop, type SuggestionAnchor } from "../lib/overlayPlacement";
import { choosePromptHintsPlacement, PROMPT_HINTS_FALLBACK_BAR_HEIGHT } from "../lib/terminalPromptHints";

interface Props {
  locale: string;
  /** 触发的 flag 原文（-X / --xxx）。 */
  flag: string;
  /** 释义（lib/flagHints 语料英文短句）。 */
  description: string;
  /** 命中的命令名。 */
  command: string;
  /** 语料出处（title 提示可查，设计稿风险 1 缓解）。 */
  source: string;
  /** 光标格像素坐标（y 为光标行顶）；null = 定位不可用，贴终端底部。 */
  anchor: SuggestionAnchor | null;
  /** 定位包含块实测高度（terminal-pane）；缺省时走 fallback。 */
  viewport?: { height: number };
}

const props = defineProps<Props>();
const t = (key: string) => workbenchMessage(props.locale, key);
const rootEl = ref<HTMLElement | null>(null);
const style = computed(() => {
  const anchor = props.anchor;
  if (!anchor) return undefined;
  const containerHeight = rootEl.value?.parentElement?.clientHeight || props.viewport?.height || 0;
  if (!(containerHeight > 0)) return undefined;
  const barHeight = rootEl.value?.offsetHeight || PROMPT_HINTS_FALLBACK_BAR_HEIGHT;
  if (choosePromptHintsPlacement(anchor.y, containerHeight, barHeight) === "below") {
    return { left: `${anchor.x}px`, top: `${overlayBelowTop(anchor.y, anchor.cellHeight ?? 0)}px`, bottom: "auto" };
  }
  return { left: `${anchor.x}px`, bottom: `${flippedOverlayBottom(anchor.y, containerHeight)}px` };
});
</script>

<template>
  <div
    ref="rootEl"
    class="terminal-flag-hint"
    :class="{ 'anchor-fallback': anchor === null }"
    :style="style"
    role="note"
    :title="`${command} — ${t('flagHint.sourcePrefix')} ${source}`"
    :aria-label="`${flag}: ${description}`"
  >
    <kbd>{{ flag }}</kbd>
    <span class="terminal-flag-hint-text">{{ description }}</span>
  </div>
</template>

<style scoped>
.terminal-flag-hint {
  position: absolute;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 16px);
  border: 1px solid var(--border, rgb(128 128 132 / 28%));
  border-radius: var(--radius);
  background: var(--popover);
  color: var(--muted-foreground);
  padding: 3px 8px;
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  /* 纯展示（设计稿硬约束 2）：不接管指针/键盘，无任何交互面。 */
  pointer-events: none;
}

.terminal-flag-hint.anchor-fallback {
  right: auto;
  bottom: 12px;
  left: 8px;
}

.terminal-flag-hint kbd {
  display: inline-grid;
  min-width: 16px;
  place-items: center;
  border: 1px solid var(--border, rgb(128 128 132 / 28%));
  border-radius: 4px;
  padding: 0 4px;
  background: var(--muted, rgb(255 255 255 / 6%));
  color: inherit;
  font-family: var(--ui-font-family);
  font-size: 9.5px;
  line-height: 15px;
}

.terminal-flag-hint-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
