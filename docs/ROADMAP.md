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

## Milestone 005 — First Real Model Adapter Contract Review

状态：已完成契约审查并经 Chief Architect 审核通过；documentation-only architecture milestone。

范围：记录 Agent execution 的工程语义与延期决定，以及第一个真实 DeepSeek non-streaming text adapter 的实现契约；不新增 runtime capability。

验收目标：

- 新增 Accepted ADR-007，明确 application policy ownership、Agent boundary 延期原因与重新审核触发条件；M004 core model contract 与 `ApplicationStatus.agentExecution: "not-implemented"` 不变。
- [docs/DEEPSEEK.md](DEEPSEEK.md) 记录 2026-10-01 contract review，以及已批准的协议、model、模式、raw fetch 方向、request/response mapping、config、errors、secret hygiene 与 M006 测试要求。
- 完成 ADR-006 要求的 cancellation、model identity、usage 审查：core public contract 均继续延期；M006 transport deadline 必需，但没有批准具体 timeout 默认值。
- 现有 dependency direction、core result semantics 与 runtime lifecycle abstraction 不变，不新增 ADR-008。
- 不修改 production code、tests、package/lockfile，不增加 dependency、SDK、CLI command、env reading 或 API key handling，不调用 DeepSeek API。
- 同步架构与决策索引，实际运行 frozen-lockfile install、typecheck、lint、format check、tests、build 和 Git diff 检查。

## Milestone 006 — DeepSeek Model Adapter Implementation

状态：已完成。

范围：只实现 [DeepSeek implementation contract](DEEPSEEK.md) 所批准的单轮、非流式纯文本路径。Phase 1 仅实现代码与完全离线测试，不读取真实 API key 或调用真实 endpoint；不新增永久 demo command，不改变现有 in-memory demo。

实现与验证记录：offline implementation 与 tests 已完成，实现 commit 为 `4d3a2c9`（`feat: implement DeepSeek model adapter`）；GitHub CI #6 为 `completed` / `success`。2026-10-02 已完成一次明确授权的真实 DeepSeek smoke integration verification，返回 `completed`，integration exit code 为 `0`。这些历史事实由 Chief Architect 确认，详细记录见 [Real integration verification](DEEPSEEK.md#real-integration-verification)。

验收目标：

- 固定官方 HTTPS Chat Completions endpoint、`deepseek-flash`、thinking disabled、stream false，使用 raw fetch；local-host 显式传入 credential、model 与 `1..2147483647` integer milliseconds 的 timeoutMs，不读取 env。该范围是单个 timer 的 host-runtime bound，不是默认 timeout 或 product policy；越界和 fractional 配置 fail-fast，不 clamp 或分段计时。
- 保持 M004 core public contract，严格映射完整 final text 与预期 provider failures，保留 unexpected throw/reject；不自动 retry，不跟随 redirect，不暴露 reasoning。
- Deadline 覆盖连接、等待与 body consumption，到期实际 abort transport 并清理 timer；不将 `Promise.race()` 等同于 cancellation。
- Pure mapping 与 transport/request tests 进入普通 CI，禁止真实网络；真实 integration verification 只能在提供 credential 并明确授权后 opt-in，不进入默认 CI。
- 没有真实 integration evidence 时，不声称真实 DeepSeek connection 已完成验证；不增加 Agent、Session、Tool、streaming、public usage/identity/cancellation 或 retry/fallback。

## Milestone 007 — Single-Source Code Edit Proposal Contract

状态：contract established / implementation deferred（M007 的历史范围；后续实现见 M008/M009）。

范围：docs-only architecture milestone，依据 Chief Architect 已批准的契约建立第一个具名 application task；不实现 production code，不新增 tests、dependency 或 CLI command。

验收目标：

- 新增 Accepted [ADR-008](decisions/ADR-008-single-source-code-edit-proposal-task.md)，冻结 `CodeEditTask`、`CodeEditProposal`、`CodeEditError`、`CodeEditProposalResult` 与 `proposeCodeEdit(task, modelPort)` 的 public API 设计，尚不实现或导出。
- instruction 非空白、sourceText 为原始非空 string；invalid task 返回 `invalid-task` 且零次 ModelPort 调用，合法 task 最多且正常情况下恰好一次 model attempt，无 retry/repair/fallback。
- core 拥有 task instruction、内部 model request、private JSON encoding 与 acceptance policy；decoder 只接受 oldText/newText 两个 string 字段，oldText 在原始 sourceText exact-match 唯一，允许删除，拒绝 no-op。
- 明确 completed 只承诺一处唯一位置且产生文本变化的 proposal，不保证语义、语法、bug 修复、修改已应用或 tests 通过；ModelResult.failed 映射 model-failure，预期 proposal 校验失败映射 invalid-proposal，unexpected throw/reject 原样传播。
- ModelPort、ModelRequest、ModelResult 与 generic requestModelText 契约不变；四 workspace 职责与依赖方向不变，ApplicationStatus.agentExecution 保持 `"not-implemented"`。
- 不创建 runtime/executor/context、session/conversation/thread、tools/loop、文件或 Git 操作、generic patch engine、streaming/events/cancellation、public usage/cost/identity、routing/metadata/task-kind union、server protocol 或 TUI/REPL/IDE integration。
- 同步架构与决策索引；实际执行 typecheck、lint、format check、tests、build 与 Git diff 检查，确认 production diff 为空。

