# Ariel 架构

## CURRENT：已落地的工程结构

技术栈为 TypeScript、Bun、ESM，使用 Bun workspace 组成 small monorepo，并启用 strict TypeScript。

| Workspace | 路径 | 已批准的职责 | 当前实现 |
| --- | --- | --- | --- |
| `@ariel/core` | `packages/core` | 可嵌入、宿主和前端无关的核心 | application status query、model interaction contract、`requestModelText` 与 `proposeCodeEdit` task policy/validation |
| `@ariel/providers` | `packages/providers` | 对接外部模型服务的显式 provider adapter | in-memory echo 与 DeepSeek raw fetch adapter；已通过离线测试及一次真实 smoke integration |
| `@ariel/local-host` | `packages/local-host` | 本地宿主 adapter 与 composition root | model composition、只读 CLI edit、project 文件安全边界与显式 Apply/Undo |
| `@ariel/cli` | `apps/cli` | 薄 CLI frontend | async `runCli`；默认状态、help、version、in-memory demo 与 `edit <file> "<instruction>"` proposal presentation |
| `@ariel/tui` | `apps/tui` | terminal-native 薄交互前端 | Ink 7.1.1 / React 19.3.0 presentation、keyboard navigation、readonly source/diff、Apply confirmation 与 guarded Undo |

允许的直接依赖如下，箭头表示“左侧依赖右侧”，并不表示 core 依赖宿主：

```text
@ariel/cli        -> @ariel/core, @ariel/local-host
@ariel/local-host -> @ariel/core, @ariel/providers
@ariel/providers  -> @ariel/core
@ariel/core       -> 无
@ariel/tui        -> @ariel/local-host
```

禁止其他跨 workspace 依赖和循环依赖。不得增加 shared、common、utils 通用包。内部依赖版本必须为 `workspace:*`。

TUI 只从 local-host 公共入口消费 project/model composition，不 import core 或 providers。CLI 非交互逻辑仍通过 core/local-host，core 无 Ariel runtime dependencies。Ink/React 仅负责 terminal presentation，不获得 application policy 或 provider authority。允许依赖方向不构成提前声明未使用 dependency 的理由。

全部五个 workspace 均为 private，只有 `.` 公共入口，指向 `src/index.ts`。没有通配 exports、源码别名或发布契约。CLI 的 bin.ariel 保持 src/bin.ts；根目录 ariel.ts 通过 CLI/TUI 公共入口选择 frontend，bun run ariel 指向该 launcher。Root build 额外生成 dist/ariel.js；TUI build 保留 external packages，需安装依赖。本地构建不是 npm 发布产物。

五 workspace 与 terminal frontend 的有限演进见 [ADR-010](decisions/ADR-010-terminal-native-tui-boundary.md)：在既有四包边界上增加具名 TUI frontend，保留 core 独立、local-host composition 与显式公共导出。没有 HTTP server、local daemon 或 browser product。

### CLI 当前结构

```text
src/bin.ts（Bun executable entrypoint）
  -> edit 路径读取 DEEPSEEK_API_KEY
  -> await src/index.ts：runCli(args, apiKey?)
     -> 默认启动：@ariel/core.getApplicationStatus() -> ApplicationStatus
     -> model-demo：@ariel/local-host.runInMemoryModelDemo(text) -> ModelResult
     -> edit：@ariel/local-host.runDeepSeekCodeEditFromFile(file, instruction, apiKey)
        -> 读取单个文件 + 装配 DeepSeek -> @ariel/core.proposeCodeEdit(task, modelPort)
        <- validated CodeEditProposalResult 或 file-read-failure
  -> CLI formatting
  -> Promise<CliResult>：{ exitCode, stdout, stderr }
  -> src/bin.ts：process stdout/stderr/exitCode
```

`runCli(args, apiKey?: string): Promise<CliResult>` 仍统一使用 async 返回值。非交互 model-demo/edit 将 local-host 的结构化结果映射为 CLI 输出，help/version/参数错误不需要 application status query。`runCli` 不读取 process.argv/env、不写输出流、不退出进程，不 blanket catch。根目录 `ariel.ts` 对无参数或一个 project path 启动 `@ariel/tui.launchTui({ projectPath, apiKey?, noColor? })`，通过公共入口使用两种 frontend，其他路径调用 runCli。Launcher 读取 argv、cwd 和必要的启动 env，向 TUI 显式传入 key/NO_COLOR；TUI runtime 不读取 env。CLI `src/bin.ts` 与 `./node_modules/.bin/ariel` 保留原有非交互路径（含默认 status），只在 edit 读取 key。两种 executable 都集中处理 stdout/stderr/exitCode 与安全 unexpected-error boundary，不建立 CLI → TUI 依赖。

