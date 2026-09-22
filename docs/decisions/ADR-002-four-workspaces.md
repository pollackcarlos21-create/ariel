# ADR-002：四 workspace 架构

状态：Accepted

## Context

核心、provider adapter、本地宿主和前端具有不同职责，需要在最初建立可检查的边界，同时避免过度拆分。

## Decision

固定使用 Bun small monorepo 的四个 workspace：`apps/cli` → `@ariel/cli`、`packages/core` → `@ariel/core`、`packages/providers` → `@ariel/providers`、`packages/local-host` → `@ariel/local-host`。

每包具有独立 manifest、TypeScript 配置和显式公共入口。内部依赖使用 `workspace:*`。当前包均为 private，源码入口用于仓库内开发，不定义发布 API。

## Consequences

职责可分别验证，仍可在同一仓库一次安装和运行检查。禁止跨包深层导入。不增加 shared、common、utils 通用包或大量未来占位目录。

## Alternatives considered

- 单包：初期文件较少，但无法用 package 边界约束职责。
- 多仓库：增加版本、发布和联调成本。
- 更细的 workspace 拆分：当前没有实际需求，延期。
