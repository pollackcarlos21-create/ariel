# ADR-010：Terminal-Native TUI Boundary

状态：Accepted

## Context

Ariel 已实现 ADR-008 的 Single-Source Code Edit Proposal task、真实 DeepSeek adapter 和 ADR-009 的 proposal-only CLI。当前批准的产品形态为 terminal-native interactive coding interface：在 terminal 打开项目、选择源码、输入 instruction、审阅建议，并在明确确认后 Apply/Undo。

交互需要 terminal presentation、keyboard input 和可靠 process lifecycle；filesystem authority 仍属于 local-host，task policy 仍属于 core。不因此引入 HTTP transport、local daemon、browser frontend、AgentRuntime 或 Session。

## Decision

### 五 workspace 与有限架构更新

新增 `apps/tui`（`@ariel/tui`）作为第五个 private workspace，仅依赖 `@ariel/local-host: workspace:*`。本 ADR 对 ADR-002 的固定四包数量作有限更新，对 ADR-003 的允许表增加 tui → local-host，仅解除 ADR-004 的 TUI 延期。其余已批准原则继续有效，已提交 ADR 的历史文本保留。

```text
tui        -> local-host
cli        -> core, local-host
local-host -> core, providers
providers  -> core
core       -> 无
```

所有包保持显式 `.` 公共入口、strict TypeScript 和 acyclic dependency graph。TUI 不 import core/providers 或跨包源码；CLI 不 import TUI；不新增 shared/common/utils workspace。

根目录 `ariel.ts` 是具体 executable launcher，通过 `@ariel/cli` 与 `@ariel/tui` 公共入口选择 frontend：无参数或一个 project path 启动 TUI，其余已支持 CLI 路径继续由 runCli 执行。Root script `bun run ariel` 使用此 launcher；CLI workspace 的 `bin.ariel -> ./src/bin.ts` 保留现有非交互 executable 行为。当前不批准全局安装或 npm packaging，不增加 routing framework、generic dispatcher 或新 workspace。

### Presentation 与 composition ownership

- TUI 使用经过 Bun 1.4.2 compatibility 验证的 Ink/React terminal presentation，拥有布局、focus、keyboard、task input、readonly source/diff、privacy/Apply confirmation、status 和 safe error UX。
- local-host 拥有 canonical project root、lazy directory listing、UTF-8 read、source snapshot、DeepSeek composition 与明确 Apply/Undo。
- core 保持 `proposeCodeEdit(task, modelPort)` 的 input、application-owned request 和 proposal acceptance；不知道 terminal、path、filesystem、env、credential 或 provider。
- providers 保持 raw fetch/wire mapping，不读取 env，不新增 product prompt、retry 或 hidden timeout。

Ink/React state 与 TUI controller state 是当前 frontend process 的 operation state，不是 core application state、Session 或持久 conversation。Directory 按需展开，不递归预读 repo；code/diff viewer 只渲染当前窗口的行，不在每次 keypress 重读文件或扫描项目。

### 用户入口与 keyboard-first workflow

`bun run ariel` 直接进入 full-screen TUI，默认 project 为 cwd；一个 project path 或 Ctrl+O 显式选择项目。保留非交互 `--help`、`--version`、`edit <file> "<instruction>"` 与 in-memory `model-demo <text>`；CLI edit 仍只显示 proposal，不写文件。

TUI 使用方向键/Enter 浏览 tree，Tab 切换 focus，G 聚焦 task，Enter Generate，A 打开 Apply 确认、Enter 确认、Esc 取消；R Reject、U guarded Undo、? 帮助、Ctrl+C 或 `:q` 退出。Task input 的文字按原样解释，不把输入字母当成 Apply/Reject shortcuts。支持可靠的 multiline binding，不依赖所有 terminals 都能区分 Shift+Enter。

宽 terminal 双栏，窄 terminal 单栏/切换 tree，低于安全尺寸显示 resize 提示。Unicode box drawing、克制的 ornaments 与 theme tokens 建立 retro terminal 层次；支持 ANSI 256 colors，NO_COLOR 禁用彩色，删除/新增仍用 `-`/`+` 区分。Preview 转义 terminal control characters，只改变 presentation，不改写真实 source/proposal。

