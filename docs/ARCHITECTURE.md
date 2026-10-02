# Ariel 架构

## CURRENT：已落地的工程结构

技术栈为 TypeScript、Bun、ESM，使用 Bun workspace 组成 small monorepo，并启用 strict TypeScript。

| Workspace | 路径 | 已批准的职责 | 当前实现 |
| --- | --- | --- | --- |
| `@ariel/core` | `packages/core` | 可嵌入、宿主和前端无关的核心 | application status query、model interaction contract 与 `requestModelText` |
| `@ariel/providers` | `packages/providers` | 对接外部模型服务的显式 provider adapter | in-memory echo 与 DeepSeek raw fetch adapter；已通过离线测试及一次真实 smoke integration |
| `@ariel/local-host` | `packages/local-host` | 本地宿主 adapter 与 composition root | `runInMemoryModelDemo(userText)` 与显式 config 的 `runDeepSeekModelRequest(request, config)` |
| `@ariel/cli` | `apps/cli` | 薄 CLI frontend | async `runCli`；默认状态提示、help、version、参数错误及 `model-demo <text>` 的中文 presentation |

允许的直接依赖如下，箭头表示“左侧依赖右侧”，并不表示 core 依赖宿主：

```text
@ariel/cli        -> @ariel/core, @ariel/local-host
@ariel/local-host -> @ariel/core, @ariel/providers
@ariel/providers  -> @ariel/core
@ariel/core       -> 无
```

禁止其他跨 workspace 依赖和循环依赖。不得增加 shared、common、utils 通用包。内部依赖版本必须为 `workspace:*`。

当前实际 workspace dependencies 与上表允许的直接依赖一致：CLI 依赖 core、local-host；local-host 依赖 core、providers；providers 依赖 core；core 无 dependency。CLI 不直接依赖 providers，core 不 import providers 或其他 workspace。允许依赖方向不构成提前声明未使用 dependency 的理由。

所有包均为 private，只有 `.` 公共入口，指向 `src/index.ts`，供 Bun 和 TypeScript 在仓库内解析。没有通配 exports、源码路径别名或发布契约。CLI 另有 `bin.ariel` 指向 `src/bin.ts`；构建输出 CLI 的 `dist/index.js` 和 `dist/bin.js`，其他包仍输出 `dist/index.js`。这些是本地 ESM 构建产物，不是对外发布产物。

### CLI 当前结构

```text
src/bin.ts（Bun executable entrypoint）
  -> await src/index.ts：runCli(args)
     -> 默认启动：@ariel/core.getApplicationStatus() -> ApplicationStatus
     -> model-demo：@ariel/local-host.runInMemoryModelDemo(text) -> ModelResult
  -> CLI formatting
  -> Promise<CliResult>：{ exitCode, stdout, stderr }
  -> src/bin.ts：process stdout/stderr/exitCode
```

`runCli(args): Promise<CliResult>` 统一使用 async 返回值，没有 sync/async 两套入口。默认启动调用 core application query，根据 `agentExecution` 生成中文结果；model-demo 调用 local-host 并把 ModelResult 映射为 CLI 输出。help、version 和参数错误路径不调用 application status query。`runCli` 不读取 process.argv、不写入进程输出流、不退出进程。公共类型 `CliResult` 仅表达当前 CLI 的输出和退出码。`src/bin.ts` await 结果，集中读取 process.argv、写入 process.stdout/process.stderr 并设置 process.exitCode；入口带有 Bun shebang。

支持默认启动、`--help`、`--version` 和唯一的 demo 命令 `model-demo <text>`。非 demo 路径保留未知参数优先报错、help 优先于 version、重复选项不改变结果的行为。model-demo 恰好接收一个 text 参数；命令后的第一个 token 作为 text，不解析模型选项；缺失或多余参数退出 1，空白 text 由 core 校验并映射为退出 1。CLI 不读取 stdin、不检查仓库、不创建会话、不进入 REPL。默认启动仍说明尚未实现交互式 Agent；demo 成功输出包含“in-memory 模拟演示（未调用真实模型）。”及确定性的结果。

