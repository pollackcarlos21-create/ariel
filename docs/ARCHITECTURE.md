# Ariel 架构

## CURRENT：已落地的工程结构

技术栈为 TypeScript、Bun、ESM，使用 Bun workspace 组成 small monorepo，并启用 strict TypeScript。

| Workspace | 路径 | 已批准的职责 | 当前实现 |
| --- | --- | --- | --- |
| `@ariel/core` | `packages/core` | 可嵌入、宿主和前端无关的核心 | application status query、model interaction contract 与 `requestModelText` |
| `@ariel/providers` | `packages/providers` | 对接外部模型服务的显式 provider adapter | `createInMemoryModelPort()` 提供确定性的离线 echo adapter；尚无真实外部模型集成 |
| `@ariel/local-host` | `packages/local-host` | 本地宿主 adapter 与 composition root | `runInMemoryModelDemo(userText)` 装配 adapter 并调用 core |
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

runtime control flow 不等于 source dependency direction。core 调用由 local-host 注入的 ModelPort，不 import providers；providers 从 core 公共入口导入契约。local-host 只创建 adapter、构造 request、调用 core 并返回结果，不负责 validation、prompt policy 或 retry。该链是离线架构验证，不是实际 LLM integration，也不是 Agent execution；ApplicationStatus 不变。决策见 [ADR-006](decisions/ADR-006-minimal-model-interaction-boundary.md)。

### core 独立性

core 禁止 Bun.file、Bun.spawn、bun:sqlite、CLI/TTY 逻辑、provider SDK、HTTP server、数据库具体实现、文件系统具体实现、shell 具体实现。当前 core 不引入外部依赖。

core 独立执行类型检查，仅启用 ES2022 标准库，`types: []`，不注入 Bun、Node 或 DOM 全局类型；CLI、local-host 和测试可以使用 Bun 类型。core 使用 browser build target 作为额外的宿主模块检查，不代表当前实现了浏览器产品。

架构测试检查 manifest 中各类依赖、workspace 图是否有环，以及 src 中 import、export-from、import type 和字面量 dynamic import 的边界。跨包相对路径、深层包导入、require、非字面量 dynamic import、triple-slash 类型注入均被拒绝。反例测试验证门禁会拒绝实际违规模式。

这些是工程门禁，不是任意恶意代码的安全沙箱；它们不能判断一段纯 TypeScript 是否在语义上实现了会话或 agent loop，范围约束仍需代码审核。后续如确需新增依赖、导出或导入模式，应经架构审核并更新相应规则和 ADR。

## PLANNED：已批准的运行方向与尚未实现的部分

第一阶段采用单进程、可嵌入核心、显式 adapter、薄 CLI。

- core 提供可嵌入核心，公共契约不绑定 Bun、具体宿主、前端或 provider SDK。
- providers 在边界内部适配外部 provider，实现对 core 的依赖；core 不反向依赖 provider 实现。
- local-host 是 composition root，负责装配核心和具体 adapter，承载本地宿主实现。
- CLI 负责入口和用户交互，将业务委托给核心及 local-host，不承载核心逻辑。

当前已实现 CLI 直接调用 core application status query，以及 local-host 装配 in-memory adapter 的 model demo。真实外部模型接入和资源生命周期尚未实现；不因此创建 generic application/runtime facade 或 composition framework。未来真实 I/O 需要重新审核 cancellation、model identity、provider usage facts 和 streaming。

## DEFERRED：尚未实现的能力

真实 LLM provider/SDK、auth/config、retry/fallback、conversation、session runtime、tools、permissions、filesystem tools、shell tools、agent loop、context management、memory、multi-agent、patch engine、LSP、MCP。

当前 ModelPort 使用 `Promise<ModelResult>` 完整结果，不定义 streaming、cancellation、usage 或 model identity 契约，不注入 AbortSignal、ReadableStream 或 DOM lib。首 token UI、用户取消、tool call、multi-block output 或长时真实远程调用出现时，重新审核独立 streaming capability；第一个真实 provider 接入前重新审核 cancellation、真实 model identity 和 provider usage facts。没有对应空接口或占位目录。

HTTP server、WebSocket、SDK、TUI、IDE integration、Desktop、Plugin system 均延期，不建立对应目录或空接口。许可证另行决定。