支持 interactive 默认启动与 project path，以及 `--help`、`--version`、离线 `model-demo <text>` 和真实 `edit <file> "<instruction>"`。非交互选项路径保留未知参数优先报错、help 优先于 version、重复选项不改变结果。model-demo 仍恰好接收一个 text，不需要 API key 或网络；成功输出明确标识“in-memory 模拟演示（未调用真实模型）。”。CLI library 保留原有 status presentation，terminal stdin/keypress/lifecycle 属于 TUI frontend，不进入 core。

edit 恰好接收 file/instruction 两个 positional args。CLI 拒绝缺失/多余参数及无效 key，然后委托 host 读取单文件、装配真实 DeepSeek 并调用 core。成功 stdout 显示文件、oldText/newText 的逐行 patch-like preview、`Proposal validated.` 和 `No files were modified.`，退出 0；空 newText 明确表示删除。参数/config/file-read/core-task/model/proposal 的预期失败退出 1，使用安全简短 stderr，不透传 credential、sourceText 全文、provider body 或 stack。该 preview 不是自动应用 patch。

版本唯一来源为 CLI 自己的 package.json，通过静态 JSON import 读取，build 将版本打包进产物。只在 CLI 和根测试 tsconfig 启用 `resolveJsonModule`，不修改 core 配置。architecture guard 允许 `@ariel/cli` import 自身 workspace 根目录的 package.json；当前 CLI 实现仅使用 version 字段。此 gate 限制目标路径，不限制导入字段；其他离开 src 的相对导入仍被拒绝，包括 CLI 的 tsconfig、仓库根配置和其他 workspace 的 manifest。core 导入自身 package.json 也不属于该例外。

CLI 的 runtime dependencies 为 `@ariel/core: workspace:*` 与 `@ariel/local-host: workspace:*`，分别服务 status query 与 host workflow。CLI 不 import providers，也不创建 adapter。没有引入 CLI framework、AgentRuntime、ArielService 或 generic dispatcher。

### 最小 application boundary

core 公共入口直接导出：

```ts
export interface ApplicationStatus {
  readonly agentExecution: "single-source-code-edit-proposal";
}

export function getApplicationStatus(): ApplicationStatus;
```

`getApplicationStatus()` 返回 `{ agentExecution: "single-source-code-edit-proposal" }`，精确表达 M008 已实现的具名 application task；不表示 provider 是否可用、配置是否有效、host 是否健康、session 是否存在或 runtime 是否已启动。CLI 消费该字段并负责中文用户文字；core 不返回 help、stdout、stderr、exit code 或 CLI version。该 literal migration 属于 M008 实现，不是 capability registry。

该 query 同步、无参数、无副作用，不读取 filesystem、process/env、cwd、time，不访问 network，不使用 Bun 或 Node runtime API，不依赖第三方包或其他 workspace。不创建实例、后台任务、Promise 或生命周期。它不是 generic capabilities registry；没有 Application service object、Runtime facade 或 command/query dispatcher。决策见 [ADR-005](decisions/ADR-005-minimal-application-boundary.md)。

### 最小 model interaction boundary

core 在 `src/model.ts` 定义以下契约，通过 `src/index.ts` 显式导出：

```ts
export interface ModelRequest {
  readonly userText: string;
  readonly systemText?: string;
}

export interface ModelError {
  readonly kind: "invalid-request" | "provider-failure";
  readonly message: string;
}

export type ModelResult =
  | { readonly status: "completed"; readonly text: string }
  | { readonly status: "failed"; readonly error: ModelError };

export interface ModelPort {
  generateText(request: ModelRequest): Promise<ModelResult>;
}

export function requestModelText(
  request: ModelRequest,
  modelPort: ModelPort,
): Promise<ModelResult>;
```