### Credential 与 privacy

Executable composition 从启动环境显式读取 `DEEPSEEK_API_KEY` 并传入 frontend/host，不自动加载 `.env`、不要求在 TUI 输入或保存 key，不打印 key/Authorization/完整环境。缺失 key 不阻止启动和本地浏览，但 Generate 显示配置错误且零次 model request。

第一次 Generate 前明确显示 selected source code 会发送 DeepSeek；Enter Continue、Esc Cancel。每进程只确认一次，切换项目不构成后台上传权限。只有用户实际 Generate 才发送所选单文件源码与 instruction。

复用固定 `deepseek-flash`、thinking disabled、non-streaming adapter。Host 显式传入 `120000ms` product timeout；provider 仍要求显式配置，没有隐藏默认值、retry、repair、fallback、routing 或 streaming。

### Proposal、Apply 与 Undo

Generate 复用 core task，一次 model attempt，显示 Before/After 或 patch-like diff 与 `PROPOSAL VALIDATED`。该状态只承诺 ADR-008 的唯一 exact-match 与文本变化，不保证语义、语法、bug fixed 或 tests passed。

Reject 不写文件。Apply 必须独立二次确认，host 校验 source snapshot、hash、unique anchor 并 atomic replacement；Undo 必须检查 applied snapshot，不覆盖外部修改。Durable filesystem semantics、supported files 与 portable atomicity 限制由 ADR-011 决定。

### Terminal lifecycle 与错误边界

启动必须为 interactive TTY，进入 alternate screen并隐藏 cursor/启用输入；正常退出、Ctrl+C、`:q` 和异常都必须 unmount 并恢复 screen、cursor 与 input mode。非 TTY 启动安全失败，不创建后台进程。

退出时立即恢复 terminal；如果用户已确认的 Apply/Undo 正在执行，process 必须等待该次 host 写入及 staging cleanup 完成后再结束，不中断已授权的文件替换。

预期配置、project/file、provider/proposal 或 stale 错误在 terminal 展示简短安全文字，不透传 stack、secret、Authorization、raw provider body 或完整源码到错误日志。Core/provider/host 的未知错误传播语义不变，最终 presentation/process boundary 显示通用错误并恢复 terminal。没有 debug flag、logging framework 或新的 error type hierarchy。

### 验证与范围

普通 CI 包含 controller/state、keyboard/render、host filesystem 和 proposal → confirmed Apply → guarded Undo 的离线 temporary-project tests。禁止真实 network、真实 key 和 test-only provider hook；PTY smoke 实际验证 alternate screen、keyboard、resize、navigation、input、help、quit 与 terminal restoration。

Live smoke 只在当前用户显式授权且 credential available 时进行，使用无隐私 temporary project，遵守本次授权次数上限，不自动 retry，不放宽 core acceptance，不进入默认 CI。

## Consequences

- 主产品入口直接在 terminal 交互，frontend 直接复用 local-host，不引入 HTTP transport 或 browser build。
- TUI dependency 只服务 presentation；core 的 public model/task contract 与宿主隔离保持不变。
- 必须在真实 PTY 验证 input/screen lifecycle，普通 text rendering tests 不能代替实际 terminal smoke。
- Current process 只保存当前 proposal 与一次 Undo；退出或切换项目不持久化 history，不建立 Session、memory 或 runtime。
- 当前不批准自动 apply、多文件自主修改、shell/tests/Git execution、Tool/loop、MCP/LSP、browser GUI、remote server、telemetry、accounts、cloud sync、desktop wrapper 或 npm publishing。

## Alternatives

- Browser + loopback HTTP product：不属于已批准的 terminal-native 产品方向，不采用。
- 从零实现 terminal renderer：扩大 renderer/lifecycle/Unicode 责任，采用成熟 terminal presentation library。
- 在 CLI 或 core 直接读取/修改项目文件：混淆 presentation/application 与宿主 authority，采用 local-host。
- CLI 依赖 TUI 或引入 generic command framework：当前只需具体 executable 选择两个 frontend，采用 root launcher。
- AgentRuntime、Session、event bus 或 plugin command system：当前单 task 交互无真实需求，延期。
