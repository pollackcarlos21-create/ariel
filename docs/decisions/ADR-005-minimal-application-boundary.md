# ADR-005：最小 Application Boundary

状态：Accepted

## Context

Milestone 001 建立工程与 workspace 边界，Milestone 002 建立 thin CLI。在引入本决策前，core 尚无真实公共 application API，默认启动提示中的 application fact 由 CLI 自己持有。

当前只有一个真实需求：CLI 默认启动需要查询 application-level implementation state，再生成用户文字。它不需要运行 Agent，也不需要 provider、配置、host 健康检查或 session。

## Decision

core 公共入口导出具名同步 query `getApplicationStatus(): ApplicationStatus`。`ApplicationStatus` 只包含 `readonly agentExecution: "not-implemented"`，表示当前版本尚未实现 Agent execution，不表示 provider 是否可用、配置是否有效、host 是否健康、session 是否存在或 runtime 是否已启动。

query 无参数、无副作用，不读取 filesystem、process/env、cwd、time，不访问 network，不使用 Bun 或 Node runtime API，不依赖第三方包或其他 Ariel workspace。当前无实例状态、外部依赖、资源或生命周期，不创建 Application service object 或 Runtime facade，也不创建 Promise、后台任务或 start/stop/dispose 接口。

CLI 默认启动直接调用并消费 core 返回的结构化状态；presentation 属于 CLI，core 不返回中文提示、help、stdout、stderr、exit code 或 CLI version。help、version 和未知参数路径不需要 application query。CLI 因真实调用声明 `@ariel/core: workspace:*`，不引入 local-host 或 providers dependency。

`getApplicationStatus()` 不是 generic capabilities registry。不引入 generic command/query dispatcher，也不增加未来能力字段。已批准的依赖方向不变；出现真实 adapter/resource 需求后仍由 local-host 承担 composition root。

## Consequences

- core 首次拥有真实且被 CLI 消费的 application contract；CLI 不再拥有 application fact，只负责显示。
- 当前接口极小、同步且无生命周期，可通过公共入口独立调用和测试，不需要 CLI、local-host 或 provider。
- 未来出现共享依赖或实例状态时，需要重新评估 service object。
- 未来出现 adapter/resource 生命周期时，需要重新评估 local-host composition API。
- 本 ADR 不批准 Session、Tool、Provider 或 Agent Loop 的未来结构，也不授权为其创建空接口或占位目录。

## Alternatives

- Application service object：当前没有实例状态或共享依赖，建立对象会增加没有实际需求的装配方式；延期至真实需求出现时重新评估。
- Runtime facade：当前没有 runtime、资源或生命周期，不需要统一 start/stop/dispose 边界；延期。
- generic command/query dispatcher：当前只有一个具名 query，没有路由或统一分发需求；保留直接函数调用，不建立 `execute(command)` 或 command/query bus。