`requestModelText` 只用 `userText.trim().length === 0` 判断空白输入。无效输入返回 `failed`、`invalid-request` 和 `userText must not be empty.`，不调用 port；合法输入把同一原始 request 交给 `generateText` 恰好一次，并原样返回 adapter 的 ModelResult。它不 trim 合法 userText、不合并 systemText、不添加 prompt。`completed` 的 text 可以为空字符串；`provider-failure` 由 adapter 归一化预期失败，core 不把失败转换成成功。意外 throw/reject 自然传播，没有通用异常恢复、retry、fallback 或 timeout。

`userText`、`systemText` 是 application semantic slots，不是通用 Message[] 或 role/history 模型。CLI 没有 `--system`。in-memory adapter 不解释 systemText，也不把它拼入 userText；它始终返回 `completed` 与 `Echo: ${request.userText}`，不访问网络、环境变量、API key、filesystem、随机数或时钟，不持有后台资源，没有 dispose 或公共失败模式。

运行时控制流（runtime control flow）：

```text
CLI：runCli(["model-demo", text])
  -> local-host：runInMemoryModelDemo(text)
     -> providers：createInMemoryModelPort()
     -> core：requestModelText({ userText: text }, modelPort)
        -> ModelPort.generateText(originalRequest)
           -> providers 的 deterministic in-memory adapter
        <- ModelResult
     <- ModelResult
  -> CLI 中文 presentation
```

runtime control flow 不等于 source dependency direction。core 调用由 local-host 注入的 ModelPort，不 import providers；providers 从 core 公共入口导入契约。local-host 负责 host facts/composition，不负责 application validation、prompt policy 或 retry。该 generic model 调用链最初通过 in-memory 路径完成离线验证，DeepSeek 路径于 2026-10-02 完成一次真实 smoke integration。单独的 generic model demo 本身不构成 Agent execution；当前 status migration 来自 M008 的具名 application task 实现。决策见 [ADR-006](decisions/ADR-006-minimal-model-interaction-boundary.md)。

### 首个真实 provider：DeepSeek

M005 冻结的 DeepSeek contract 已在 M006 Phase 1 实现：`POST https://api.deepseek.com/chat/completions`，显式选择 `deepseek-flash`、`thinking: { type: "disabled" }` 与 `stream: false`，使用 raw fetch。`@ariel/providers` 导出 `DeepSeekModelPortConfig` 与 `createDeepSeekModelPort(config)`；内部 parser/transport 不导出。具体 mapping 与测试契约见 [DeepSeek implementation contract](DEEPSEEK.md)。