版本唯一来源为 CLI 自己的 package.json，通过静态 JSON import 读取，build 将版本打包进产物。只在 CLI 和根测试 tsconfig 启用 `resolveJsonModule`，不修改 core 配置。architecture guard 允许 `@ariel/cli` import 自身 workspace 根目录的 package.json；当前 CLI 实现仅使用 version 字段。此 gate 限制目标路径，不限制导入字段；其他离开 src 的相对导入仍被拒绝，包括 CLI 的 tsconfig、仓库根配置和其他 workspace 的 manifest。core 导入自身 package.json 也不属于该例外。

CLI 的 runtime dependencies 为 `@ariel/core: workspace:*` 与 `@ariel/local-host: workspace:*`，分别服务默认 status query 与真实 demo 调用。CLI 不 import providers，也不创建 adapter。没有引入 CLI framework、AgentRuntime、ArielService 或 generic dispatcher。

### 最小 application boundary

core 公共入口直接导出：

```ts
export interface ApplicationStatus {
  readonly agentExecution: "not-implemented";
}

export function getApplicationStatus(): ApplicationStatus;
```

`getApplicationStatus()` 返回 `{ agentExecution: "not-implemented" }`，只表达当前版本尚未实现 Agent execution 这一 application fact；不表示 provider 是否可用、配置是否有效、host 是否健康、session 是否存在或 runtime 是否已启动。CLI 消费该字段并负责中文用户文字；core 不返回 help、stdout、stderr、exit code 或 CLI version。

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

runtime control flow 不等于 source dependency direction。core 调用由 local-host 注入的 ModelPort，不 import providers；providers 从 core 公共入口导入契约。local-host 只创建 adapter、构造 request、调用 core 并返回结果，不负责 validation、prompt policy 或 retry。该调用链最初通过 in-memory 路径完成离线架构验证；DeepSeek 路径已于 2026-10-02 完成一次真实 smoke integration，但这仍不是 Agent execution；ApplicationStatus 不变。决策见 [ADR-006](decisions/ADR-006-minimal-model-interaction-boundary.md)。

### 首个真实 provider：DeepSeek

M005 冻结的 DeepSeek contract 已在 M006 Phase 1 实现：`POST https://api.deepseek.com/chat/completions`，显式选择 `deepseek-flash`、`thinking: { type: "disabled" }` 与 `stream: false`，使用 raw fetch。`@ariel/providers` 导出 `DeepSeekModelPortConfig` 与 `createDeepSeekModelPort(config)`；内部 parser/transport 不导出。具体 mapping 与测试契约见 [DeepSeek implementation contract](DEEPSEEK.md)。

