# Ariel 仓库规则

本文件适用于整个仓库。默认用中文向项目负责人汇报；代码标识符、命令、API 和技术术语可使用英文。

## 修改前

- 先阅读 `docs/ARCHITECTURE.md`、`docs/ROADMAP.md`、相关 ADR 和相关代码，再修改文件。
- 检查 `git status` 与现有 diff，保留已有工作。
- 每次任务的具体 milestone 和 scope 由当前任务说明、`docs/ROADMAP.md` 和已批准架构决定。不得擅自扩大任务范围。

## 包边界

- 仅有 `@ariel/core`、`@ariel/providers`、`@ariel/local-host`、`@ariel/cli` 四个 workspace；不得擅自增加 workspace 或 shared/common/utils 通用包。
- 允许的直接依赖：cli → core、local-host；local-host → core、providers；providers → core；core → 无。
- 不得新增循环依赖，内部依赖统一使用 `workspace:*`。
- 跨包只能使用显式公共导出；不得通过相对路径、绝对路径、别名或包的深层路径访问其他包源码。
- core 必须宿主和前端无关，不得依赖 CLI、TTY、宿主或 provider 实现，不得引用 Bun runtime、provider SDK、HTTP server、数据库、文件系统或 shell 的具体实现。
- Bun 可以用于开发、测试和 local-host，不能进入 core 的公共契约。
- local-host 承担 composition root 职责；CLI 保持薄前端；providers 负责显式 adapter 边界。
- 不得为了未来可能需求提前创建 speculative API；新增公共 API 必须服务当前已批准的真实需求。

## 架构与质量

- 架构改变必须更新 `docs/ARCHITECTURE.md`，重要架构决策必须新增 ADR 并更新 `docs/DECISIONS.md`。
- 保持 strict TypeScript；不得通过使用 `any`、`@ts-ignore`、关闭 lint rule、跳过或删除测试等方式掩盖问题。
- 不得用 Bun build 代替 TypeScript type checking。
- 完成任务必须实际运行 `docs/DEVELOPMENT.md` 中的全部验证命令；失败时调查并修复本次修改造成的问题。
- 只报告实际执行的检查，明确区分本地验证与远程 CI，不得声称未运行的检查已经通过。
- 许可证尚未做出架构决策。在 Chief Architect 明确批准前，不得新增或修改 LICENSE。
- 不得自行执行 commit、push、`git reset --hard`、`git clean -fd` 或修改 remote，除非当前任务明确授权。
