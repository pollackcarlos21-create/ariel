# ADR-003：源码依赖方向与 core 独立性

状态：Accepted

## Context

可嵌入核心需要独立于具体宿主、前端和 provider 实现。仅靠目录约定不足以发现反向依赖或循环依赖。

## Decision

允许的直接依赖为 cli → core、local-host；local-host → core、providers；providers → core；core → 无。禁止其他跨 workspace 依赖和循环依赖。

core 禁止 Bun-specific runtime、CLI/TTY、provider SDK、HTTP server，以及数据库、文件系统、shell 的具体实现。当前仅使用标准 ECMAScript 类型，不注入 Bun、Node 或 DOM ambient types。

通过显式 package exports、逐包类型检查和小型 architecture tests 检查依赖声明、源码导入及循环依赖。不得通过跨包相对路径或深层导入绕过入口。

## Consequences

具体实现依赖核心，核心保持可嵌入性。门禁本身包含违规反例；仍需人工审核业务语义。当前 core 不引入外部依赖，未来如需扩展必须经过架构审核。

## Alternatives considered

- 允许任意互相导入：容易形成循环及宿主耦合，不采用。
- 仅用 TypeScript paths：不能建立可靠的包边界，不采用。
- 复杂架构框架：当前四包规模不需要，复用 TypeScript parser 即可。
