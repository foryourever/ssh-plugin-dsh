// 触摸板幽灵拖选守卫（issue #220）。
//
// 上游事实：xterm 6.1.0-beta.304 的 SelectionService._handleMouseMove 在
// mousedown 武装后消费整个 document 的 mousemove，且从不检查 event.buttons
// ——mouseup 被第三方吞掉（macOS 触摸板轻点手势、IME 候选窗抢焦点）后，
// 之后任何鼠标移动都会持续扩展选区，直到 Esc/回车，表现为「没按键只移动
// 鼠标就出现大片选区」。
//
// 守卫状态机（纯逻辑，DOM 接线在调用方）：真实拖选期间（buttons!==0 或按
// 键按下中）不干预；无按键移动时对选区串采样，连续两拍（400ms 窗口内）选
// 区串仍在变化 = 幽灵拖选进行中，调用方执行一次 clearSelection 后复位。
// 完成的合法选区（复制用）在无按键移动下串不变，永不误清。

export interface GhostSelectionSample {
  selection: string;
  ts: number;
}

export type GhostSelectionGuardVerdict = "idle" | "tracking" | "cleared";

/** 幽灵拖选判定窗口：两拍按钮为零的移动在此间隔内且选区串变化即判幽灵。 */
export const GHOST_SELECTION_WINDOW_MS = 400;

export interface GhostSelectionGuardOptions {
  clearSelection: () => void;
  now?: () => number;
}

export interface GhostSelectionGuardInput {
  /** mousemove 事件的 event.buttons（0 = 无按键）。 */
  buttons: number;
  /** terminal.hasSelection() ? terminal.getSelection() : null。 */
  selection: string | null;
}

export interface GhostSelectionGuard {
  onMouseDown(): void;
  onMouseUp(): void;
  onMouseMove(input: GhostSelectionGuardInput): GhostSelectionGuardVerdict;
  reset(): void;
}

export function createGhostSelectionGuard(options: GhostSelectionGuardOptions): GhostSelectionGuard {
  const now = options.now ?? (() => Date.now());
  let buttonDown = false;
  let sample: GhostSelectionSample | null = null;

  const resetSample = () => {
    sample = null;
  };

  return {
    onMouseDown() {
      buttonDown = true;
      resetSample();
    },
    onMouseUp() {
      buttonDown = false;
      resetSample();
    },
    reset() {
      buttonDown = false;
      resetSample();
    },
    onMouseMove({ buttons, selection }: GhostSelectionGuardInput): GhostSelectionGuardVerdict {
      // 真实拖选中（按键按着）：xterm 自管，采样复位。
      if (buttons !== 0 || buttonDown) {
        resetSample();
        return "idle";
      }
      // 无选区无从扩展。
      if (selection == null) {
        resetSample();
        return "idle";
      }
      const ts = now();
      // 两拍判定：窗口内无按键移动且选区串在变 = xterm 武装态吞了 mouseup。
      if (sample && sample.selection !== selection && ts - sample.ts <= GHOST_SELECTION_WINDOW_MS) {
        resetSample();
        options.clearSelection();
        return "cleared";
      }
      sample = { selection, ts };
      return "tracking";
    },
  };
}