local-host 的 `runDeepSeekModelRequest(request, config)` 只创建 DeepSeek port、调用 core `requestModelText` 并返回结果，不读取 env、增加 prompt 或重复 validation。config 显式携带 credential、model 和 timeout；CLI 仍只调用 in-memory demo。真实 DeepSeek smoke integration 已于 2026-10-02 在 commit `4d3a2c9` 上成功验证；这是一次 successful smoke verification，记录与验证边界见 [Real integration verification](DEEPSEEK.md#real-integration-verification)。

Deadline 覆盖完整 HTTP operation、到期实际 abort transport，并在所有结束路径清理 timer。`timeoutMs` 只接受 `1..2147483647` 的整数毫秒；上限是 Bun 单个 timer 的 host-runtime representability bound，不是 product policy、默认或推荐 timeout。非法值在 factory 同步 fail-fast，不 clamp，不做 chunked timer。local-host 必须显式传入 timeout，没有隐藏默认值。

Required response envelope 通过 runtime validation；仅完整 `stop`、assistant string content、无实际 tool output 时返回 completed，保留 empty/whitespace text。预期 transport/HTTP/JSON/schema/completion failures 使用安全的 provider-failure 文本；未知 programming error 继续传播。没有 retry 或 redirect，没有 env reading、公开 cancellation、usage、reported identity 或 reasoning exposure。

ADR-006 要求的首次真实 provider 前 cancellation、model identity、usage 审查已在 M005 完成，core public contract 的延期决定不变。M006 的 DeepSeek 实现属于 ADR-006 provider boundary 的具体落实，没有改变 dependency direction、core result semantics 或 runtime lifecycle abstraction，因此该 provider 实现本身未新增 ADR。M007 的 ADR-008 单独记录 application task contract；未来其他公共契约或 lifecycle 变化再判断是否需要新 ADR。

### Agent execution 语义与契约状态

Agent execution 是 application 接受一个已定义任务，按照 application-owned policy 处理它，并对本次运行的 completion / failure semantics 负责；model call 是其中的实现能力之一。

M007 已通过 [ADR-008](decisions/ADR-008-single-source-code-edit-proposal-task.md) 建立首个具名 application task contract：Single-Source Code Edit Proposal。该契约冻结输入、application-owned policy、proposal acceptance 与有限 completion semantics；implementation 继续延期，尚无对应 production API 或已实现能力。不创建 `AgentRequest`、`AgentResult`、`AgentExecutor`、`executeAgentRequest()` 或 `ExecutionContext`。这不意味着 Agent execution 必须依赖多次 model call、tool、session 或 persistence；一次 model call 可以构成未来某个 Agent execution 的实现路径，但固定 system prompt、ModelPort 调用与 DTO rename 本身不足以证明新的 Agent boundary 已存在。

CLI 拥有 presentation；local-host 拥有 composition 与 host facts；Ariel application policy 属于 core application layer，M007 仅冻结具体 task policy，尚未实现；provider adapter 只负责 wire protocol mapping，不得隐藏加入 Ariel product identity 或 policy。M004 的 `ModelRequest`、`ModelResult`、`ModelError`、`ModelPort` 与 generic `requestModelText()` 保持原样，`ApplicationStatus.agentExecution` 仍为 `"not-implemented"`。

ADR-007 要求从明确 application task、独立 result/failure semantics 或其他真正不同于 ModelPort 的 application behavior 出发重审边界；M007 的具名 task contract 落实了这一触发条件，generic Agent/runtime API 仍延期。具体 task 决策见 ADR-008；其他任务或执行责任的扩展仍需单独审核。Agent execution 的工程定义与延期原则见 [ADR-007](decisions/ADR-007-agent-execution-semantics-and-deferral.md)。

### core 独立性

core 禁止 Bun.file、Bun.spawn、bun:sqlite、CLI/TTY 逻辑、provider SDK、HTTP server、数据库具体实现、文件系统具体实现、shell 具体实现。当前 core 不引入外部依赖。

core 独立执行类型检查，仅启用 ES2022 标准库，`types: []`，不注入 Bun、Node 或 DOM 全局类型；CLI、local-host、providers implementation 和测试可以使用 Bun 类型。providers 的 `types: ["bun"]` 支持 fetch、AbortController 和 timer，不改变 base/core 配置或 core public contract。core 使用 browser build target 作为额外的宿主模块检查，不代表当前实现了浏览器产品。

架构测试检查 manifest 中各类依赖、workspace 图是否有环，以及 src 中 import、export-from、import type 和字面量 dynamic import 的边界。跨包相对路径、深层包导入、require、非字面量 dynamic import、triple-slash 类型注入均被拒绝。反例测试验证门禁会拒绝实际违规模式。

这些是工程门禁，不是任意恶意代码的安全沙箱；它们不能判断一段纯 TypeScript 是否在语义上实现了会话或 agent loop，范围约束仍需代码审核。后续如确需新增依赖、导出或导入模式，应经架构审核并更新相应规则和 ADR。

## PLANNED：已批准的运行方向与尚未实现的部分

第一阶段采用单进程、可嵌入核心、显式 adapter、薄 CLI。

- core 提供可嵌入核心，公共契约不绑定 Bun、具体宿主、前端或 provider SDK。
- providers 在边界内部适配外部 provider，实现对 core 的依赖；core 不反向依赖 provider 实现。
- local-host 是 composition root，负责装配核心和具体 adapter，承载本地宿主实现。
- CLI 负责入口和用户交互，将业务委托给核心及 local-host，不承载核心逻辑。

当前已有 status query、in-memory demo 及显式配置的 DeepSeek adapter/composition，已完成离线测试与一次真实 smoke integration。未来任何 DeepSeek live verification 仍需显式提供 credential 并单独授权，不进入默认 CI；不因此创建 generic application/runtime facade 或 composition framework。外部 API 发生变化时必须重新核验协议契约。

### Single-Source Code Edit Proposal：contract established / implementation deferred

M007 是 docs-only architecture milestone。ADR-008 冻结未来 core 公共契约 `CodeEditTask`、`CodeEditProposal`、`CodeEditError`、`CodeEditProposalResult` 与 `proposeCodeEdit(task, modelPort): Promise<CodeEditProposalResult>`；这些 API 尚未实现或导出。

Task 只接收 `instruction` 与一次输入的 `sourceText`。instruction 至少包含一个非 whitespace 字符，trim 仅用于 validation；sourceText 必须是非空 string，whitespace-only sourceText 仍合法，文本不 trim、normalize 或 rewrite。invalid task 返回 `failed / invalid-task`，零次 ModelPort 调用；合法 task 最多且正常情况下恰好执行一次 model attempt，不 retry、repair 或 fallback。

Core 拥有 application instruction、内部 ModelRequest 构造、private JSON output encoding 与 proposal acceptance policy。Caller 不能通过任意 system prompt 绕过 task policy；现有 ModelPort public contract 与 generic `requestModelText()` 不增加 task-specific policy、responseFormat、schema 或 tool-call capability。Core 仍不知道 DeepSeek、credential、env、fetch 或 CLI；local-host 仍是 composition root，CLI 仍是 thin frontend。

Decoder 只接受恰好包含 string `oldText` / `newText` 的 JSON object，不接受 Markdown code fences 或 JSON repair。oldText 非空，必须在原始 sourceText 中 exact-match 恰好一次；newText 可以为空以表达删除，oldText 与 newText 必须不同。Matching 只按原始 string 比较，不使用 fuzzy matching、whitespace normalization、AST 或 syntax interpretation。

ModelResult.failed 映射为 `model-failure`；预期 decode/schema/anchor/uniqueness/no-op 失败映射为 `invalid-proposal`；unexpected programming throw/reject 原样传播，禁止 blanket catch。`completed` 仅表示已生成一处针对本次 sourceText、具有唯一替换位置且会产生文本变化的修改建议；不保证 instruction 理解、proposal 语义、代码语法、bug 修复、修改应用或 tests 通过。

本契约不批准 file mutation、filesystem/shell execution、generic patch engine 或新 CLI command。后续 implementation 与 ApplicationStatus migration 留给单独批准的 implementation milestone；当前 `agentExecution` 继续为 `"not-implemented"`。

## DEFERRED：尚未实现的能力

Single-Source Code Edit Proposal 的 production implementation 与 ApplicationStatus migration 继续延期；contract established 不代表 capability implemented。M007 不批准 AgentRuntime、AgentExecutor、ExecutionContext、Session、Conversation、Thread、TurnId、ExecutionId、Tool/registry/loop、filesystem/shell execution、file mutation、Git operations、generic patch engine、StreamingModelPort、public task events、caller cancellation、retry/fallback、public usage/cost/model identity、model routing、metadata bag、generic task-kind union、server protocol、TUI/REPL/IDE integration 或新 CLI command。

DeepSeek production env/config loading 尚未实现。Provider SDK、retry/fallback、conversation、session runtime、tools、permissions、filesystem tools、shell tools、agent loop、context management、memory、multi-agent、patch engine、LSP、MCP 继续延期。

当前 ModelPort 使用 `Promise<ModelResult>` 完整结果，不定义 streaming、cancellation、usage 或 model identity 契约，不注入 AbortSignal、ReadableStream 或 DOM lib。M005 审查没有新增这些公共字段或接口；出现 caller cancellation、identity/usage 的真实消费者时重新审核相应契约。首 token UI、用户取消、tool call、multi-block output 或长时真实远程调用出现时，重新审核独立 streaming capability。没有对应空接口或占位目录。

HTTP server、WebSocket、SDK、TUI、IDE integration、Desktop、Plugin system 均延期，不建立对应目录或空接口。许可证另行决定。
