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

## Milestone 003 — Application Core Boundary

范围：建立默认 CLI invocation 到 core 的第一条真实 application query 调用链，不扩展产品能力。

验收目标：

- core 公共入口只新增 `ApplicationStatus` 与 `getApplicationStatus()`；返回 `{ agentExecution: "not-implemented" }`，表示当前尚未实现 Agent execution。
- query 同步、无参数、无副作用，无 Bun、Node、宿主、provider、第三方包或其他 workspace 依赖，无实例、后台任务和生命周期；保持独立类型隔离及 browser-target build。
- CLI 默认启动真实消费 core 返回值，负责中文 presentation；help、version、未知参数及默认输出与退出码保持不变，process 边界仍集中在 `bin.ts`。
- CLI 只新增真实的 `@ariel/core: workspace:*` dependency；允许依赖方向与现有 architecture gate 保持不变。
- 增加 core 公共契约与独立调用测试，保留 CLI 和 executable 行为测试及架构边界验证。
- 记录 Accepted ADR-005，并同步当前实现与长期开发文档。
- 实际执行安装、冻结锁文件安装、类型检查、lint、格式化、测试、build、CLI 与本地 executable 调用及 Git diff 检查。
- 不引入 Application service object、Runtime facade、generic dispatcher、capabilities registry 或 runtime/provider/session/tool/Agent Loop 结构。

## Milestone 004 — Model Interaction Boundary

范围：以 deterministic in-memory adapter 建立 CLI → local-host → core → ModelPort → providers adapter 的真实纵向调用链，验证离线模型交互边界，不集成实际 LLM。

验收目标：

- core 新增 `ModelRequest`、`ModelError`、`ModelResult`、`ModelPort` 与 `requestModelText`；保留 `ApplicationStatus` 的原有精确语义。
- `requestModelText` 拒绝空白 userText 且不调用 port；合法请求原样交给 port 恰好一次，原样传回结果，不改写 userText 或合并 systemText。
- 采用 `Promise<ModelResult>` 完整结果；公共错误类别仅有 core validation 的 `invalid-request` 与 adapter 预期失败的 `provider-failure`，不掩盖意外 throw/reject。
- providers 提供输入相关、确定性的 in-memory adapter；无网络、API key、配置、随机数、时钟或资源生命周期。
- local-host 装配真实 adapter 并调用 core；CLI 只因真实调用增加 `@ariel/local-host: workspace:*`，不直接依赖 providers。
- `runCli` 统一迁移为 `Promise<CliResult>`，bin.ts await 后处理 process 边界；唯一新增命令为 `model-demo <text>`，输出明确标识模拟演示，拒绝缺失与多余参数。
- 通过 core 手写 port 测试、真实 adapter/composition 测试和 async CLI/executable 测试验证调用链；保持现有 architecture gates、core `types: []` 和 browser-target build。
- 记录 Accepted ADR-006，区分 runtime control flow 与 source dependency direction，同步当前实现与长期开发文档。
- 实际执行安装、冻结锁文件安装、类型检查、lint、格式化、测试、build、CLI/local executable/build artifact 调用及 Git diff 检查。
- 不引入真实 provider SDK、streaming、cancellation、usage、model identity、retry、auth/config、session、tool 或 agent loop；真实 I/O 需求需重新审核。

## 后续阶段 — 待 Chief Architect 批准

范围、编号与具体验收目标待单独决策；不得将后续计划视为当前已实现能力，或据此提前实现业务。
