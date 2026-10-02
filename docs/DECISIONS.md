# 架构决策索引

| ADR | 决策 | 状态 |
| --- | --- | --- |
| [ADR-001](decisions/ADR-001-typescript-bun-esm.md) | TypeScript + Bun + ESM | Accepted |
| [ADR-002](decisions/ADR-002-four-workspaces.md) | 四 workspace 架构 | Accepted |
| [ADR-003](decisions/ADR-003-dependency-direction.md) | 源码依赖方向与 core 独立性 | Accepted |
| [ADR-004](decisions/ADR-004-single-process.md) | 单进程优先、可嵌入核心、薄前端 | Accepted |
| [ADR-005](decisions/ADR-005-minimal-application-boundary.md) | 最小 Application Boundary | Accepted |
| [ADR-006](decisions/ADR-006-minimal-model-interaction-boundary.md) | 最小 Model Interaction Boundary | Accepted |
| [ADR-007](decisions/ADR-007-agent-execution-semantics-and-deferral.md) | Agent Execution Semantics and Deferral | Accepted |
| [ADR-008](decisions/ADR-008-single-source-code-edit-proposal-task.md) | Single-Source Code Edit Proposal Task | Accepted |
| [ADR-009](decisions/ADR-009-first-user-facing-code-edit-cli.md) | First User-Facing Code Edit CLI | Accepted |
| [ADR-010](decisions/ADR-010-terminal-native-tui-boundary.md) | Terminal-Native TUI Boundary | Accepted |
| [ADR-011](decisions/ADR-011-user-confirmed-file-apply-and-undo-semantics.md) | User-Confirmed File Apply and Undo Semantics | Accepted |

重要架构决策应在 `docs/decisions/` 新增 ADR，包含 Context、Decision、Consequences、Alternatives considered，并同步更新本索引和架构文档。上述决定由 Chief Architect 批准；“Accepted”不代表相关业务能力已经实现。

ADR-010 对 ADR-002 的 workspace 数量作有限更新，新增第五个 TUI workspace；对 ADR-003 增加 tui → local-host；仅解除 ADR-004 的 TUI 延期，保留单进程、core 独立、private workspace、explicit public exports、local-host composition 与薄前端规则。根目录 launcher 只选择 CLI/TUI 公共入口。旧 ADR 保留其已提交的历史文本；本 ADR 不批准 HTTP server 或 browser product。ADR-011 只批准 frontend-neutral 的显式 Apply/Undo，不改变 ADR-008 core proposal-only contract 或 ADR-009 CLI edit 行为。
