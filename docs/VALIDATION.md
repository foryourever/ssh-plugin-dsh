# 验证记录

验证环境：macOS ARM64，Node.js 22.23.1，2026-11-03。插件版本 1.0.8；上游 0.7.13-beta.1，提交 `93c0c80cabffb08eec8fae4f7cfc0ed657ce8e9b`。

## 已通过

| 范围 | 结果与证据 |
| --- | --- |
| 原项目完整性 | `npm run verify:upstream`：全部 1912 个原文件的 SHA-256 与保留清单一致。两个 Windows 脚本只存在 CRLF/LF 差异。 |
| 官方后端 | 发布归档 SHA-256：`e079df9a96550c4db9a4c783e40af2174d1fcf2997710da274e66ca006344507`；提取的 ARM64 后端 SHA-256：`eac95e40fee45e9db545d82efcb505d4f8462ffd8166b93360381f528b4c10f6`。 |
| 原版协议 | 真实后端完成 `plugin/initialize`，返回协议 1；`mcp/tools` 实际返回全部 16 个工具。 |
| Harness Schema | 使用本机已安装 Harness 的真实 `assertObjectJsonSchema` / `assertSupportedJsonSchema`，16 个注册定义全部通过。 |
| Host 测试 | `npm run check`：33 项通过，覆盖真实 Cordis 激活、HTTP RPC 信封校验与取消信号、分帧、UTF-8、多请求关联、二进制、反向用户输入、畸形及超长帧、进程退出、取消、超时、重启、加密存储、篡改拒绝、工具参数和注册资源释放。 |
| 真实 Harness 服务 | `npm run check:harness`：使用本机 Harness 0.2.0-rc.2 的真实 Connection、WebServer、ToolRuntime、SystemPrompt 和 Cordis；临时凭据存储、随机回环端口。确认插件 ACTIVE、16 个工具注册、真实 cookie 认证 HTTP 调用、未认证 401、跨源 403，以及卸载后工具和路由清理。 |
| 真实 SSH/SFTP | 临时回环 SSH 服务端，临时 RSA 主机密钥与测试密码；真实 Rust 客户端执行命令、读取文件、写入并读取中文内容；只读连接写入被拒绝。服务端仅返回测试响应，未执行任意 shell 输入，未连接真实服务器。 |
| 完整前端构建 | 约 24.75 MiB 的原生懒加载客户端，内置 Vue、全部工作台模块、CSS、字体/资源及 MP4v/PPTX worker；构建脚本拒绝遗漏的外部资源。React 来自宿主。 |
| 前端类型 | 完整 `vue-tsc --noEmit` 通过。 |
| 安装归档 | 自定义 npm 兼容 `.tgz` 含完整原版 1912 个文件；在独立临时安装目录执行真实 npm 安装，后端可启动并返回 16 个工具。npm 将三个 `.gitignore` 改名为 `.npmignore`，校验脚本兼容该改名并核对原字节。 |
| 前端测试 | 12 个针对性测试文件，69 项通过；包括经真实 Cordis 激活生成后的客户端工厂、注册 `main` / `sidebar.panellist` 槽位、实际挂载 Vue 服务器管理表单、终端输入队列、工作台关闭、桥接及嵌入布局提示框定位。没有 iframe。 |

## 1.0.1 启动修复

本机 Harness 0.2.0-rc.2 使用 `@deepseek-ai/cordis` 4.0.5。其 `inject` 对象的每个键都是服务名，不支持 `{ required: [...], optional: [...] }` 分组。1.0.0 的两处声明会被解释为依赖名为 `required`、`optional` 的服务，导致 `pending (waiting for services: required, optional)`，尚未执行 SSH 初始化。

1.0.1 将宿主与客户端的依赖声明改为真实服务名数组；可选 AI 与工作区服务通过 `ctx.get()` 读取，避免缺少这些服务阻止基础 SSH 功能。新增测试使用真实 Cordis 容器加载宿主插件，分别验证 AI 服务存在和不存在时均达到 ACTIVE、注册 16 个工具并正确释放资源；客户端测试也经真实 Cordis 加载编译产物。此前直接调用 `apply()` 的测试没有覆盖这次依赖声明错误。

