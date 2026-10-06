# Ariel

[English](README.md) | 简体中文

Ariel 是一个从第一性原理构建 autonomous coding agent 的开源项目。v0.2.1 提供 terminal-native interactive coding interface：打开项目、浏览源码、用自然语言生成单文件修改建议、审阅 Before/After，再明确 Apply 或 Reject；Apply 后可在当前进程中 Undo。模型默认使用 DeepSeek，也可以显式配置 OpenAI-compatible Chat Completions endpoint。

CLI `ariel edit` 保持 proposal-only，不修改文件。TUI 只有在用户明确确认 Apply 或触发 Undo 后才写文件，没有自动 apply、shell execution 或自主 repository modification。

## Prerequisites

使用 Bun 1.4.2 compatible environment 与 Git。从 fresh clone 的仓库根目录执行以下命令；不需要 npm publish、全局安装、Electron 或 Tauri。

## Install

```sh
bun install --frozen-lockfile
```

## Configure

未设置 `ARIEL_PROVIDER` 时继续默认使用 DeepSeek。配置自己的 API key；以下是 placeholder，不能作为真实 credential 使用：

```sh
export DEEPSEEK_API_KEY="your-own-deepseek-api-key"
```

也可以用 `export ARIEL_PROVIDER="deepseek"` 显式选择同一路径；该路径使用 `deepseek-flash`，thinking disabled。

使用 OpenAI-compatible provider 时，显式提供 API base URL 与真实 model identifier：

```sh
export ARIEL_PROVIDER="openai-compatible"
export OPENAI_COMPATIBLE_BASE_URL="https://api.example.com/v1"
export OPENAI_COMPATIBLE_MODEL="example-model"
export OPENAI_COMPATIBLE_API_KEY="your-own-compatible-api-key"

bun run ariel
```

以上 endpoint、model 与 key 都是 placeholder，需要替换为供应商提供的值。对于不要求认证的 compatible endpoint，API key 可省略：不设置或 unset `OPENAI_COMPATIBLE_API_KEY`。该 key 缺失、为空或只有 whitespace 时，不发送 `Authorization` header。

`OPENAI_COMPATIBLE_BASE_URL` 必须包含供应商要求的 API prefix。例如 `https://api.example.com/v1` 最终请求 `https://api.example.com/v1/chat/completions`。尾部 `/` 会被移除；不自动猜 `/v1`、删除用户 path 或尝试其他 endpoint。默认要求 HTTPS；仅 `localhost`、`127.0.0.1`、`[::1]` 允许本地 HTTP。拒绝 embedded URL credentials、query 或 fragment。Ariel 不验证任意 provider 是否完全 OpenAI-compatible；endpoint 必须支持非流式、纯文本 Chat Completions response。

不要将真实 key 写入 Git、源码、fixture 或日志。Ariel 只使用启动进程的环境变量，不自动读取 `.env`，不提供 `--api-key` 参数或持久化 credential。未知 provider 和缺失/非法配置安全失败，不 silently fallback；CLI edit 退出 1。TUI 仍可启动和浏览文件，Generate 显示配置错误且零次网络请求。切换 provider 时修改启动环境并重启 Ariel。

## Ariel Interactive TUI

安装并配置环境变量后执行：

```sh
bun install --frozen-lockfile
export DEEPSEEK_API_KEY="your-own-deepseek-api-key"
bun run build
bun run ariel
```

直接进入全屏 terminal interface，默认打开当前 cwd。也可以指定项目：

```sh
bun run ariel .
bun run ariel /path/to/project
```

需要 interactive terminal（最小 `60 × 20`，窄于 90 cols 时切换单栏）。使用克制的 box drawing、retro ornaments 与清晰的文字层次；宽 terminal 采用 file tree/code 双栏，窄 terminal 切换单栏，可切换 tree。Terminal 过小时提示 resize；`NO_COLOR` 禁用所有彩色，文字与 `-`/`+` 仍可区分内容。

