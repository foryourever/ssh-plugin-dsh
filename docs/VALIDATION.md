# 验证记录

验证环境：macOS ARM64，Node.js 22.23.1，2026-11-03。插件版本 1.0.1；上游 0.7.13-beta.1，提交 `93c0c80cabffb08eec8fae4f7cfc0ed657ce8e9b`。

## 已通过

| 范围 | 结果与证据 |
| --- | --- |
| 原项目完整性 | `npm run verify:upstream`：全部 1912 个原文件的 SHA-256 与保留清单一致。两个 Windows 脚本只存在 CRLF/LF 差异。 |
| 官方后端 | 发布归档 SHA-256：`e079df9a96550c4db9a4c783e40af2174d1fcf2997710da274e66ca006344507`；提取的 ARM64 后端 SHA-256：`eac95e40fee45e9db545d82efcb505d4f8462ffd8166b93360381f528b4c10f6`。 |
| 原版协议 | 真实后端完成 `plugin/initialize`，返回协议 1；`mcp/tools` 实际返回全部 16 个工具。 |
| Harness Schema | 使用本机已安装 Harness 的真实 `assertObjectJsonSchema` / `assertSupportedJsonSchema`，16 个注册定义全部通过。 |
| Host 测试 | `npm run check`：29 项通过，覆盖真实 Cordis 激活、分帧、UTF-8、多请求关联、二进制、反向用户输入、畸形及超长帧、进程退出、取消、超时、重启、加密存储、篡改拒绝、工具参数和注册资源释放。 |
| 真实 SSH/SFTP | 临时回环 SSH 服务端，临时 RSA 主机密钥与测试密码；真实 Rust 客户端执行命令、读取文件、写入并读取中文内容；只读连接写入被拒绝。服务端仅返回测试响应，未执行任意 shell 输入，未连接真实服务器。 |
| 完整前端构建 | 约 24.78 MiB 的原生懒加载客户端，内置 Vue、全部工作台模块、CSS、字体/资源及 MP4v/PPTX worker；构建脚本拒绝遗漏的外部资源。React 来自宿主。 |
| 前端类型 | 完整 `vue-tsc --noEmit` 通过。 |
| 安装归档 | 自定义 npm 兼容 `.tgz` 含完整原版 1912 个文件；在独立临时安装目录执行真实 npm 安装，后端可启动并返回 16 个工具。npm 将三个 `.gitignore` 改名为 `.npmignore`，校验脚本兼容该改名并核对原字节。 |
| 前端测试 | 4 个针对性测试文件，20 项通过；包括经真实 Cordis 激活生成后的客户端工厂、注册 `main` / `sidebar.panellist` 槽位、实际挂载 Vue 服务器管理表单、终端输入队列、工作台关闭与桥接。没有 iframe。 |

## 1.0.1 启动修复

本机 Harness 0.2.0-rc.2 使用 `@deepseek-ai/cordis` 4.0.5。其 `inject` 对象的每个键都是服务名，不支持 `{ required: [...], optional: [...] }` 分组。1.0.0 的两处声明会被解释为依赖名为 `required`、`optional` 的服务，导致 `pending (waiting for services: required, optional)`，尚未执行 SSH 初始化。

1.0.1 将宿主与客户端的依赖声明改为真实服务名数组；可选 AI 与工作区服务通过 `ctx.get()` 读取，避免缺少这些服务阻止基础 SSH 功能。新增测试使用真实 Cordis 容器加载宿主插件，分别验证 AI 服务存在和不存在时均达到 ACTIVE、注册 16 个工具并正确释放资源；客户端测试也经真实 Cordis 加载编译产物。此前直接调用 `apply()` 的测试没有覆盖这次依赖声明错误。

## 可重复执行

从项目根目录运行：

```bash
npm run check
node --check client.js
npm --prefix frontend run typecheck
npm --prefix frontend test -- src/harnessRuntime.spec.mts src/harnessBridge.spec.ts src/lib/terminalInputQueue.spec.ts src/lib/workbenchCloseSessions.spec.ts
npm run pack:bundle
```

重新构建客户端：

```bash
npm run build
```

真实 SSH 集成测试在当前 macOS ARM64 后端上执行。其他平台的脚本和发布资产已提供，未进行跨平台运行验收。测试临时数据与用户连接配置隔离；DBX 应用桥也被重定向至独立目录，避免读取现有 DBX 连接。

## 明确未验证

- 本次没有向当前 Harness profile 安装 bundle；没有在现有 GUI URL 中进行真实浏览器点击、视觉或主题验收。DOM 测试不能替代真实浏览器验证。
- 没有真实服务器上的密码、私钥、SSH Agent、多跳、TOTP、sudo、GPU/NPU、Docker、Telnet、串口、VNC 或实验性 RDP 逐项环境验收；这些原版实现及界面均保留。
- 没有重新编译 Rust 后端：本机没有 Cargo，使用与源码版本一致的官方校验二进制。
- 文件预览资源已打包，但未逐一用所有文档和媒体格式验证。浏览器文件操作使用 File API / Blob 下载，受浏览器权限和内存限制，不提供 DBX 桌面原生的任意本机路径语义或流式落盘。
- 新插件的安装结果应通过 `plugin_manager` 返回的 `application` 和 `warnings` 判定。安装成功后仍应核对侧栏、工具清单及服务器认证弹窗。

## 运行行为

原 SDK 没有逐请求取消。取消、超时或删除服务器会停止整个后端，活动会话随之结束；已被远端接受的操作不能由适配器回滚。下次调用会重新初始化。此行为在测试与中文说明中明确保留。

原项目完整保存在 [original](../original/README.md)，适配实现与之分开；[来源清单](../UPSTREAM.json)、[发布锁](../upstream-release-lock.json)及[第三方许可](../THIRD_PARTY_NPM.json)可用于复核。
