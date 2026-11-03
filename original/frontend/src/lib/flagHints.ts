// 命令参数（-X/--flag）即时提示（issue #224 第 1 条，设计稿
// docs/plans/2026-10-22-flag-hints-design.md 的缩小版 v1）：光标所在（v1 即
// 行尾）token 形如 -X / --xxx 且行首命令命中语料时，在光标行上方浮一条
// 单行 hint 条显示释义。零按键——不出候选列表、不接管 Tab/Enter/↑↓/Esc，
// 与 ghost/建议/补全/历史面板天然无键权冲突；这些浮层任一开启时 hint 让位。
// 纯函数零 Vue 依赖：语料、解析、显隐门都在这里，渲染与锚点采样在 App.vue。

import { pluginStore } from "./pluginStore";

const FLAG_HINT_ENABLED_STORE = "ssh-terminal-flag-hints-enabled";

/** 设置开关（命令建议分栏）：默认开；关闭即彻底不弹。 */
export function loadFlagHintEnabled(): boolean {
  try {
    return pluginStore.getItem(FLAG_HINT_ENABLED_STORE) !== "0";
  } catch {
    return true;
  }
}

export function saveFlagHintEnabled(value: boolean) {
  try {
    pluginStore.setItem(FLAG_HINT_ENABLED_STORE, value ? "1" : "0");
  } catch {
    // 持久化失败不阻断：本次会话内存态仍生效。
  }
}

/** 单条 flag 释义：一句话、行为导向、不带评价（设计稿文案策略）。 */
export interface FlagHint {
  /** 触发的 flag 原文（-X 或 --xxx）。 */
  flag: string;
  /** 释义文案（本地化语料语言与 hint 条 UI 语言一致：英文短句）。 */
  description: string;
  /** 命中的命令名。 */
  command: string;
}

/** 语料条目：flags 键含短长两式（"X" 对应 -X；"--force" 对应 --force）。 */
export interface FlagHintEntry {
  flags: Record<string, string>;
  /** 释义出处标注版本（hint 条 title 提示可查，设计稿风险 1 缓解）。 */
  source: string;
}

/**
 * v1 语料：仅 4 命令（git/docker/kubectl/systemctl）。准确性责任重——错误
 * 释义比没有更糟；扩展走 PR 审核制（设计稿裁决）。短式键为裸字母（渲染时
 * 前缀 "-"），长式键含 "--"。
 */
export const FLAG_HINTS: Record<string, FlagHintEntry> = {
  git: {
    source: "git v2.44 man page",
    flags: {
      C: "run as if git was started in <path>",
      a: "stage all modified and deleted files before commit",
      b: "create or switch to a new branch",
      d: "delete the branch",
      f: "force the operation to run",
      m: "use the given message as the commit message",
      v: "show more details in the output",
      "--amend": "replace the tip of the current branch by a new commit",
      "--all": "commit all tracked modified files (add untracked with -A first)",
      "--author": "override the commit author",
      "--branch": "create or switch to a new branch",
      "--delete": "delete the branch",
      "--force": "force the operation to run",
      "--force-with-lease": "force only if the remote branch is where you last fetched it",
      "--hard": "reset the index and working tree; uncommitted changes are lost",
      "--message": "use the given message as the commit message",
      "--no-verify": "skip pre-commit and commit-msg hooks",
      "--prune": "remove remote-tracking references that no longer exist on the remote",
      "--set-upstream": "set the remote branch this one tracks",
      "--squash": "combine with the target commit instead of creating a merge commit",
      "--verbose": "show more details in the output",
    },
  },
  docker: {
    source: "docker v26 CLI reference",
    flags: {
      H: "socket(s) to connect to",
      f: "force removal; compose down removes named volumes declared in the service",
      q: "only display numeric IDs",
      "--build": "build the image before starting containers",
      "--detach": "run the container in the background and print the container ID",
      "--env": "set an environment variable in the container",
      "--force": "force removal of a running container",
      "--interactive": "keep STDIN open even if not attached",
      "-it": "shorthand pair: keep STDIN open and allocate a pseudo-TTY",
      "--name": "assign a name to the container",
      "--ports": "publish all exposed ports to random host ports",
      "--prune": "remove stopped containers / unused data (per subcommand)",
      "--publish": "publish a container port to the host (host:container)",
      "--rm": "remove the container automatically when it exits",
      "--tty": "allocate a pseudo-TTY",
      "--volume": "bind-mount a volume or host path into the container",
      "--volumes": "remove named volumes declared in the service (compose down)",
    },
  },
  kubectl: {
    source: "kubectl v1.30 reference",
    flags: {
      f: "resource file to apply (-f can repeat)",
      n: "namespace scope for this request",
      o: "output format (json|yaml|wide|…)",
      w: "watch for changes to the requested object(s)",
      "--all": "select all resources in the namespace",
      "--context": "kubeconfig context to use for this request",
      "--delete": "delete resources from a file or stdin (apply)",
      "--dry-run": "preview without persisting (none|server|client)",
      "--follow": "follow the log stream (logs)",
      "--force": "immediate, graceful=false deletion",
      "--kubeconfig": "path to the kubeconfig file to use",
      "--namespace": "namespace scope for this request",
      "--output": "output format (json|yaml|wide|…)",
      "--previous": "print the previous terminated container's logs",
      "--prune": "delete resources removed from the applied manifests",
      "--recursive": "process the directory used in -f recursively",
      "--watch": "watch for changes to the requested object(s)",
    },
  },
  systemctl: {
    source: "systemd v255 man page",
    flags: {
      f: "when copying, overwrite existing files (enable)",
      l: "do not ellipsize unit names / output",
      n: "number of journal lines to show",
      "--enable": "start the unit now and at boot",
      "--failed": "list units in failed state",
      "--force": "when copying, overwrite existing files (enable)",
      "--full": "do not ellipsize unit names / output",
      "--global": "enable/disable unit files for all users",
      "--lines": "number of journal lines to show",
      "--no-block": "do not synchronously wait for the requested operation",
      "--no-pager": "do not pipe output into a pager",
      "--now": "start/stop/enable/disable the unit immediately",
      "--quiet": "suppress output",
      "--restart": "restart the unit (with enable)",
      "--runtime": "enable a unit only until next reboot",
      "--state": "list units in the given state",
      "--type": "filter units by type (service|socket|timer|…)",
      "--user": "talk to the user service manager instead of the system one",
    },
  },
};