```text
╔══════════════════════════════════════════════════════╗
║  ✦ ARIEL ✦  project         DEEPSEEK ● CONFIGURED    ║
╠═══════════════╦══════════════════════════════════════╣
║ FILE TREE     ║ CODE / DIFF                          ║
║ ▾ src         ║   1 function loadData() {            ║
║   example.ts  ║   2   return data;                   ║
╠═══════════════╩══════════════════════════════════════╣
║ IDLE       Tab focus · G task · ? help · Ctrl+C quit ║
║ ❯ 把这个函数改成 async                              ║
╚══════════════════════════════════════════════════════╝
```

这是布局示意；实际内容与尺寸随 terminal、project 和当前操作变化。

1. 默认 project 是 cwd；按 Ctrl+O 输入另一个本地 project directory。
2. 在 file tree 用方向键导航、展开/折叠，Enter 打开 UTF-8 source file。目录按需 lazy loading，忽略 `.git`、`node_modules`、`dist`、`build`、`coverage`、`.cache` 等生成目录。
3. 按 G 聚焦 task input，输入 instruction，Enter 生成建议。第一次 Generate 前确认 selected source 会发送 configured model provider；确认框显示 provider 名，每进程只确认一次。
4. 审阅 Before/After 与 `PROPOSAL VALIDATED`。按 R Reject 返回源码，不改变文件。
5. 按 A 打开 Apply 确认框，Enter 确认才写文件；Esc 取消。文件自 Generate 后已改变时拒绝 stale proposal，需要重新 Generate。
6. 按 U Undo；如果文件之后已被外部修改，拒绝覆盖新内容。

| 按键 | 用途 |
| --- | --- |
| ↑ / ↓、← / → | file tree 导航、折叠/展开 |
| Enter / Esc | 打开、确认 / 返回、取消 |
| Tab | 切换 focus |
| Ctrl+O | 打开 project |
| G | 聚焦 task / Generate |
| A / R / U | Apply 确认 / Reject / guarded Undo |
| ? | keyboard reference |
| Ctrl+C / `:q` | 退出并恢复 terminal |

Task input 用 Ctrl+J 输入换行，Enter Generate；不依赖 terminal 的 Shift+Enter 编码。Task input 中的文字按原样解释；letter shortcuts 在相应 navigation focus 使用，输入文字时不把字母当作 Apply/Reject。界面始终显示 contextual shortcuts。

选中的完整源码与 instruction 会发送到 configured endpoint；只选择愿意向该 provider 分享的文本。配置仅由 executable composition boundary 从启动环境读取，不在 TUI 输入或保存 key，不写入文件或日志。Header 显示 `DEEPSEEK` 或 `OPENAI-COMPAT` 与本地配置状态，不显示 credential。DeepSeek 使用 `deepseek-flash`；compatible 路径使用 `OPENAI_COMPATIBLE_MODEL`。两个 code-edit workflow 都采用显式 host timeout `120 sec`。

`CONFIGURED` 仅表示本地配置有效，不验证认证、账户余额、网络连接或 provider compatibility。失败时 TUI 显示安全的 HTTP status 或固定的网络、超时、响应格式提示，不显示 provider response body，不自动重试。Enter 或 Esc 关闭错误后可以输入下一条 task；审阅 proposal 后按 R Reject，再按 G 输入下一条。Apply、Undo 和关闭 Help 后也可继续操作。

每次任务独立、一次 model attempt，无 retry/repair/fallback。Proposal/Undo 只在当前 TUI process 保留，退出或切换 project 不保存聊天或撤销历史。Code viewer 只读，显示 line numbers，按窗口大小裁剪与滚动文本；viewer 将 tab 显示为四空格，原始 sourceText 与真实写入不因此改写。

退出会立即恢复 terminal；如果已确认的 Apply/Undo 正在执行，Ariel 会等待该次文件写入与 cleanup 完成后才结束 process。

Project workflow 只支持 root 内不超过 `5 MiB` 的 single-link regular UTF-8 text files，拒绝 traversal、absolute file-path escape、项目内 symlink、hardlink 和 NUL/binary；不能运行用户代码、tests、shell 或 Git。Apply/Undo 检查 hash 并 atomic replacement，但不提供对同权限恶意本地进程的跨进程锁或 crash recovery；不承诺保留 ACL/extended attributes。只在自己愿意编辑的本地项目中使用。

## CLI mode

指定一个已经存在的源码文件和一条自然语言 instruction：