## 1.0.2 HTTP 注册修复

1.0.1 的 Cordis 测试仍使用模拟 Connection 服务，因此未覆盖实际 `connection.rpc.handle()` 注册自定义通道时的 `webServer` 依赖错误。已用真实 Harness 服务复现；仅给 SSH 插件增加 `webServer` 依赖也不能解决，因为检查发生在 Connection 的服务上下文。

1.0.2 改用 `connection.fetch.register()` 在共享 `/api` 上注册四个精确 POST 路由，客户端同步使用 `ssh-plugin/*` 方法。Connection 继续负责 Host/Origin 检查、浏览器认证、请求体上限和断开取消，适配器校验 RPC 信封并保留关联 ID 和错误格式；无需修改 Harness 或绕过其安全检查。新脚本 `scripts/verify-harness-host.mjs` 使用真实宿主服务验证激活及 HTTP 调用，不依赖 Connection/WebServer 的模拟实现。

## 桌面版侧栏入口检查（2026-11-03）

在实际运行的 Desktop `0.2.1-rc.5` 中观察到：本地链接的 SSH 1.0.2 后端组件为“运行中”，当前页面 `window.__DSH_BOOT__.entries` 却没有 SSH 条目；控制台 `/plugins/events` 请求失败。完整页面刷新后，启动清单仍无 SSH。静态检查桌面应用 ASAR 中的 `lib/main.js` 确认：桌面进程在 `host.start()` 时保存 `ready.injections`，页面刷新沿用这份启动注入。因此此状态需要完整退出并重新启动桌面应用，以重新生成前端清单。已核对 SSH 的 `main`、`sidebar.panellist` 注册方式与随包内置插件一致；当时未重启用户应用，后续启动结果见 1.0.3 修复记录。

## 1.0.3 浏览器启动修复

实际桌面重启后，前端清单已包含 SSH，但导入报 `process is not defined`。此前的 Node / happy-dom 测试保留了 Node 全局变量，掩盖了这个问题。原因是 Vite 的 library 构建模式默认保留 Vue 等依赖中的 `process.env.NODE_ENV`。构建脚本现显式将其替换为 `"production"`，无需向 Harness 注入 Node 全局变量。

客户端回归测试在生成产物的闭包内屏蔽 `process`、`Buffer` 和 `global`，修复前重现失败，修复后通过模块导入、Cordis 激活、侧栏注册、服务器管理页面挂载及添加服务器表单检查。

实际 GUI 复查：修复构建完成后，运行中的 Harness 已显示左侧 **SSH** 入口及“添加服务器”表单（主机、端口、用户名和私钥认证字段）。未修改用户正在填写的内容，未保存或连接远端服务器。

## 1.0.4 连接表单、会话与布局修复

- 创建与编辑表单读取上游 manifest 的字段翻译，覆盖中文标签、说明和下拉选项；保留原协议值。修正布尔值与 manifest 字符串条件的比较，高级选项可正常展开。
- 私钥路径旁增加系统文件选择器，支持无扩展名的 OpenSSH、PEM、PPK 文件。导入内容写入 secret slot，清空旧路径；取消不改表单，错误文件和超过 1 MiB 的文件给出中文提示。保存沿用凭据加密存储。
- 返回服务器列表后再次选择同一连接复用工作台；切换 Harness 侧栏时保留 Vue 工作台及终端缓冲区。显式断开、切换其他连接和插件卸载仍关闭原工作台。隐藏工作台停放在隐藏容器中，保持主题与桥接根节点可用；其捕获事件不干扰其他页面。
- CSS 隔离使用选择器语法树，只转换真正的 `html`、`body`、`:root` 与 `#app`，避免把 `.sftp-body` 等类名误改。文件工具栏禁止 flex 压缩，允许完整换行，主工具栏也随可用空间换行。

新增 DOM 回归验证中文选项、布尔条件、私钥导入与清空旧路径、取消与错误恢复、同一连接复用、切换连接及显式关闭；生成产物经真实 Cordis 验证侧栏页面离开与返回复用同一 DOM，插件卸载清理桥接与隐藏容器。

