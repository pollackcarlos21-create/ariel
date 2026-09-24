# Ariel 阶段与验收目标

## Milestone 001 — Repository Foundation

状态：已完成并经 Chief Architect 审核通过；已提交为 `0729d19`。提交、push 和 GitHub CI 通过状态由项目负责人确认。

范围：工程基础，不包含 Coding Agent 业务功能。

验收目标：

- 恰好四个 workspace，显式公共入口、严格依赖方向、core 独立、无循环依赖。
- TypeScript strict、lint、自动格式化、Bun 单元测试基础设施、build 和 CI 配置可用。
- 实际执行安装、类型检查、lint、格式检查、测试、构建和 Git diff 检查。
- 架构文档、开发说明、agent 仓库规则和四份 Accepted ADR 完整。
- 工程实现阶段不创建 LICENSE、不实现延期功能；Git 提交与推送由项目负责人控制。

## Milestone 002 — CLI Foundation

状态：已完成并经 Chief Architect 审核通过。

范围：最小可执行 CLI，不包含 Coding Agent 业务能力。

验收目标及当前实现：

- `@ariel/cli` 提供 Bun executable entrypoint 和 `bin.ariel`，保持 ESM。
- `ariel --help` 显示帮助；`ariel --version` 读取 CLI manifest 的版本。
- `ariel` 显示真实的当前状态并正常退出；未知参数输出错误、退出码为 1，不显示 stack trace。
- 主要逻辑可直接调用测试，process 边界集中在 executable entrypoint。
- 单元测试覆盖输出及退出码，入口测试覆盖四个实际调用场景；保留原有架构门禁。
- 不增加第三方依赖、交互式 Agent 或 speculative API；同步实际结构和运行文档。

完成报告必须附实际类型检查、lint、格式化、测试、build、CLI 调用和 Git 检查结果。本地验证不等于远程 CI 已运行。

## 后续阶段 — 待 Chief Architect 批准

范围、编号与具体验收目标待单独决策；不得将后续计划视为当前已实现能力，或据此提前实现业务。
