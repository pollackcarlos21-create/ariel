# Ariel 架构

## CURRENT：已落地的工程结构

技术栈为 TypeScript、Bun、ESM，使用 Bun workspace 组成 small monorepo，并启用 strict TypeScript。

| Workspace | 路径 | 已批准的职责 | 当前实现 |
| --- | --- | --- | --- |
| `@ariel/core` | `packages/core` | 可嵌入、宿主和前端无关的核心 | 空导出，无公共业务 API |
| `@ariel/providers` | `packages/providers` | 对接外部模型服务的显式 provider adapter | 仅验证 core 公共入口解析 |
| `@ariel/local-host` | `packages/local-host` | 本地宿主 adapter 与 composition root | 仅验证 core、providers 公共入口解析 |
| `@ariel/cli` | `apps/cli` | 薄 CLI frontend | 仅验证 core、local-host 公共入口解析，无命令 |

允许的直接依赖如下，箭头表示“左侧依赖右侧”，并不表示 core 依赖宿主：

```text
@ariel/cli        -> @ariel/core, @ariel/local-host
@ariel/local-host -> @ariel/core, @ariel/providers
@ariel/providers  -> @ariel/core
@ariel/core       -> 无
```

禁止其他跨 workspace 依赖和循环依赖。不得增加 shared、common、utils 通用包。内部依赖版本必须为 `workspace:*`。

所有包均为 private，只有 `.` 公共入口，指向 `src/index.ts`，供 Bun 和 TypeScript 在仓库内解析。没有通配 exports、源码路径别名、发布契约或可执行 bin。每包的 `dist/index.js` 用于验证 ESM 构建，不是对外发布产物。

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

这里只记录批准的职责，不定义尚不存在的接口、运行时或装配 API。

## DEFERRED：本 milestone 明确不实现

model provider、conversation、session runtime、tools、permissions、filesystem tools、shell tools、agent loop、context management、memory、multi-agent、patch engine、LSP、MCP。

HTTP server、WebSocket、SDK、TUI、IDE integration、Desktop、Plugin system 均延期，不建立对应目录或空接口。许可证另行决定。