浏览器视觉检查使用本机隔离预览与模拟 RPC，无真实服务器凭据：标准 1280×850 和窄窗口表单；系统文件选择器成功导入无扩展名测试私钥；文件面板缩至 255 像素时工具栏高 87 像素，其底边与文件区顶边均为 167 像素，无重叠。该预览只验证界面和桥接，不作为真实远端认证验收。

## 1.0.5 图标与监控图表颜色修复

Harness 使用独立入口，未执行原版 `main.ts` 中的 `installHostThemeBridge()`，导致 `--info`、`--success`、`--warning` 等变量缺失；这些变量同时控制工具栏、状态指示、CPU/内存/磁盘仪表盘及曲线。适配入口现将原版主题桥生成的 CSS 限定到 `#dsh-ssh-root` 后一同装载，补回完整的主题变量及遮罩。宿主外观桥同时解析并写入对应的 `--color-*` 令牌，优先使用宿主颜色，缺失时使用上游亮暗色默认值；主题切换会重新解析，避免变量别名循环及颜色停留在旧主题。

构建 CSS 插入点改为表达式，防止压缩器合并相邻字符串后遗漏 CSS。生成产物的测试覆盖实际 CSS 装载、语义色与遮罩解析，以及宿主根节点不受影响；桥接测试覆盖默认颜色、切换暗色与宿主自定义颜色。原监控组件的 6 项测试同时通过。

隔离浏览器使用模拟监控数据验证：亮色 CPU/内存/磁盘仪表盘 stroke 分别为 `rgb(37,99,235)` / `rgb(22,163,74)` / `rgb(217,119,6)`；切换暗色后分别为 `rgb(96,165,250)` / `rgb(74,222,128)` / `rgb(251,191,36)`，趋势面积与网络紫色曲线正常显示。验证未连接用户真实服务器。

## 1.0.6 工具栏提示框定位修复

Harness 根节点的 `contain: layout style` 为 fixed 提示框建立了包含块，而原版使用视口坐标，导致侧栏与顶部栏的偏移被重复叠加。定位现将图标的视口坐标转换为 SSH 容器坐标，并按容器宽高钳位、翻转；独立运行时保留视口坐标回退。提示框最大宽度跟随容器，窗口缩放时收起；宿主区域及隐藏工作台不接管 title。

新增 4 项几何回归覆盖侧栏与顶部栏偏移、侧栏宽度变化、左右边缘钳位和底部翻转。完整类型检查及 9 个针对性测试文件的 45 项测试通过。隔离浏览器以实际构建产物、模拟 RPC 验证 280 像素侧栏及 52 像素顶部栏布局：「端口映射」按钮中心与提示框中心均为视口 x=870，提示框顶边位于按钮底边下方 6 像素；右侧「SFTP 传输任务」提示框距容器右边缘至少 8 像素。键盘聚焦正常显示，缩放后提示框收起，宿主按钮 title 保留。未连接真实远端服务器。

## 1.0.7 Agent 工具参数校验修复

新增 Agent 入口回归后，修复前真实后端测试和已注册工具测试均复现截图中的 `requires a saved connectionId/connectionName or an inline host and username`。根因是上游 `mcp.rs` 工具定义生成器无条件为所有工具插入单连接 `anyOf`，适配层又在执行前严格校验该定义。

适配层仅移除 `ssh_list_connections`、`ssh_list_known_hosts`、`ssh_remove_known_host` 和 `ssh_multi_exec` 不适用的顶层选择条件，不修改原始源码及工具快照。修复后 33 项测试通过：实际注册的两个列表工具接受空对象，删除指纹仅需主机参数；经 Agent 包装器和真实 Rust 后端列出空列表、已保存连接，并执行回环多目标命令。缺失必填字段、无连接的单目标命令/SFTP、空目标或超过 10 个目标仍被拒绝；列表未泄露测试密码。`check:harness` 的真实宿主激活、16 个工具、HTTP 认证与卸载清理检查通过。未重载用户运行中的插件或连接会话。

## 1.0.8 多会话与工作台隔离

