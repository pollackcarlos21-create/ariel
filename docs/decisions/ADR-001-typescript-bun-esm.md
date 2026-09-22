# ADR-001：TypeScript + Bun + ESM

状态：Accepted

## Context

Ariel 需要一套能支持长期维护、类型约束和快速本地验证的基础工具链。当前仅建立工程基础。

## Decision

采用 TypeScript、strict 类型检查、Bun 和 ESM。Bun 用于依赖管理、workspace、测试和构建；`tsc` 独立检查类型。core 公共契约不绑定 Bun。

## Consequences

减少运行时与开发工具数量，统一 ESM 模块约定。必须分别验证类型检查和构建，Bun 的转译成功不代表类型正确。core 使用独立配置，防止宿主全局类型进入公共契约。

## Alternatives considered

- JavaScript：缺少当前要求的静态类型约束。
- Node.js 配合多个开发工具：可行，但本阶段选择统一的 Bun 工具链。
- CommonJS 或 ESM/CommonJS 双格式：增加维护面，本阶段不采用。