```sh
bun run ariel edit src/example.ts "把这个函数改成 async"
```

`src/example.ts` 是用户文件示例，需替换为自己的真实路径。也可以对仓库中现有的文件请求建议，例如：

```sh
bun run ariel edit packages/core/src/index.ts "为 getApplicationStatus 添加一行简短注释"
```

`edit` 恰好接收两个 positional args：file 与 instruction。支持 absolute path；relative path 按当前 process cwd 解释。输入必须是非空、有效 UTF-8 的 regular file；whitespace-only 文本合法。Ariel 只读取该文件，不搜索 repository、不递归、不运行用户代码或 tests。

此命令与 TUI 使用同一启动 `ARIEL_PROVIDER` 配置。未选择 provider 时继续使用 `deepseek-flash`、thinking disabled；选择 `openai-compatible` 时使用配置的 endpoint/model。两条路径均 non-streaming；local-host 显式传入 `120000ms` 的 total HTTP timeout，provider 自身没有隐藏默认 timeout。没有自动 retry、repair 或 fallback。指定文件的全部文本与 instruction 会发送到 configured endpoint。

成功时退出 0，显示类似以下的 patch-like preview：

```text
Ariel Code Edit Proposal

File: src/example.ts

--- before
+++ after
@@ proposal @@
- function loadData() {
+ async function loadData() {

Proposal validated.
No files were modified.
```

Validation 只确认 output 是恰好包含 oldText/newText 的 JSON proposal、oldText 在本次原始 sourceText 中有唯一 exact-match 位置且会产生文本变化。newText 可以为空以表示删除。它不保证 instruction 理解、语义、语法、bug 修复或 tests 通过，也不会应用修改。Preview 保留 proposal 的 newline/tab 用于格式，对其他 `Cc` control characters 作可见转义；File label 的 newline/tab 也转义，并隐去与本次 credential 相同的文本。它不是可直接 apply 的 unified patch。请审阅建议后自行决定如何修改文件。

参数错误、配置错误、文件读取失败、invalid task、model failure 和 invalid proposal 均退出 1；预期错误使用简短安全信息，unexpected error 由 executable boundary 输出通用错误。

## 其他 CLI 路径

```sh
bun run ariel --help
bun run ariel --version
bun run ariel
bun run ariel model-demo "hello"
```

- `ariel --help`：显示 usage、commands 和 options。
- `ariel --version`：输出 CLI package.json 中的版本。
- `ariel` 或 `ariel <project>`：进入 interactive TUI；非 interactive terminal 安全报错，不创建后台进程。
- `ariel model-demo "<text>"`：保留离线 in-memory simulation，不调用真实模型，不读取 API key；恰好接收一个非空白 text 参数。
- 未知参数：向 stderr 输出错误与帮助提示，退出 1。

`bun run ariel` 使用根 launcher，是当前 TUI 主入口；`./node_modules/.bin/ariel` 仍指向 CLI 的 `src/bin.ts`，保留原有非交互默认 status/help/version/edit/model-demo。后者无参数不会进入 TUI。所有 workspace 仍为 private；当前不提供全局安装或 npm package。

## 架构与开发

core 的 `proposeCodeEdit(task, modelPort)` 拥有 task policy 和 proposal acceptance；local-host 负责文件/root sandbox、configured provider composition 和显式 Apply/Undo；CLI/TUI 负责 presentation；providers 负责 wire mapping。core 不知道 path、filesystem、env、credential、terminal 或具体 provider。`getApplicationStatus()` 保持 `{ agentExecution: "single-source-code-edit-proposal" }`。

当前没有自动文件修改、多文件自主任务、autonomous repository exploration、shell execution、自动运行 tests/Git、Tool、AgentRuntime、Session、streaming、retry/fallback、MCP/LSP、IDE、remote server、accounts、cloud sync、telemetry 或 desktop wrapper。

- [开发与验证](docs/DEVELOPMENT.md)
- [当前架构与边界](docs/ARCHITECTURE.md)
- [阶段与验收目标](docs/ROADMAP.md)
- [架构决策索引](docs/DECISIONS.md)
- [Coding agent 仓库规则](AGENTS.md)

许可证尚待 Chief Architect 决定，仓库不包含 LICENSE。