- 顶部标签支持同时连接不同服务器，也支持同一服务器打开多个独立终端；切换标签保留各自的终端缓冲区、文件面板及工作台状态。关闭标签只释放该工作台，最后一个同服务器工作台关闭时才清理连接级资源。
- 工作台上下文、标题、关闭回调、OTP、端口映射、主题变量及弹出层目标按会话隔离；文件拖放和全局快捷键只交给当前工作台。后台弹窗不抢占当前会话焦点；标签支持方向键、Home、End 切换。
- `npm run check` 33 项通过，原项目 1912 文件 SHA-256 校验通过；`npm run check:harness` 通过；完整 `vue-tsc --noEmit` 通过；12 个针对性前端测试文件的 69 项测试通过。新增测试覆盖多服务器、同服务器独立工作台、关闭隔离、创建失败保留原会话、拖放路由和工具栏复制/新建会话参数。
- 真实 Rust 后端与临时回环 SSH 服务建立两个独立 PTY 终端，确认会话 ID 不同；关闭第一个后，第二个仍处于连接状态，随后正常关闭。测试不使用用户服务器或凭据。
- 使用最终构建产物与模拟 RPC，在 1280×850 和 424×850 浏览器窗口验证三个标签（同服务器两个、另一服务器一个）、切换和 SFTP 面板状态保留。该结果属于界面与桥接验收，未在用户真实远程服务器上完成多服务器端到端验收。Impeccable 检测器下载未完成，未运行自动设计检测。
- 新增根目录 `AGENTS.md`，要求 Git 提交标题与正文使用中文，并约定类型前缀、提交范围和验证要求。此次没有修改 `original/`。

## 可重复执行

从项目根目录运行：

```bash
npm run check
npm run check:harness
node --check client.js
npm --prefix frontend run typecheck
npm --prefix frontend test -- src/lib/tooltipPosition.spec.ts src/HarnessApp.spec.ts src/harnessRuntime.spec.mts src/harnessBridge.spec.ts src/style.spec.ts src/lib/terminalInputQueue.spec.ts src/lib/workbenchCloseSessions.spec.ts src/lib/themeSync.spec.ts src/components/MetricsPanel.spec.ts src/components/PortForwardDialog.spec.ts src/components/OtpPanel.spec.ts src/lib/workbenchUiMirror.spec.ts
npm run pack:bundle
```

重新构建客户端：

```bash
npm run build
```

真实 SSH 集成测试在当前 macOS ARM64 后端上执行。其他平台的脚本和发布资产已提供，未进行跨平台运行验收。测试临时数据与用户连接配置隔离；DBX 应用桥也被重定向至独立目录，避免读取现有 DBX 连接。

## 明确未验证

- 未更改当前 Harness profile 或重启用户的远端会话；1.0.4 的视觉验收使用隔离的浏览器预览，尚未在用户现有真实连接上逐项验收。
- 没有真实服务器上的密码、私钥、SSH Agent、多跳、TOTP、sudo、GPU/NPU、Docker、Telnet、串口、VNC 或实验性 RDP 逐项环境验收；这些原版实现及界面均保留。
- 没有重新编译 Rust 后端：本机没有 Cargo，使用与源码版本一致的官方校验二进制。
- 文件预览资源已打包，但未逐一用所有文档和媒体格式验证。浏览器文件操作使用 File API / Blob 下载，受浏览器权限和内存限制，不提供 DBX 桌面原生的任意本机路径语义或流式落盘。
- 新插件的安装结果应通过 `plugin_manager` 返回的 `application` 和 `warnings` 判定。安装成功后仍应核对侧栏、工具清单及服务器认证弹窗。

## 运行行为

原 SDK 没有逐请求取消。取消、超时或删除服务器会停止整个后端，活动会话随之结束；已被远端接受的操作不能由适配器回滚。下次调用会重新初始化。此行为在测试与中文说明中明确保留。

原项目完整保存在 [original](../original/README.md)，适配实现与之分开；[来源清单](../UPSTREAM.json)、[发布锁](../upstream-release-lock.json)及[第三方许可](../THIRD_PARTY_NPM.json)可用于复核。
