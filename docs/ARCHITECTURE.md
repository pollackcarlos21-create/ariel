# Ariel 架构

## CURRENT：已落地的工程结构

技术栈为 TypeScript、Bun、ESM，使用 Bun workspace 组成 small monorepo，并启用 strict TypeScript。

| Workspace | 路径 | 已批准的职责 | 当前实现 |
| --- | --- | --- | --- |
| `@ariel/core` | `packages/core` | 可嵌入、宿主和前端无关的核心 | `ApplicationStatus` 与具名 application query `getApplicationStatus()` |
| `@ariel/providers` | `packages/providers` | 对接外部模型服务的显式 provider adapter | 仅验证 core 公共入口解析 |
| `@ariel/local-host` | `packages/local-host` | 本地宿主 adapter 与 composition root | 仅验证 core、providers 公共入口解析 |
| `@ariel/cli` | `apps/cli` | 薄 CLI frontend | 默认启动查询 core 状态并生成提示；保留 help、version 和未知参数处理 |

允许的直接依赖如下，箭头表示“左侧依赖右侧”，并不表示 core 依赖宿主：

```text
@ariel/cli        -> @ariel/core, @ariel/local-host
@ariel/local-host -> @ariel/core, @ariel/providers
@ariel/providers  -> @ariel/core
@ariel/core       -> 无
```

禁止其他跨 workspace 依赖和循环依赖。不得增加 shared、common、utils 通用包。内部依赖版本必须为 `workspace:*`。

所有包均为 private，只有 `.` 公共入口，指向 `src/index.ts`，供 Bun 和 TypeScript 在仓库内解析。没有通配 exports、源码路径别名或发布契约。CLI 另有 `bin.ariel` 指向 `src/bin.ts`；构建输出 CLI 的 `dist/index.js` 和 `dist/bin.js`，其他包仍输出 `dist/index.js`。这些是本地 ESM 构建产物，不是对外发布产物。

### CLI 当前结构

```text
src/bin.ts（Bun executable entrypoint）
  -> src/index.ts：runCli(args)
  -> 默认启动：@ariel/core.getApplicationStatus()
  -> ApplicationStatus
  -> CLI formatting
  -> CliResult：{ exitCode, stdout, stderr }
  -> src/bin.ts：process stdout/stderr/exitCode
```

`runCli` 解析参数，仅在默认启动路径调用 core application query，并根据返回的 `agentExecution` 生成中文结果；help、version 和未知参数路径不调用该 query。它不读取 process.argv、不写入进程输出流、不退出进程。公共类型 `CliResult` 仅表达当前 CLI 的输出和退出码。`src/bin.ts` 集中读取 process.argv、写入 process.stdout/process.stderr 并设置 process.exitCode；入口带有 Bun shebang。

支持默认启动、`--help` 和 `--version`。未知参数优先报错；只有已知选项时，help 优先于 version，重复选项不改变结果。默认启动仅说明尚未实现交互式 Agent，不读取 stdin、不检查仓库、不创建会话。

版本唯一来源为 CLI 自己的 package.json，通过静态 JSON import 读取，build 将版本打包进产物。只在 CLI 和根测试 tsconfig 启用 `resolveJsonModule`，不修改 core 配置。architecture guard 允许 `@ariel/cli` import 自身 workspace 根目录的 package.json；当前 CLI 实现仅使用 version 字段。此 gate 限制目标路径，不限制导入字段；其他离开 src 的相对导入仍被拒绝，包括 CLI 的 tsconfig、仓库根配置和其他 workspace 的 manifest。core 导入自身 package.json 也不属于该例外。

当前 `@ariel/cli` 只声明 `@ariel/core: workspace:*` 这一 runtime dependency，并通过 core 公共入口调用 application query。local-host 和 providers 未参与 CLI execution。只有出现真实业务调用时才加入对应 dependency；上文已批准的允许依赖方向保持不变。没有引入 CLI framework、AgentRuntime、ArielService 或宿主业务接口。

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

### core 独立性

core 禁止 Bun.file、Bun.spawn、bun:sqlite、CLI/TTY 逻辑、provider SDK、HTTP server、数据库具体实现、文件系统具体实现、shell 具体实现。当前 core 不引入外部依赖。

core 独立执行类型检查，仅启用 ES2022 标准库，`types: []`，不注入 Bun、Node 或 DOM 全局类型；CLI、local-host 和测试可以使用 Bun 类型。core 使用 browser build target 作为额外的宿主模块检查，不代表当前实现了浏览器产品。

架构测试检查 manifest 中各类依赖、workspace 图是否有环，以及 src 中 import、export-from、import type 和字面量 dynamic import 的边界。跨包相对路径、深层包导入、require、非字面量 dynamic import、triple-slash 类型注入均被拒绝。反例测试验证门禁会拒绝实际违规模式。

这些是工程门禁，不是任意恶意代码的安全沙箱；它们不能判断一段纯 TypeScript 是否在语义上实现了会话或 agent loop，范围约束仍需代码审核。后续如确需新增依赖、导出或导入模式，应经架构审核并更新相应规则和 ADR。

## PLANNED：已批准、尚未实现的运行架构

第一阶段采用单进程、可嵌入核心、显式 adapter、薄 CLI。

- core 提供可嵌入核心，公共契约不绑定 Bun、具体宿主、前端或 provider SDK。
- providers 在边界内部适配外部 provider，实现对 core 的依赖；core 不反向依赖 provider 实现。
- local-host 是 composition root，负责装配核心和具体 adapter，承载本地宿主实现。
- CLI 负责入口和用户交互，将业务委托给核心及 local-host，不承载核心逻辑。

当前已实现 CLI 直接调用 core application query；以上涉及 adapter 和资源装配的运行架构仍为批准方向，尚无核心运行时或装配 API。出现真实 adapter/resource 需求后仍由 local-host 承担 composition root。

## DEFERRED：本 milestone 明确不实现

model provider、conversation、session runtime、tools、permissions、filesystem tools、shell tools、agent loop、context management、memory、multi-agent、patch engine、LSP、MCP。

HTTP server、WebSocket、SDK、TUI、IDE integration、Desktop、Plugin system 均延期，不建立对应目录或空接口。许可证另行决定。