## Milestone 008 — Single-Source Code Edit Proposal Implementation

状态：implementation established；Chief Architect final review 不等于 milestone closure。

范围：实现 ADR-008 已冻结的 core application task，使用现有 ModelPort，保持 model contract 和 dependency direction 不变。

实现与验收目标：

- 从 core 公共入口导出 CodeEditTask、CodeEditProposal、CodeEditError、CodeEditProposalResult 与 proposeCodeEdit；不增加 path、credential、system prompt 或未来 API。
- Runtime input validation 保留原始 instruction/sourceText；invalid task 零次 port 调用，合法输入恰好一次 model attempt，无 retry/repair/fallback。
- Core 构造固定 application instruction 和 JSON user input；严格解码 oldText/newText，验证唯一 exact-match start position，包括重叠位置，允许删除，拒绝 no-op。
- Model failure 和预期 invalid proposal 返回独立 task failure；unexpected programming throw/reject 原样传播，JSON catch 只归一化 SyntaxError。
- Tests 从公共入口验证 ADR-008 semantics；ApplicationStatus 精确迁移为 `single-source-code-edit-proposal`。
- 不应用修改、不读写文件、不新增 CLI command；文件/用户入口属于 M009。

## Milestone 009 — First User-Facing Code Edit CLI

状态：user-facing implementation established；真实 smoke 结果与本地/远程验证分别记录，不以本地实现宣称 milestone closed。

范围：Ariel v0.1 的首个真实用户工作流：fresh clone → frozen-lockfile install → 配置自己的 DEEPSEEK_API_KEY → `bun run ariel edit <file> "<instruction>"` → validated proposal preview；不自动修改文件。

实现与验收目标：

- 新增 Accepted [ADR-009](decisions/ADR-009-first-user-facing-code-edit-cli.md)，只批准单文件、单 instruction、单 proposal 的 CLI workflow。
- edit 恰好接收两个 positional args，保留 default/help/version/in-memory model-demo；API key 仅由 executable edit boundary 读取，不持久化或输出。
- local-host 读取指定文件，按 cwd 解析 relative path，支持 absolute path，原样保留文本；空文件和读取错误在 model operation 前安全失败。
- local-host 显式装配 DeepSeek，固定 deepseek-flash；v0.1 host product timeout 为 `120000ms`，provider 自身仍无隐藏默认 timeout。
- core 独立验证 proposal，CLI 逐行显示 oldText/newText，明确 validation 的有限含义以及文件未修改。
- 参数/config/file-read/task/model/proposal 预期失败退出 1；unexpected error 继续由 bin.ts 最外层处理，不泄漏 stack、key、Authorization、完整源文件或 raw provider body。
- 普通 tests 使用 temporary files 与 mocked fetch，禁止真实网络或真实 key；live smoke 仅在显式授权和 credential available 时执行，不自动 retry，不进入默认 CI。
- README 给出真实安装、配置、运行与 proposal-only 说明；运行 typecheck/lint/format check/tests/build/Git diff checks，保持无依赖变化。

## v0.2 — Terminal-Native Interactive Coding Assistant

范围：正式 terminal-native TUI，默认打开 cwd，提供项目选择、lazy 文件树、只读源码、natural-language instruction、真实 DeepSeek proposal、Before/After、Reject、用户明确 Apply 和进程内 Undo。

实现与验收目标：

