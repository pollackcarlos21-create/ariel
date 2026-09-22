# ADR-004：单进程优先、可嵌入核心、薄前端

状态：Accepted

## Context

Ariel 第一阶段需要保留核心可嵌入性，又不应提前承担服务通信、多进程或多前端的复杂度。当前 milestone 不实现运行架构本身。

## Decision

批准的运行方向为单进程 + 可嵌入核心 + 显式 adapter + 薄 CLI。local-host 作为 composition root 装配核心和具体 adapter；providers 隔离外部模型服务的实现细节；CLI 保持入口与交互职责。

本 milestone 只记录边界，不新增装配 API、provider 接口或 agent loop。

## Consequences

减少初期部署及通信复杂度，后续核心不必绑定 CLI 或本地宿主。单进程不是安全隔离机制；任何进程隔离或服务化设计需另行决策。

HTTP server、WebSocket、SDK、TUI、IDE integration、Desktop、Plugin system 均延期。

## Alternatives considered

- 服务优先或多进程架构：当前没有获批需求，增加通信与生命周期管理成本。
- CLI 内实现所有逻辑：损害核心可嵌入性，不采用。
- 提前建立所有前端和插件接口：缺少实际需求，容易伪造契约，不采用。
