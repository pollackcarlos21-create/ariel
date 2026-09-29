# 开发与验证

## 环境

使用 Bun 1.4.2 与 Git。根目录 `packageManager` 和 CI 固定 Bun 1.4.2；安装依赖的精确版本记录在 `package.json`，传递依赖由 `bun.lock` 锁定。

先执行 `bun --version`。若已安装但当前 shell 找不到 Bun，请确认安装目录在 PATH；不要让 coding agent 未经授权进行系统级安装。

修改前先阅读 `AGENTS.md`、`docs/ARCHITECTURE.md`、相关 ADR 和代码，检查 `git status`、`git diff`。

## 命令

从仓库根目录执行：

```sh
bun install
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run format
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
- `bun test`：Bun 原生测试，检查公共包入口解析、exports 封装、依赖图、源码架构边界、core application/model contract、离线 adapter/composition 及 CLI 行为，包含违规反例。core 测试通过公共入口调用，model contract 使用手写 ModelPort，不需要真实 provider、CLI 或配置。CLI 主逻辑统一 `await runCli(...)`；入口测试启动 Bun 子进程，检查参数、输出流和退出码，无需真实 terminal。
- `bun run build`：逐包用 Bun 输出 ESM。CLI 输出 `dist/index.js` 和 `dist/bin.js`；core、providers、local-host 分别输出包含实际公共 API 的 `dist/index.js`。core 继续使用 browser target。build 不进行 TypeScript 类型检查，必须另外执行 typecheck。

Biome 同时提供 lint 与格式化，减少独立工具和配置；Bun 自带测试及 bundler，因此不引入额外测试框架或构建编排器。架构检查复用已安装的 TypeScript parser，没有新增架构框架依赖。

TypeScript 固定为 5.9.3，使用成熟的稳定 compiler API 来解析架构测试中的源码；当前 TypeScript 7 的包入口不提供这套 API，因此本阶段不采用其 unstable API。升级编译器时需一并验证架构测试。根目录显式声明四包的开发依赖，仅用于测试其公共入口，不改变 workspace 之间的生产依赖方向。

## CLI 开发与执行

从仓库根目录执行：

```sh
bun run ariel --help
bun run ariel --version
bun run ariel
bun run ariel --unknown
bun run ariel model-demo "hello"
bun run ariel model-demo
bun run ariel model-demo "a" "b"
```

`--unknown`、缺失 model-demo text、多余 model-demo 参数应退出 1；其余上述调用退出 0。错误输出到 stderr，成功结果输出到 stdout。非 demo 路径保留未知参数与已知选项同时出现也报错、help 优先于 version、重复选项不改变结果的行为。

`model-demo` 恰好接收一个 text 参数，命令后的第一个 token 作为原始 text，不解析模型选项；多词文本需要 shell 引号。空白 text 由 core validation 拒绝。成功示例输出为：

```text
in-memory 模拟演示（未调用真实模型）。
Echo: hello
```

这是 deterministic in-memory simulation，不需要网络、API key、认证或配置，不支持 stdin、REPL、`--system` 或其他模型选项。

`apps/cli/package.json` 的 `bin.ariel` 指向带有 `#!/usr/bin/env bun` 的 `src/bin.ts`。`bun install` 后可执行 `./node_modules/.bin/ariel --help`，也可将该目录临时放入当前命令的 PATH：

```sh
PATH="$PWD/node_modules/.bin:$PATH" ariel --help
```

源码入口不依赖预先 build，不需要全局安装。构建后可执行：

```sh
bun apps/cli/dist/bin.js --help
bun apps/cli/dist/bin.js --version
bun apps/cli/dist/bin.js
bun apps/cli/dist/bin.js --unknown
bun apps/cli/dist/bin.js model-demo "hello"
bun apps/cli/dist/bin.js model-demo
bun apps/cli/dist/bin.js model-demo "a" "b"
```

版本只在 CLI package.json 中维护；JSON import 会将其纳入构建产物，修改版本后需重新 build。CLI 和根测试 tsconfig 的 `resolveJsonModule` 用于检查这个 JSON import，未改变基础或 core 配置。

修改 workspace 的 bin 或 dependencies 时应同步 Bun 锁文件的对应元数据，并通过 `bun install --frozen-lockfile` 检查 manifest 与锁文件一致。Bun 1.4.2 沿用旧锁文件时可能不自动登记新增 bin；应检查锁文件中的 bin 元数据与安装后的本地 executable。

`runCli(args)` 统一返回 `Promise<CliResult>`，direct tests 必须 await，包括 default、help、version 和错误路径；`bin.ts` await 后才处理 stdout、stderr 和 process.exitCode。不要保留 sync/async 两套入口或使用 `CliResult | Promise<CliResult>`。

默认启动路径通过 `@ariel/core` 公共入口调用 `getApplicationStatus()`，读取结构化 `agentExecution` 并生成中文提示。model-demo 路径调用 local-host 的 `runInMemoryModelDemo`，由其装配 providers adapter 并调用 core `requestModelText`。core 维护契约与输入校验，CLI 维护用户文字与 `CliResult`；help、version 和参数错误不需要 application status query。

model contract 测试用小型手写 ModelPort 验证调用次数、原始 request 的同一性、systemText 保留、结果原样返回、空白输入不调用 port、空 completed text 和结构化 provider-failure。意外 throw/reject 不应被伪装成成功。adapter/composition 测试直接调用真实 in-memory adapter 与 local-host，检查输入相关的确定性输出，不需要 API key、环境变量或配置 setup。in-memory adapter 不解释 systemText；该字段的原样传递在 core boundary 测试中验证。无需 module mock、全局状态、通用 contract test framework 或 DI container。

## 包解析与边界

跨包使用 `@ariel/core` 等公共包名，不直接导入其他 workspace 的 `src`。包内源码入口直接供 Bun 和 TypeScript 解析，因此测试不依赖预先 build；所有包当前都为 private，不发布。

修改架构时同时更新文档、ADR 和测试中的允许依赖表。不得为了通过检查而放宽 strict、关闭规则、使用 `any` 或 `@ts-ignore`、删除测试或跳过 build。

## CI 与 Git

GitHub Actions 在 push 和 pull request 时执行同一套检查，安装使用 `bun install --frozen-lockfile`。新增或更新依赖时应包含对应 `bun.lock` 变更。本地通过不等于远程 CI 已执行。

新增文件在 git add 前为 untracked，`git diff` 与 `git diff --check` 不会覆盖这些文件。必须结合 `git status --untracked-files=all`、逐文件检查以及必要的 `git diff --no-index /dev/null <文件>` 审阅新增内容，不得将空 diff 当作没有新增文件的证据。

Git 操作遵循 `AGENTS.md` 和当前任务授权。安装目录、构建产物、coverage、环境文件及常见本地杂项由 `.gitignore` 排除。
