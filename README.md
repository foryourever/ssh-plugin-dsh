# DeepSeek Harness SSH 插件

将 [jinpy666/dbx-plugin-ssh](https://github.com/jinpy666/dbx-plugin-ssh) 适配为 DeepSeek Harness 的原生插件 bundle，让 Agent 调用 SSH/SFTP 工具，并在 Harness 侧栏打开原项目的完整终端工作台。

上游版本 **0.7.13-beta.1**，固定提交 `93c0c80cabffb08eec8fae4f7cfc0ed657ce8e9b`。用户提供的源码 **1912 个文件全部保留**在 [original](original/README.md) 中，包括 Rust 后端、Vue 前端、共享 SDK、第三方 vendor、图标、演示媒体、测试、脚本和原文档。两个 Windows `.cmd` 文件只存在 CRLF/LF 差异；[来源清单](UPSTREAM.json)记录每个原文件的校验值。

## 安装

先克隆本仓库：

```bash
git clone https://github.com/foryourever/ssh-plugin-dsh.git
cd ssh-plugin-dsh
```

本目录已经包含构建好的客户端和经官方发布 SHA-256 校验的 **macOS ARM64** 后端，可直接作为本地 bundle 安装；安装后才会出现在当前 Harness 的侧栏和工具列表中。其他平台先按后文运行 `npm run setup:backend`。

在能够调用 `plugin_manager` 的 Harness 会话中，执行以下请求，将 `target` 替换为克隆目录的绝对路径：

```json
{
  "action": "install_bundle",
  "target": "/absolute/path/to/ssh-plugin-dsh"
}
```

检查安装结果中的 `application` 和 `warnings`。`applied` 表示已应用；`restart-required` 表示需要重启对应 Harness 实例。此项目的构建和测试不会改动用户的 Harness profile，也不会自动安装插件。

**桌面版已启用但侧栏没有 SSH：** 在 DeepSeek Harness Desktop `0.2.1-rc.5` 中，新安装的插件可能已在后端运行，但当前页面仍使用桌面进程启动时的前端清单。请先结束需要保留的运行任务，再用 **⌘Q 完整退出 Harness 并重新打开**；只关闭窗口或刷新页面可能无法更新清单。重新打开后查看左侧 SSH 入口。若仍未出现，再检查前端插件加载错误，勿反复重装。

若完整重启时报 `@local/dsh-plugin-ssh: import failed: process is not defined`，请更新至 **1.0.3**。这是旧客户端构建遗漏浏览器环境替换导致的错误。安装来源为本目录链接时，构建后的修复会直接生效；故障对话框中选择“重启”即可重新加载，无需禁用所有第三方插件。

若安装旧版后出现 `pending (waiting for services: required, optional)` 或 `cannot get property "webServer" without inject`，请重新安装 1.0.2 或更新版本。前者来自 Cordis 依赖声明，后者来自旧版自定义 RPC 通道注册。1.0.2 使用 Harness 公开的 `/api/ssh-plugin/*` 精确 Fetch 路由，并已通过真实宿主服务、浏览器认证和 HTTP 调用验证。

安装后：

1. 点击侧栏 **SSH**。
2. 添加服务器，选择密码、私钥或 SSH Agent 等认证方式。连接表单从原始 manifest 的所有字段生成；高级选项保留跳板机、sudo、TOTP、触发器和协议配置。
3. 连接后进入原项目工作台，使用终端、SFTP、监控、隧道等功能。
4. 在 Harness 会话中直接让 Agent 使用 `ssh_list_connections`，然后通过保存的连接名称或 ID 执行任务。

例如：

> 用 SSH 插件列出服务器，然后连接“测试服务器”，查看磁盘使用率和 Docker 容器状态。

> 将本地配置上传到测试服务器，读取上传后的文件并核对内容。

凭据建议在服务器表单中保存，Agent 使用连接 ID 或名称引用。编辑时留空保留已有密码；勾选清除选项才会清空。

## 1.0.4 界面与会话更新

创建/编辑连接的字段、说明与选项已中文化。私钥路径旁可「选择文件…」，支持无扩展名私钥；文件内容导入凭据字段，保存后加密存储，不会把浏览器的虚拟路径当成本机路径。

返回服务器列表后点击当前连接会返回原会话；切换 Harness 侧栏也保留工作台。需要结束时使用「断开连接」。修复了窄文件面板的工具栏重叠，以及 CSS 隔离误改 `.sftp-body` 等类名的问题。更新后刷新客户端一次加载新界面；当前会话会随客户端刷新结束，请先完成正在进行的操作。

## 功能与适配方式

- **完整上游后端**：直接复用原版 Rust 可执行文件，保留 SSH 认证、最多三跳 ProxyJump、主机指纹校验、会话、PTY、SFTP、sudo、TOTP、端口转发、后台任务、录制、监控及原有策略逻辑。
- **完整上游工作台**：将原 Vue 组件挂载在 Harness 原生 React 页面槽位中，不使用 iframe。客户端内置 Vue；React 由 Harness 提供；样式和弹层限制在插件区域内。
- **全部原始 MCP 工具**：从运行中的原后端发现工具定义，再注册到 Harness 原生工具服务。当前固定版本实际返回 **16 个工具**，见下表；工具数以运行时清单为准。
- **共享会话**：页面与 Agent 使用同一个后端实例，保留可见终端模式、原生认证挑战和运维审批事件。
- **宿主桥接**：服务器管理、加密保存、UI 状态、浏览器文件选择/下载、剪贴板与 Harness AI 服务对接。AI 使用 Harness 已配置的模型，不另存 API Key。
- **原项目全部内容**：完整原版独立保留；适配代码位于 [Host 入口](index.js)、[服务层](src/service.js)、[传输层](src/sidecar.js)及适配前端中。

| 类别 | 工具 |
| --- | --- |
| 命令与终端 | `ssh_exec`、`ssh_exec_sudo`、`ssh_multi_exec`、`ssh_terminal_input` |
| 后台任务与连接 | `ssh_run_bg`、`ssh_task_status`、`ssh_close`、`ssh_list_connections` |
| 主机指纹 | `ssh_list_known_hosts`、`ssh_remove_known_host` |
| SFTP | `sftp_list_dir`、`sftp_stat`、`sftp_upload`、`sftp_download`、`sftp_read_file`、`sftp_write_file` |

原始工具的联合参数约束、只读限制、危险命令检查、连接范围和 sudo 白名单继续生效。Harness 不支持的 MCP JSON Schema 关键字由适配层在调用前补充校验。

## 数据与配置

默认数据目录为 `~/.dsh-ssh/default`；设置 `DSH_PROFILE` 时使用其名称作为子目录。也可通过 `DSH_SSH_DATA_DIR` 环境变量，或插件配置的 `dataDir` 显式指定独立目录。多个 Harness 实例需要独立数据时，应设置不同目录。

连接的全部内容（包括跳板机内嵌密码）使用 AES-256-GCM 加密。包装密钥与密文分别保存在数据目录中，目录权限为 `0700`，文件权限为 `0600`（Windows 使用平台权限语义）。这是本机文件加密，密钥和密文应一起备份；它不能保护已拥有同一系统账户访问权限的进程。

后端自身的 Known Hosts、OTP vault、偏好、任务等仍由原后端在同一插件数据目录管理。系统的 SSH Known Hosts 仅按上游逻辑读取。适配器隔离了 DBX 应用桥，不导入或调用已有 DBX 应用的连接。

支持配置：

```yaml
config:
  dataDir: /absolute/path/to/ssh-plugin-data
  backendPath: /absolute/path/to/dbx-plugin-ssh
  requestTimeoutMs: 600000
```

`DSH_SSH_BACKEND` 也可覆盖后端路径。取消或超时会终止整个后端实例，所有当前会话会中断；已被远端接受的命令可能继续运行。再次调用会启动新实例。删除服务器也会重启后端，以清除原运行时注册表中的凭据，因此会关闭插件的其他活动会话。

## 开发、构建与其他平台

需要 Node.js 22+。下载预编译后端还需要 Python 3；从 Rust 源码构建则需要 Cargo 及平台构建依赖。

```bash
npm install --ignore-scripts
npm --prefix frontend install --ignore-scripts
npm run setup:backend
npm run build
npm run check
npm run check:harness
npm run pack:bundle
```

正式分发使用 `pack:bundle`，产物在 `dist`。脚本生成 npm 可安装的 `.tgz`，逐项确认保留全部 1912 个原文件；避免 `npm pack` 默认过滤 `.orig`、`.gitignore` 等文件。归档自身保留原文件名；npm 安装时会把三个 `.gitignore` 改名为 `.npmignore`，完整性脚本会对改名后的相同内容继续校验。

`check:harness` 需要已安装的 Harness，默认读取当前 Node 安装前缀中的 `@deepseek-ai/dsh`；其他安装方式可通过 `DSH_RUNTIME_DIR` 指向该包目录。它仅使用临时数据和随机回环端口，不修改现有 Harness profile 或用户凭据。

后端安装脚本按当前平台选择官方发布包，逐段验证下载范围，校验完整 SHA-256 后仅提取可执行文件。[发布锁定清单](upstream-release-lock.json)包含官方 macOS ARM64/x64、Linux x64/ARM64、Windows x64 发布资产。安装脚本不通过 npm lifecycle 自动运行。

从保留的原始源码构建后端：

```bash
node scripts/setup-backend.mjs --build
```

构建不会修改原始源码目录，Cargo 输出写入插件的 `bin` 下。其他平台需要先执行后端安装脚本；当前交付目录自带的后端是 macOS ARM64。

## 验证与边界

已验证后端握手、16 个工具发现与 Harness Schema 兼容性、分帧协议、并发请求、反向认证输入、取消、超时、子进程清理、凭据加密及原版源码完整性。真实 SSH 测试只连接临时启动的 `127.0.0.1` 服务端，完成命令执行、SFTP 中文文件往返和只读写入拒绝，不使用真实服务器凭据。

客户端构建成功，适配层另有前端测试。详细结果见[验证记录](docs/VALIDATION.md)。未更改当前运行的 Harness profile；1.0.4 已用隔离浏览器预览验证中文表单、系统文件选择器和窄文件面板布局。Rust 源码未重新编译；当前使用与源码版本一致的官方发布二进制。

Telnet、串口、VNC、实验性 RDP、GPU/NPU 监控、真实跳板机、不同操作系统及全部文件预览格式需要对应环境才能逐项验收；原实现及界面均保留。RDP 仍保留原上游实验性质。浏览器文件操作按浏览器授权和内存限制工作，不能假定与 DBX 原生桌面的任意本机路径操作完全相同。

## 许可

保留上游 MIT 许可和所有 vendor 归属。参见 [LICENSE](LICENSE)、[NOTICE](NOTICE)及 [original/LICENSE](original/LICENSE)。本项目是独立适配，不代表上游作者或 DeepSeek 官方发布。