/** 行首命令名（跳过 env 前缀/sudo，v1 不做别名）。 */
function extractLeadingCommand(line: string): string | null {
  const tokens = line.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length && i < 4; i += 1) {
    const token = tokens[i];
    // env VAR=... 前缀跳过；sudo/-sudo/sudo=opt 跳过（sudo 选项与命令名
    // 连写罕见，v1 认主路径）。
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    if (token === "sudo" || /^-?sudo[^\s]*=/.test(token)) continue;
    return token;
  }
  return null;
}

/** 光标前（v1 行尾）的最后一个 token：含 - 开头 flag 的原文。 */
export function trailingFlagToken(line: string): string | null {
  const match = /(?:^|\s)(-[^\s]+)$/.exec(line);
  return match ? match[1] : null;
}

/**
 * 解析当前输入的 flag hint。命中条件（设计稿裁决的行尾语义）：
 * 1. 行首第一个词（跳过 env/sudo 前缀）命中 FLAG_HINTS；
 * 2. 行尾 token 以 `-` 开头（短式 -X 或长式 --xxx；`--x=y` 归一到 `--x`）；
 * 3. 查表命中——短式查裸字母键、长式查含 "--" 键。
 * 任一不成立返回 null（hint 条不显示）。`-` 单独敲下（还没打字母）不提示。
 */
export function resolveFlagHint(line: string): FlagHint | null {
  const command = extractLeadingCommand(line);
  if (!command) return null;
  const entry = FLAG_HINTS[command];
  if (!entry) return null;
  const token = trailingFlagToken(line);
  if (!token) return null;
  let key: string | null = null;
  if (token.startsWith("--")) {
    const body = token.slice(2).split("=")[0];
    if (body) key = `--${body}`;
  } else if (token.length >= 2) {
    // 短式：先试单字母（-abc 键入中按首字母提示）；再试组合短式全键
    //（-it 这类语料显式登记的组合，单字母查不到时整键命中）。
    const first = token.slice(1, 2);
    if (entry.flags[first]) key = first;
    else if (entry.flags[token]) key = token;
  }
  if (!key) return null;
  const description = entry.flags[key];
  if (!description) return null;
  return { flag: key, description, command };
}

/** hint 条显隐门（纯函数供单测）：所有浮层/执行态任一在场即让位。 */
export interface FlagHintGates {
  enabled: boolean;
  /** 解析命中（resolveFlagHint 非 null）。 */
  hint: boolean;
  /** xterm alternate buffer（vim/tmux 整屏接管）。 */
  alternateActive: boolean;
  /** 远端命令执行中。 */
  commandRunning: boolean;
  /** zmodem/trzsz 传输占用输入流。 */
  transferBusy: boolean;
  /** 任一既有浮层开启（ghost/建议/补全/history 面板/quick-select/搜索/# 搜索）。 */
  overlayOpen: boolean;
}

export function shouldShowFlagHint(gates: FlagHintGates): boolean {
  return (
    gates.enabled &&
    gates.hint &&
    !gates.alternateActive &&
    !gates.commandRunning &&
    !gates.transferBusy &&
    !gates.overlayOpen
  );
}
