# 设计稿：命令参数（-X/--flag）即时提示（issue #224 第 1 条）

状态：设计完成，未实施。本文回答「怎么做、先做什么、不做什么」。

## 裁决：修改后做（缩小版 v1）

按原始草案直接做全量语料 + 浮层联动，会在数据维护与按键冲突上各埋一颗雷。
收窄后的 v1 保留体验核心（输入 flag 即见释义），砍掉两个高风险面。

## 与原草案的差异

| 维度 | 原草案 | v1 裁决 | 理由 |
| --- | --- | --- | --- |
| 语料范围 | 常用命令全量（git/docker/kubectl/ssh/scp/curl/systemctl/journalctl…） | **v1 只带 4 条：git / docker / kubectl / systemctl**，schema 预留扩展 | 语料准确性责任重（错误释义比没有更糟）；先验证交互价值再扩 |
| 触发面 | composer/输入行所有 `-` token | 仅**行尾正在输入的 token**（光标前最近 token 以 `-` 开头且命令名命中语料） | 中途 token 提示会打扰节奏；行尾语义与 ghost/建议一致 |
| 渲染 | 复用 CompletionMenu | **独立单行 hint 条**（复用快捷键引导条 `note "Shortcut hints"` 的样式与锚点机制，不出候选列表） | CompletionMenu 的 Tab/Enter/↑↓ 语义与「纯提示」冲突；hint 条不抢任何按键，零仲裁面 |
| 按键 | 待定 | **零按键**：纯展示，Esc 不需要（随输入变化消失），Tab/Enter 全部让给 shell | 完全绕开与 ghost/补全/历史面板（#216）的按键冲突——原草案最大雷区 |
| 网络/AI | 无 | 无（纯前端离线） | 保持 |

## 架构

- `frontend/src/lib/flagHints.ts`：纯函数。
  - 语料常量 `FLAG_HINTS`：`{ [command: string]: { flags: Record<string, string>; source: string } }`；flag 键含短长两式（`"X"` / `"--force"`）。
  - `resolveFlagHint(input: string, cursorLine: string): { flag: string; description: string; command: string } | null`：
    1. 行首第一个词（跳过 env 前缀/sudo）命中语料命令（别名表：g=git 等，v1 不做别名）；
    2. 取光标所在（v1 即行尾）token，形如 `-X` 或 `--xxx`；
    3. 查表返回释义；查不到返回 null。
  - 展示节流与消隐：输入变化即重算（纯字符串查表，成本可忽略）。
- App.vue 接线：`onData`/`lineChanged` 链上算 hint → 复用提示符引导条机制渲染（同一锚点体系 readTerminalSuggestionAnchor，不出新浮层栈）。
- 层级仲裁：hint 条与 ghost/建议/补全**互斥显示**——任一候选浮层开启时 hint 让位（沿用 `historyPanelOpen/suggestionOpen/completionOpen` 既有门，参考 ghost 的 `historyPanelOpen` 让位模式）。

## v1 语料 schema 草样

```jsonc
{
  "git": {
    "source": "git v2.44 man page",
    "flags": {
      "-X": "占位（示例）",   // 实际按 man 页写短句
      "--force": "overwrite existing state"
    }
  }
}
```

释义文案策略：**一句话、行为导向、不带评价**，末尾不再附加「详见 man」——
hint 条自带 `source` 注入 title 提示可查。

## 风险清单（按严重度）

1. **释义过时/平台差异**（高）：语料随上游演进漂移。缓解：v1 仅 4 命令 + `source` 字段标注版本；扩展走 PR 审核制。
2. **行解析边角**（中）：`sudo -x git`、`git -c x=y commit --amend` 等前缀/选项穿插，v1 只认「第一个词 + 行尾 token」，覆盖主路径；文档写明边界。
3. **中文输入法组合期误显**（低）：组合中（isComposing/keyCode 229）不重算，提交后再算。
4. **隐藏成本被低估**（中）：「提示常驻视觉噪音」——hint 条淡色单行、1.5s 无变化即淡出（借鉴快捷键引导条的用过即散旗标，可关）。

## 对实施者的硬约束

1. 不新增运行时依赖；语料为 TS 常量（非运行时 fetch JSON）。
2. 不出候选列表、不抢任何按键、不进 overlay 仲裁器键权表（纯 display 层）。
3. 文案七语全补（label/hint/title）。
4. 纯函数 `resolveFlagHint` + 语料命中单测全覆盖后再接线。
5. 不动 sidecar/协议。
