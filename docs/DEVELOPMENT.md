# 开发与验证

## 环境

使用 Bun 1.4.2 与 Git。根目录 `packageManager` 和 CI 固定 Bun 1.4.2；安装依赖的精确版本记录在 `package.json`，传递依赖由 `bun.lock` 锁定。

先执行 `bun --version`。若已安装但当前 shell 找不到 Bun，请确认安装目录在 PATH；不要让 coding agent 未经授权进行系统级安装。

修改前先阅读 `AGENTS.md`、`docs/ARCHITECTURE.md`、相关 ADR 和代码，检查 `git status`、`git diff`。

## 命令

从仓库根目录执行：

```sh
bun install
bun run typecheck
bun run lint
bun run format:check
bun test
bun run build
git status
git diff --check
git diff
```

- `bun run typecheck`：逐包独立执行 `tsc`，再检查测试代码。core 不会因为根测试使用 Bun 而跳过独立类型检查。
- `bun run lint`：Biome recommended lint，并将 warning 视为失败，显式禁止 `any`。
- `bun run format`：Biome 自动格式化其支持的源码和配置文件；Markdown、YAML 遵循 `.editorconfig` 并人工检查。
- `bun run format:check`：只检查格式，不改文件。
- `bun test`：Bun 原生测试，检查公共包入口解析、exports 封装、依赖图及源码架构边界，包含违规反例。未来单元测试可沿用 `*.test.ts`。
- `bun run build`：逐包用 Bun 输出 ESM 到各自 `dist/index.js`。当前模块无业务行为，空 bundle 属正常结果。build 不进行 TypeScript 类型检查，必须另外执行 typecheck。

Biome 同时提供 lint 与格式化，减少独立工具和配置；Bun 自带测试及 bundler，因此不引入额外测试框架或构建编排器。架构检查复用已安装的 TypeScript parser，没有新增架构框架依赖。

TypeScript 固定为 5.9.3，使用成熟的稳定 compiler API 来解析架构测试中的源码；当前 TypeScript 7 的包入口不提供这套 API，因此本阶段不采用其 unstable API。升级编译器时需一并验证架构测试。根目录显式声明四包的开发依赖，仅用于测试其公共入口，不改变 workspace 之间的生产依赖方向。

## 包解析与边界

跨包使用 `@ariel/core` 等公共包名，不直接导入其他 workspace 的 `src`。包内源码入口直接供 Bun 和 TypeScript 解析，因此测试不依赖预先 build；所有包当前都为 private，不发布。

修改架构时同时更新文档、ADR 和测试中的允许依赖表。不得为了通过检查而放宽 strict、关闭规则、使用 `any` 或 `@ts-ignore`、删除测试或跳过 build。

## CI 与 Git

GitHub Actions 在 push 和 pull request 时执行同一套检查，安装使用 `bun install --frozen-lockfile`。新增或更新依赖时应包含对应 `bun.lock` 变更。本地通过不等于远程 CI 已执行。

首次提交前所有文件均为 untracked，`git diff` 与 `git diff --check` 不会覆盖这些文件。必须结合 `git status --untracked-files=all`、逐文件检查以及必要的 `git diff --no-index /dev/null <文件>` 审阅新增内容，不得将空 diff 当作没有新增文件的证据。

本 milestone 不执行 commit、push、reset --hard、clean -fd，不改变 remote；由项目负责人决定提交。安装目录、构建产物、coverage、环境文件及常见本地杂项由 `.gitignore` 排除。
