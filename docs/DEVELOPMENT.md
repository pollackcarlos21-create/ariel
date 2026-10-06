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
bun run test:tui
bun run build
git status
git diff --check
git diff
```

- `bun run typecheck`：逐包独立执行 `tsc`，再检查测试代码。core 不会因为根测试使用 Bun 而跳过独立类型检查。
- `bun run lint`：Biome recommended lint，并将 warning 视为失败，显式禁止 `any`。
- `bun run format`：Biome 自动格式化其支持的源码和配置文件；Markdown、YAML 遵循 `.editorconfig` 并人工检查。
- `bun run format:check`：只检查格式，不改文件。
- `bun test`：Bun 原生测试，检查公共入口、exports、依赖图、源码边界、core application/model/code-edit contract、离线 adapter/composition、temporary-file host workflow、TUI controller/render/keyboard 和 CLI 行为。core 通过公共入口和手写 ModelPort 测试，不需要真实 provider、CLI 或配置。CLI tests 统一 await；入口 tests 启动 Bun 子进程检查输出流/退出码，edit tests 仅使用 fake credential 与 test-local fetch mock，不读取真实 key，不访问真实 DeepSeek 或 compatible endpoint。
- `bun run test:tui`：只运行 TUI controller、render/keyboard、入口与 lifecycle tests；使用同一个 Bun runner、temporary projects 与 Ink testing library，不调用真实 provider，不修改 core ambient types。普通 `bun test` 也包含这些 tests。
- `bun run build`：构建五个 workspace，再构建根 `ariel.ts` 到 `dist/ariel.js`。CLI 用 Bun 输出 `dist/index.js` 和 `dist/bin.js`；TUI 输出 external-packages Bun ESM entry；core/providers/local-host 输出其公共 API 的 `dist/index.js`。core 继续 browser target，TUI/root 运行需要已安装 workspace 与 Ink/React。build 不代替 TypeScript type checking。

Biome 同时提供 lint 与格式化；构建与 tests 使用 Bun。Ink 7.1.1、React 19.3.0 只用于 TUI presentation，ink-testing-library 4.0.0 只用于 root tests；不使用 browser renderer、Vite 或单独 browser test runner。架构检查复用已安装的 TypeScript parser，没有新增架构框架依赖。

TypeScript 固定为 5.9.3，使用成熟的稳定 compiler API 来解析架构测试中的源码；当前 TypeScript 7 的包入口不提供这套 API，因此本阶段不采用其 unstable API。升级编译器时需一并验证架构测试。根目录显式声明 core、providers、local-host、cli、tui 五个 workspace 开发依赖，用于测试公共入口以及具体 root launcher；不改变 workspace 的生产依赖方向。React JSX 类型只在 TUI 与 root presentation tests 启用，core types 仍为空。

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

`--unknown`、缺失 model-demo text、多余 model-demo 参数应退出 1；help/version/合法 model-demo 退出 0。无参数调用需要 interactive TTY，会进入 TUI，非 TTY 安全退出1；不要把交互入口作为自动脚本的状态查询。错误输出到 stderr，成功结果输出到 stdout。原有非命令选项路径保留未知参数与已知选项同时出现也报错、help 优先于 version、重复选项不改变结果。

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

`runCli` 统一返回 `Promise<CliResult>`，direct tests 必须 await。第二参数接受 parsed modelConfig，并保留旧 DeepSeek key 调用方式。runCli 不读取 process/env；bin.ts 只为 edit 从启动 env 取得显式配置、调用 pure host parser，await 后处理 stdout、stderr 和 process.exitCode。unexpected error 仍只由 bin.ts 最外层 catch 处理。不要保留 sync/async 两套入口或使用 `CliResult | Promise<CliResult>`。

CLI library 与 CLI workspace bin 的默认路径通过 core 的 `getApplicationStatus()` 消费精确 `single-source-code-edit-proposal` status 并生成中文提示。model-demo 仍通过 runInMemoryModelDemo 装配 in-memory adapter，不受 ARIEL_PROVIDER 影响；edit 通过 host 的 runConfiguredCodeEditFromFile 读取文件并调用 core proposeCodeEdit。core 维护 task policy/validation，CLI 维护用户文字/CliResult；help、version、参数错误不需要 status query。

model contract 测试用小型手写 ModelPort 验证调用次数、原始 request 的同一性、systemText 保留、结果原样返回、空白输入不调用 port、空 completed text 和结构化 provider-failure。意外 throw/reject 不应被伪装成成功。adapter/composition 测试直接调用真实 in-memory adapter 与 local-host，检查输入相关的确定性输出，不需要 API key、环境变量或配置 setup。in-memory adapter 不解释 systemText；该字段的原样传递在 core boundary 测试中验证。无需 module mock、全局状态、通用 contract test framework 或 DI container。

## Code-edit task 与文件 workflow

M008 的 `proposeCodeEdit(task, modelPort)` 测试使用手写 port，从 core 公共入口验证 runtime 输入类型、原始文本、application-owned request、一次调用、JSON/schema、唯一 exact-match（含重叠位置）、删除、no-op 和 unexpected exception identity。测试不依赖完整 private prompt 文本，也不加入真实网络、provider 或 host setup。

M009 的 `ariel edit <file> "<instruction>"` 是真实网络入口，v0.2.1 按启动配置选择 DeepSeek 或 OpenAI-compatible。完整用户步骤见 [English README](../README.md) 与 [中文 README](../README.zh-CN.md)。不要把真实 edit 放进常规 offline regression commands。非交互 CLI default/help/version/model-demo 不读取模型配置或调用真实 provider；root launcher 的 TUI 路径解析本地 configured status，但只有用户确认 Generate 才调用 provider。

`runConfiguredCodeEditFromFile(filePath, instruction, provider)` 在 local-host 只读取一个文件，relative path 按 process cwd 解释，absolute path 直接读取。旧 runDeepSeekCodeEditFromFile wrapper 保留兼容。原始 sourceText 交给 core；empty file 在 model operation 前失败，whitespace-only file 合法。该 CLI operation 不写文件，不进行 shell、用户项目 tests 或 Git operations。

Offline host/CLI tests 使用 temporary directories/files 与 test-local fetch spy；只提供明显 fake credential，验证两个 provider 的实际 request body、DeepSeek fixed model、compatible configured model、120000ms policy、safe failures、multiline/deletion preview 和文件内容未改变。Executable tests 提供隔离的显式 env fixture，不继承用户真实 credential，不向真实 endpoint 发送请求。测试不能修改 repository source，必须清理临时文件/目录并恢复 fetch，不能增加 production failure hook。

Success preview 只显示 oldText/newText，明确 `Proposal validated.` 与 `No files were modified.`，不声称代码已修复或 tests 通过。Expected config/read/task/model/proposal failures 退出 1、stdout 为空；unexpected exception 继续传播到 bin.ts generic boundary。

## DeepSeek 离线开发与验证

`@ariel/providers.createDeepSeekModelPort(config)` 和 generic `@ariel/local-host.runDeepSeekModelRequest(request, config)` 保持显式 credential/model/timeout，均不读取 env。Provider timeoutMs 必须为 `1..2147483647` 的整数毫秒，非法配置同步 fail-fast；这是 single-timer 的表达范围，provider 没有隐藏默认值，不 clamp 或分段计时。M009 edit workflow 在 local-host 建立独立 product default `120000ms`，明确传给 factory，不改变 generic operation 的显式 config。

`tests/deepseek-model.test.ts` 通过公共入口，用 deterministic response fixtures 和 test-local global fetch spy 验证配置、精确 request mapping、required response structure、completion/error mapping、独立 deadline 与 composition。该组使用 `describe.serial`，每次测试恢复 fetch，禁止真实网络、真实 credential 或 production test hook。deadline tests 分别验证 headers 前和 body consumption 期间实际 abort，以及结束后的 timer cleanup；上限配置测试只构造 factory，不等待长 timer。

普通 `bun test` 包含这些离线测试，没有默认运行的 live test。2026-10-02 已在明确授权下，于 commit `4d3a2c9` 完成一次真实 DeepSeek successful smoke verification，历史证据与验证边界见 [Real integration verification](DEEPSEEK.md#real-integration-verification)。该次成功调用没有验证真实 DNS/TLS failure classification、服务端取消或计费行为。

未来任何 live verification 仍必须 opt-in，遵循当前用户的明确授权与显式配置，不进入默认 CI，不成为常规开发命令。默认安装、测试与 CI 不得隐式调用真实 provider。Live verification 不打印 key、Authorization、完整 provider body 或完整 model request/sourceText；edit 只显示 task 已接受的 proposal preview，不断言固定自然语言答案。

## OpenAI-compatible 与配置的离线验证

`createOpenAICompatibleModelPort(config)` 使用 raw fetch，不增加 SDK。测试从公共入口验证 baseUrl joining、完整 API prefix、trailing slash、exact model/user/system mapping、stream:false、有/无 Authorization、零 retry、redirect:error、string/whitespace text 和所有预期 HTTP/network/body/timeout/JSON/schema failure；错误不得包含 fake key、raw body、source 或 instruction。Unexpected programming throw/rejection identity 保持原样。

URL cases 覆盖 HTTPS、localhost/127.0.0.1/[::1] HTTP、远程 HTTP 拒绝、invalid scheme/malformed URL、embedded credentials、query/fragment 拒绝。timeout validation 覆盖 integer range、fractional/overflow fail-fast；deadline 覆盖 fetch/headers/full body，并验证实际 abort 与 finally cleanup，不用 Promise.race 代替 transport cancellation。

Pure `parseArielModelConfig(env)` tests 显式提供 env record，验证缺省 DeepSeek、显式 DeepSeek、missing/whitespace key、compatible required base/model、optional key、unknown provider、安全错误与不 silently fallback；parser/host/providers 不读取 process.env。CLI/TUI 使用相同配置结果，DeepSeek 与 compatible composition 都通过 fake fetch 验证。保留 DeepSeek thinking disabled、deepseek-flash、stream:false、deadline 和 safe failures 的原有 regression。

只有 root launcher 与 CLI executable 读取 ARIEL_PROVIDER、DEEPSEEK_API_KEY、OPENAI_COMPATIBLE_BASE_URL、OPENAI_COMPATIBLE_MODEL、OPENAI_COMPATIBLE_API_KEY。TUI runtime/controller 仅接收显式结果；没有 TUI model picker、config file、credential persistence 或 generic provider framework。两个 code-edit workflow 仍由 host 显式提供 120000ms product timeout，provider factories 没有隐藏默认 timeout。

Compatible live smoke 在本轮明确授权、offline 全绿且 endpoint/model 可用时最多一次：无隐私 temporary source → TUI Generate → validated proposal → Reject → 继续操作。缺失配置报告 BLOCKED，不要求把 key 贴进聊天；失败记录真实结果、不自动重试、不放宽 ADR-008。API key 可缺失，但不因此对未知 endpoint 进行探测。

## TUI 开发与验证

Root launcher `ariel.ts` 通过两个公共 frontend 入口选择：无参数/一个 project path 调用 `@ariel/tui.launchTui({ projectPath, modelConfig, noColor? })`；其他命令/选项调用 `@ariel/cli.runCli`。它不是新 workspace 或 generic command framework，也不建立 CLI → TUI 依赖。原 launchTui apiKey option 保留 DeepSeek 兼容方式。

```sh
bun run build
bun run ariel
bun run ariel /path/to/project
```

Framework 选择依据于 2026-10-02 实查官方 [Ink 7.1.1 source](https://github.com/vadimdemedes/ink/tree/70af033dbd2b126a16f144164685612b2c1fd554) 与 package manifest，并在 Bun 1.4.2 temporary-project PTY prototype 验证 Unicode、keyboard、resize、alternate-screen/cursor/input restoration；依赖 lockfile 固定实际安装版本。该 prototype 只证明 library compatibility，产品 lifecycle 仍须另做 PTY smoke。

主入口需要 interactive stdin/stdout。默认 project 为当前 cwd；Ctrl+O 可输入本地 project path。Root executable 显式解析启动模型配置与 NO_COLOR，传给 TUI；TUI controller/runtime 和 provider 不读取 env。bunfig 禁止自动 `.env` loading。缺失/非法配置仍可本地浏览，Generate 显示配置错误而不请求网络；不在界面输入/存储 key。Header 随 provider 显示 DEEPSEEK 或 OPENAI-COMPAT，CONFIGURED 只表示本地配置，不代表实际认证或网络健康。

Ink/React 仅负责 terminal presentation。目录按展开 lazy loading；code/diff 只 render 当前 viewport。宽度小于 90 cols 改为单栏，用 focus 选择 tree/code；最小 `60 × 20`，低于时显示 resize 提示。箭头/Enter tree navigation，Tab focus，G task，Ctrl+J multiline，Enter Generate，?help，A→Enter confirmed Apply，R Reject，U guarded Undo，Ctrl+C/:q Quit。Task focus 不把正常输入字母当成 shortcut。

第一次 Generate 前显示 source 将发送 configured model provider 的 privacy confirmation 和 provider 名，每进程一次；取消不得调用 model。Generation 使用现有 core acceptance 与 host configured composition，一次 attempt，不 retry/repair/fallback。Apply 明确二次确认；Undo 检查 after snapshot；CLI edit 保持不写文件。所有写入由 host project boundary 实施，TUI 不直接读取/写入 filesystem。

```sh
bun run test:tui
```

TUI-specific tests 验证 controller transitions、lazy tree、selected source、instruction preservation、privacy gate、busy state、proposal/diff、Reject、Apply confirmation、actual file change、Undo exact restoration、配置/读取/model/proposal/stale failures；render/keyboard tests 验证 focus、键盘、帮助、多行、窄 terminal、NO_COLOR 和 safe control-character display。Transport 仅 test-local fetch mock，model composition 可使用明确的 frontend-local fake callback；不在 provider 创建测试 hook，不读取真实 credential、不访问真实网络。

连续任务 regression 必须使用真实 keyboard input 验证 first Generate → proposal → Reject → second instruction → second Generate，且 provider failure、invalid proposal、Apply、Undo 和 Help → Esc 后仍能编辑。v0.2.1 修复的根因是 input callback 使用旧 React render snapshot：连续 Backspace/input 会反复读取旧 instruction/cursor，留下旧字符或旧 busy/modal/focus 判断。Handler 从 controller 读取最新 state，cursor 使用同步 ref；不能仅清空 input 或重新挂载界面绕过问题。

最终必须在真实 PTY 启动主入口，实际检验 alternate screen、navigation、task entry、help、resize、退出与 cursor/raw input restoration，并验证 model completion/error 之后仍可继续输入与 Generate。普通 rendered text tests 不能证明真实 terminal lifecycle。Root build 后也检查 `bun dist/ariel.js` 主入口；`bun apps/cli/dist/bin.js` 仍属于 legacy 非交互 CLI。

Live TUI smoke 只在用户明确授权且 credential available 时运行，使用无隐私 temporary project，遵守该次调用次数上限；验证真实 proposal → diff → confirmed Apply → Undo exact bytes。不能因 output 格式失败自动重试或放宽 ADR-008，缺失 key 明确报告 BLOCKED，不冒充 success。

## 包解析与边界

跨包使用 `@ariel/core` 等公共包名，不直接导入其他 workspace 的 `src`。包内源码入口直接供 Bun 和 TypeScript 解析，因此测试不依赖预先 build；所有包当前都为 private，不发布。

新增 TUI boundary 见 ADR-010：tui 只 import local-host 公共入口，不直接 import core/providers，不使用 filesystem modules、Bun.file/write/spawn 或直接 env access。Terminal runtime 可使用必要的TTY/process APIs。Architecture gates 检查五包 graph、显式exports、declared dependencies、cross-package深层/relative escape 与 core isolation；root concrete launcher 从已声明的公共入口选择frontend，不成为workspace依赖表里的反向边。

修改架构时同时更新文档、ADR 和测试中的允许依赖表。不得为了通过检查而放宽 strict、关闭规则、使用 `any` 或 `@ts-ignore`、删除测试或跳过 build。

## CI 与 Git

GitHub Actions 在 push 和 pull request 时按顺序执行 `bun install --frozen-lockfile`、`bun run typecheck`、`bun run lint`、`bun run format:check`、`bun test`、`bun run test:tui`、`bun run build`。Bun tests 包含TUI/host 离线 integration，test:tui 单独重验具体 TUI 文件；均不调用真实 provider。新增或更新依赖时应包含对应 `bun.lock` 变更。本地通过不等于远程 CI 已执行。

新增文件在 git add 前为 untracked，`git diff` 与 `git diff --check` 不会覆盖这些文件。必须结合 `git status --untracked-files=all`、逐文件检查以及必要的 `git diff --no-index /dev/null <文件>` 审阅新增内容，不得将空 diff 当作没有新增文件的证据。

Git 操作遵循 `AGENTS.md` 和当前任务授权。安装目录、构建产物、coverage、环境文件及常见本地杂项由 `.gitignore` 排除。