local-host 的 `runDeepSeekModelRequest(request, config)` 仍只创建 DeepSeek port、调用 core `requestModelText` 并返回结果，不读取 env、增加 prompt 或重复 validation。M009 的 `runDeepSeekCodeEditFromFile(filePath, instruction, apiKey)` 接收 CLI boundary 提供的 credential，读取文件并装配 DeepSeek port，调用 core `proposeCodeEdit`。真实 generic model smoke integration 已于 2026-10-02 在 commit `4d3a2c9` 上成功验证；该历史 evidence 不等于当前 edit workflow 已执行 live smoke，记录与验证边界见 [Real integration verification](DEEPSEEK.md#real-integration-verification)。

Deadline 覆盖完整 HTTP operation、到期实际 abort transport，并在所有结束路径清理 timer。Provider `timeoutMs` 只接受 `1..2147483647` 的整数毫秒；上限是单个 timer 的 host-runtime representability bound，不是 product policy。非法值 factory 同步 fail-fast，不 clamp 或 chunk。Provider 仍要求显式 config，没有隐藏默认值；M009 code-edit host workflow 的 product default 为 `120000ms`，显式传入 factory，固定 `deepseek-flash`。generic `runDeepSeekModelRequest` 仍由 caller 显式提供 timeout。

Required response envelope 通过 runtime validation；仅完整 `stop`、assistant string content、无实际 tool output 时返回 completed，保留 empty/whitespace text。预期 transport/HTTP/JSON/schema/completion failures 使用安全的 provider-failure 文本；未知 programming error 继续传播。没有 retry 或 redirect，没有 env reading、公开 cancellation、usage、reported identity 或 reasoning exposure。

ADR-006 要求的首次真实 provider 前 cancellation、model identity、usage 审查已在 M005 完成，core public contract 的延期决定不变。M006 的 DeepSeek 实现属于 ADR-006 provider boundary 的具体落实，没有改变 dependency direction、core result semantics 或 runtime lifecycle abstraction，因此该 provider 实现本身未新增 ADR。M007 的 ADR-008 单独记录 application task contract；未来其他公共契约或 lifecycle 变化再判断是否需要新 ADR。

### Single-Source Code Edit Proposal application task

M007 的 [ADR-008](decisions/ADR-008-single-source-code-edit-proposal-task.md) 建立契约，M008 在 core 的 `src/code-edit.ts` 实现并从公共入口导出 `CodeEditTask`、`CodeEditProposal`、`CodeEditError`、`CodeEditProposalResult` 与 `proposeCodeEdit(task, modelPort)`。M007 的 contract-only 状态是历史 milestone scope，当前 capability 来自后续批准的 implementation。

Task 只接收原始 instruction/sourceText。instruction 必须为非空白 string，trim 仅用于 validation；sourceText 必须为非空 string，whitespace-only 合法，文本不 trim、normalize 或 rewrite。invalid task 返回 `failed / invalid-task`、零次 port 调用；通过 validation 后使用 generic `requestModelText` 恰好一次 model attempt，没有 retry、repair 或 fallback。

Core 拥有固定 application system instruction、`JSON.stringify({ instruction, sourceText })` 内部 user request、private JSON output encoding 与 proposal acceptance。Caller 没有 system prompt 参数；ModelPort/ModelRequest/ModelResult/ModelError 与 `requestModelText` 契约保持不变。Core 不知道 file path、cwd、filesystem、DeepSeek、credential、env、fetch 或 CLI。

Decoder 只接受 non-null、非 Array 的 JSON object，own enumerable keys 必须恰好为 string oldText/newText；不剥离 code fences、不修复 JSON。oldText 非空且在原始 sourceText exact-match 恰好一个 start position，包括 overlapping occurrence；newText 可以为空表示删除，但必须与 oldText 不同。没有 fuzzy matching、normalization、AST/syntax interpretation 或 generic patch engine。

ModelResult.failed 映射 `model-failure`；预期 JSON SyntaxError/schema/anchor/uniqueness/no-op 失败映射 `invalid-proposal`。Catch 只围绕 JSON.parse 并只归一化 SyntaxError；unexpected programming throw/reject 原样传播。

`completed` 只表示针对本次 sourceText 产生一处有唯一替换位置且会变化的文本建议；不保证 instruction 理解、proposal 语义、代码语法、bug 修复、修改应用或 tests 通过。Core 不执行文本替换或文件操作。

### v0.1 CLI 单文件 host workflow

M009 的 [ADR-009](decisions/ADR-009-first-user-facing-code-edit-cli.md) 记录首个 user-facing workflow：`ariel edit <file> "<instruction>"`。local-host 的 `runDeepSeekCodeEditFromFile(filePath, instruction, apiKey)` 负责单文件读取与 composition，返回 CodeEditProposalResult 或安全的 `file-read-failure`。

Relative path 按当前 process cwd 解释，absolute path 直接读取；host 只接受 regular file 和有效 UTF-8，不递归、不查找相关文件，保留原始字符包括 BOM。空文件在 model operation 前拒绝，whitespace-only text 原样交给 core；不存在、directory、special file、不可读或文本解码失败属于预期读取错误。只在 file-read scope 归一化已识别读取错误，unexpected programming error 继续传播。

Host 显式装配 `createDeepSeekModelPort({ apiKey, model: "deepseek-flash", timeoutMs: 120_000 })`，将原始 sourceText/instruction 传给 `proposeCodeEdit`。CLI boundary 只为 edit 读取 DEEPSEEK_API_KEY；provider 不读取 env，core 不接收 credential。没有 key persistence、provider selector、secret logging 或 SDK。

Code-edit composition 在私有 port wrapper 中观察 adapter 的固定安全失败文字，以精确 allowlist 重新生成 host 自有 HTTP status、timeout、network 或响应格式诊断；原 ModelResult 仍原样交给 core。只有最终 model-failure 才附带该安全诊断，不改变 core public contract、proposal validation 或未知异常传播，不增加 model attempt。TUI 再次精确映射为固定用户文字，未知内容使用通用错误；CLI 保留原有固定失败文字，不透传 provider body/message。

CLI edit 和其 host composition 路径仍不应用 proposal、不写用户文件、不运行 shell/tests/Git。stdout 是逐行 oldText/newText preview，而不是完整 unified diff 或 patch application contract；显示 `Proposal validated.` 与 `No files were modified.`。Proposal 的 newline/tab 用于格式保留，其他 `Cc` control characters 使用可见转义；File label 的 newline/tab 也转义。如果 preview 含本次 credential，presentation 隐去该值并明确提示，core proposal/request/source 不因 rendering 改写。它只对应本次读取的文本快照，不能保证文件在显示后仍未被其他进程修改。v0.2 TUI 的明确 Apply/Undo 是独立 host operation，不改变该 CLI 行为。

### v0.2 terminal-native TUI 与 project boundary

`bun run ariel` 直接进入 Ink TUI，默认 project 为 process cwd；一个 project path 可显式选择项目，Ctrl+O 可重新打开。TUI 只 import local-host 公共入口，不直接创建 provider，不实现 filesystem 或 application acceptance。Root launcher 是具体 CLI/TUI 选择，不是新增 workspace、generic router 或 application dispatcher。Executable composition 从启动 env 读取 DEEPSEEK_API_KEY 并显式传给 host；model 固定 deepseek-flash、host 显式沿用 120000ms timeout。

Ink/React state 只表示选中文件、focus、task input、proposal、确认框和当前 Undo 等 frontend operation state，不成为 core application state。键盘优先，宽 terminal 显示 tree/code 双栏，窄 terminal 切换布局并窗口化源码行。主题 tokens 集中控制样式；NO_COLOR 完全禁用颜色，不影响文字信息。Full-screen alternate screen、cursor 和 input mode 必须在正常退出、Ctrl+C、:q 与异常路径恢复。

退出时先恢复 terminal；已确认且正在执行的 Apply/Undo 继续完成 host 写入与 staging cleanup，process 等待其结束。尚未开始的任务不在退出后发起 model request。

用户输入 project path，host 验证 canonical directory。后续 list/read/propose/apply/undo 均限制在 selected project root：relative path、canonical containment，拒绝 traversal/absolute file escape 和项目内 symlink/hardlink。文件树 lazy listing，忽略 .git/node_modules/dist/build/coverage/.cache 等生成目录；读取不超过 `5 MiB` 的 single-link regular UTF-8 files，拒绝 NUL/binary，保留原始字符/BOM/newlines。没有 repository search 或 shell execution。

Generate 通过 local-host 复用 core proposeCodeEdit 与真实 DeepSeek；每次 task 独立、一次 attempt，没有 Agent loop。第一次 Generate 前用户确认 selected source/instruction 会发送 provider，每进程仅确认一次。显示 task 状态、安全错误和 Before/After；proposal acceptance 仍不代表代码正确，Reject 不写文件。Terminal control characters 仅在 display layer 安全处理，不能借源码向 terminal 注入控制序列。

Apply 必须用户按 A 并在确认框 Enter 确认：以 Generate 的 source SHA-256 检查 stale，重新读取并再次验证 oldText exact unique match，成功后同目录 temporary file + atomic rename 写入。Undo 仅在 current hash/content 等于对应 after snapshot 时恢复 before bytes。状态只保留当前 process memory，无跨重启 history。Atomic rename 不等于跨进程 compare-and-swap 或 crash durability；权限/ownership 不支持时安全拒绝，不 chmod，也不保证 ACL/extended attributes。细节和限制见 [ADR-011](decisions/ADR-011-user-confirmed-file-apply-and-undo-semantics.md)。

### Agent execution 语义

Agent execution 是 application 接受一个已定义任务，按照 application-owned policy 处理它，并对本次 completion/failure semantics 负责；model call 是其中的实现能力之一。M008 的具名 code-edit task 提供独立 input validation 和 proposal acceptance，因此当前 status 精确迁移为 `single-source-code-edit-proposal`。不创建 AgentRequest、AgentResult、AgentExecutor、executeAgentRequest、ExecutionContext、runtime facade 或 dispatcher。

CLI 拥有 presentation，local-host 拥有 host facts/composition，core 拥有 application policy，provider 只负责 wire mapping。ADR-007 的 generic Agent/runtime 延期原则继续有效，其他 task 或执行责任扩展仍需单独审核。

### core 独立性

core 禁止 Bun.file、Bun.spawn、bun:sqlite、CLI/TTY 逻辑、provider SDK、HTTP server、数据库具体实现、文件系统具体实现、shell 具体实现。当前 core 不引入外部依赖。

core 独立执行类型检查，仅启用 ES2022 标准库，`types: []`，不注入 Bun、Node 或 DOM 全局类型；CLI、TUI、local-host、providers implementation 和测试可以使用 Bun 类型；React types 只在 TUI 和相应 presentation tests 启用，不改变 core ES-only 配置。providers 的 `types: ["bun"]` 支持 fetch、AbortController 和 timer，不改变 base/core 配置或 core public contract。core 使用 browser build target 作为额外的宿主模块检查，不代表当前实现了浏览器产品。

架构测试检查 manifest 中各类依赖、workspace 图是否有环，以及 src 中 import、export-from、import type 和字面量 dynamic import 的边界。跨包相对路径、深层包导入、require、非字面量 dynamic import、triple-slash 类型注入均被拒绝。TUI gate 额外拒绝 core/providers 直接导入、filesystem module、Bun.file/write/spawn 与直接 process.env access，只允许必要的 terminal process APIs；provider 不读取 process.env。反例测试验证门禁会拒绝实际违规模式。

这些是工程门禁，不是任意恶意代码的安全沙箱；它们不能判断一段纯 TypeScript 是否在语义上实现了会话或 agent loop，范围约束仍需代码审核。后续如确需新增依赖、导出或导入模式，应经架构审核并更新相应规则和 ADR。

## PLANNED：已批准的运行方向与尚未实现的部分

第一阶段采用单进程、可嵌入核心、显式 adapter、薄 CLI。

- core 提供可嵌入核心，公共契约不绑定 Bun、具体宿主、前端或 provider SDK。
- providers 在边界内部适配外部 provider，实现对 core 的依赖；core 不反向依赖 provider 实现。
- local-host 是 composition root，负责装配核心和具体 adapter，承载本地宿主实现。
- CLI 负责入口和用户交互，将业务委托给核心及 local-host，不承载核心逻辑。

当前已有 status query、具名 code-edit application task、in-memory demo、DeepSeek adapter 和单文件 edit CLI。未来任何 live verification 仍需显式 credential 和单独授权，不进入默认 CI；不因此创建 generic application/runtime facade 或 composition framework。外部 API 发生变化时必须重新核验 provider 契约。

## DEFERRED：尚未实现的能力

当前只支持单文件、独立 task 和用户明确 Apply/Undo。自动 file mutation、multi-file autonomous task、autonomous repository search、shell execution、用户项目 tests/Git operations、generic patch engine 均延期；v0.2 root sandbox 内的 lazy browsing不是自主 repository exploration。

AgentRuntime、AgentExecutor、ExecutionContext、Session、Conversation、Thread、TurnId、ExecutionId、Tool/registry/loop、public task events、caller cancellation、retry/fallback、public usage/cost/model identity、routing、metadata bag、generic task-kind union、memory、multi-agent、token budgeting 和 cost accounting 均延期，没有占位 API 或目录。M009 只读取 DEEPSEEK_API_KEY，不创建 generic config loading 或 provider SDK。

当前 ModelPort 使用 `Promise<ModelResult>` 完整结果，不定义 streaming、cancellation、usage 或 model identity 契约，不注入 AbortSignal、ReadableStream 或 DOM lib。M005 审查没有新增这些公共字段或接口；出现 caller cancellation、identity/usage 的真实消费者时重新审核相应契约。首 token UI、用户取消、tool call、multi-block output 或长时真实远程调用出现时，重新审核独立 streaming capability。没有对应空接口或占位目录。

Browser GUI、HTTP server、local daemon、WebSocket、generic SDK、IDE integration、Electron/Tauri、Plugin system、accounts/cloud sync/telemetry、remote execution 均延期，不建立对应目录或空接口。当前用户入口为 terminal-native TUI 与保留的非交互 CLI；许可证另行决定。
