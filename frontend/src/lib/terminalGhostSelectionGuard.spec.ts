import { describe, expect, it } from "vitest";
import { createGhostSelectionGuard } from "./terminalGhostSelectionGuard";

describe("createGhostSelectionGuard (#220)", () => {
  it("does not touch selections during a real drag (buttons held)", () => {
    let cleared = 0;
    const guard = createGhostSelectionGuard({ clearSelection: () => { cleared += 1; } });
    guard.onMouseDown();
    expect(guard.onMouseMove({ buttons: 1, selection: "abc" })).toBe("idle");
    expect(guard.onMouseMove({ buttons: 1, selection: "abcdef" })).toBe("idle");
    guard.onMouseUp();
    expect(cleared).toBe(0);
  });

  it("keeps a completed selection while the mouse moves without buttons", () => {
    let cleared = 0;
    const guard = createGhostSelectionGuard({ clearSelection: () => { cleared += 1; } });
    guard.onMouseDown();
    guard.onMouseUp();
    let ts = 0;
    const ticking = createGhostSelectionGuard({
      clearSelection: () => { cleared += 1; },
      now: () => { ts += 100; return ts; },
    });
    ticking.onMouseDown();
    ticking.onMouseUp();
    // 完成后的合法选区：无按键移动下串不变，永不误清。
    for (let i = 0; i < 6; i += 1) {
      expect(ticking.onMouseMove({ buttons: 0, selection: "stable" })).toBe("tracking");
    }
    expect(cleared).toBe(0);
    expect(guard.onMouseMove({ buttons: 0, selection: "stable" })).toBe("tracking");
  });

  it("clears once when the selection keeps growing during buttonless movement", () => {
    let cleared = 0;
    let ts = 0;
    const guard = createGhostSelectionGuard({
      clearSelection: () => { cleared += 1; },
      now: () => { ts += 50; return ts; },
    });
    guard.onMouseDown();
    guard.onMouseUp();
    // mouseup 被吞（触摸板轻点/IME 候选窗），xterm 保持武装：无按键移动下
    // 选区持续扩展 → 第二拍判定幽灵并清一次，随后复位不重复清。
    expect(guard.onMouseMove({ buttons: 0, selection: "a" })).toBe("tracking");
    expect(guard.onMouseMove({ buttons: 0, selection: "ab" })).toBe("cleared");
    expect(cleared).toBe(1);
    expect(guard.onMouseMove({ buttons: 0, selection: "abc" })).toBe("tracking");
    expect(guard.onMouseMove({ buttons: 0, selection: "abcd" })).toBe("cleared");
    expect(cleared).toBe(2);
  });

  it("resets on mousedown and ignores empty selections", () => {
    let cleared = 0;
    let ts = 0;
    const guard = createGhostSelectionGuard({
      clearSelection: () => { cleared += 1; },
      now: () => { ts += 50; return ts; },
    });
    guard.onMouseMove({ buttons: 0, selection: null });
    guard.onMouseDown();
    expect(guard.onMouseMove({ buttons: 1, selection: "x" })).toBe("idle");
    guard.onMouseUp();
    expect(guard.onMouseMove({ buttons: 0, selection: "x" })).toBe("tracking");
    expect(cleared).toBe(0);
  });
});