- 新增 apps/tui workspace，使用经过 Bun compatibility 验证的 Ink/React presentation，直接消费 local-host 公共入口；ADR-010 记录 terminal boundary，core public contract 与独立性不变。
- `bun run ariel` 默认进入 TUI；保留 --help/--version/edit/model-demo；一个 project path 与 Ctrl+O 选择项目，不创建 HTTP server 或 local daemon。
- Credential 仅由 executable composition boundary 从 DEEPSEEK_API_KEY 读取，不在 TUI 输入或持久化，不进入源码/fixture/log；model 固定 deepseek-flash，host 显式 120000ms timeout。
- Project canonical containment 覆盖 listing/read/apply/undo，拒绝 traversal、absolute file escape、symlink/hardlink；支持不超过 5 MiB 的 regular UTF-8 files，lazy tree 忽略生成目录。
- Generate 复用 core proposeCodeEdit，一次 attempt；第一次 Generate 前明确 privacy confirmation，不添加 loop/session/runtime。
- Keyboard-first 操作、帮助、上下文按键、只读 line-numbered code viewer、windowed scrolling、窄 terminal/resize 安全处理与 NO_COLOR。
- Before/After 只表示文本建议；Reject 不写文件；Apply 二次确认、hash stale check、再次 exact unique match、atomic write；Undo 只在 after hash/content 仍匹配时恢复。
- ADR-011 记录 frontend-neutral 写入/Undo ownership 与 atomic race/metadata 限制；内存状态不跨重启，不新增 history persistence。
- Alternate screen/input mode/cursor 在正常退出、Ctrl+C、:q 与异常时恢复；offline controller/keyboard/render/host/integration tests 禁止真实 provider。
- README 提供 fresh install/configure/build/start 和 keyboard workflow；最终真实 PTY 与授权次数内的 DeepSeek temporary-project smoke 分别记录，不冒充远程 CI。

状态与验收 evidence 以本地实现报告和 Chief Architect final review 为准，不以开发完成自动宣称 v0.2 closed。

## v0.2.1 — Stabilization + OpenAI-Compatible Provider

范围：修复已知 TypeScript tuple inference 与 TUI 连续输入问题，在现有 ModelPort 下新增 raw-fetch OpenAI-compatible Chat Completions adapter；不重写架构，不创建 Agent Runtime。

实现与验收目标：

- tests/code-edit-file.test.ts 的 tuple/Array inference 使用类型正确的最小修复，保持 strict，不用 any、忽略注释或双重断言掩盖问题。
- TUI input handler 从 controller 读取最新 state、同步维护 cursor，避免旧 React snapshot 使连续 Backspace/input、busy/modal/focus 判断失效。离线 keyboard 与真实 PTY 验证 Generate → Reject → 下一任务，以及 provider failure、invalid proposal、Apply、Undo、Help 之后仍可操作。
- providers 公共入口增加 createOpenAICompatibleModelPort 与 config：显式 baseUrl/model/timeoutMs、可选 apiKey；POST {baseUrl}/chat/completions，保留 API prefix，不猜 endpoint，不依赖 SDK。
- URL 仅允许 HTTPS 或 localhost/127.0.0.1/[::1] HTTP，拒绝远程 HTTP、非法 scheme、embedded credentials、query/fragment。原样 model/system/user、stream:false、无隐藏 prompt/tools/JSON mode、无 retry/fallback，独立完整 deadline 与 redirect:error。
- 从 unknown 验证最小 text response；非文本、tool/function output、不完整 finish_reason 和预期 HTTP/network/body/JSON/schema failure 安全返回 provider-failure；未知错误继续传播，不泄露 key、raw body、源码或 instruction。
- 新增 Accepted [ADR-012](decisions/ADR-012-configured-model-provider-composition.md)：有限 provider union 与 pure config parser 属于 host/composition；executable 显式读取 env，core/ModelPort 不知道 provider，不增加 Registry、Runtime、DI 或 plugin loading。
- ARIEL_PROVIDER 缺省仍 DeepSeek，显式 deepseek 保留 DEEPSEEK_API_KEY；openai-compatible 使用 required OPENAI_COMPATIBLE_BASE_URL/MODEL 与 optional API_KEY。未知 provider 安全失败，不 silently fallback；model-demo 保持 in-memory。
- CLI edit 与 TUI 使用同一 composition，保留 explicit 120000ms host timeout；TUI header/首次 Generate privacy 随 configured provider 更新，没有 model picker、key persistence 或 provider-specific function proliferation。
- 更新英文主 README 与中文 README；普通 CI 只跑 fake transport/temp-project tests，保留 DeepSeek fixed model/thinking/deadline/error regression。Compatible live smoke 仅在配置可用且本轮授权下最多一次；真实 smoke、本地验证和远程 CI evidence 分别报告，不据实现宣称 closure。

## 后续版本 — future / deferred

自动 apply、多文件自主修改、autonomous repository exploration、shell/tests/Git execution、Tool/loop、runtime/executor、Session/conversation persistence、streaming、retry/fallback、routing/registry、memory、MCP、LSP、browser GUI、HTTP server/daemon、IDE、remote execution、accounts/cloud sync/telemetry、Electron/Tauri、collaboration 与 npm publishing 均未批准。不提前设计这些能力的 API。
