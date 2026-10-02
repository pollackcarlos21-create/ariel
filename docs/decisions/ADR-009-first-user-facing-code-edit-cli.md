# ADR-009：First User-Facing Code Edit CLI

状态：Accepted

## Context

ADR-008 已冻结 Single-Source Code Edit Proposal task；M008 实现 core 的 proposeCodeEdit 与独立 proposal acceptance，并将 ApplicationStatus 精确迁移为 `single-source-code-edit-proposal`。M006 已有真实 DeepSeek adapter。现在需要让 fresh clone 用户通过 terminal 为一个真实源码文件获取可审阅的建议，而不自动修改文件。

Chief Architect 本次批准的范围是 Ariel v0.1：一个文件、一条 instruction、一次 model attempt、一份经过 application validation 的 proposal。它不是完整 coding-agent CLI framework，也不批准 AgentRuntime、Tool、Session 或自动执行。

## Decision

### User-facing command

新增 `ariel edit <file> "<instruction>"`，恰好接收两个 positional args。缺失 file/instruction 或多余参数返回 exitCode 1，显示简短中文 usage error，不调用 model。保留 default、help、version 和离线 model-demo；help 增加 edit usage。源码入口由 `bun run ariel` 执行，无需 npm publish、全局安装或预先 build。

### Ownership

- CLI 拥有 argument parsing、configuration presentation 和 proposal rendering。
- executable `bin.ts` 只在 edit 路径读取 `DEEPSEEK_API_KEY`，将值显式传给 runCli；runCli 不读取 process/env、不创建 provider、不 blanket catch。
- local-host 读取指定文件，装配 createDeepSeekModelPort，调用 core proposeCodeEdit，返回结构化 task result 或安全的 file-read-failure。
- core 拥有 ADR-008 的 task input、内部 model request、private JSON output encoding 与 acceptance policy；不知道 file path、cwd、filesystem、env、credential、fetch、DeepSeek 或 CLI。
- providers 继续拥有 HTTP/wire mapping；不隐藏读取 env，不加入 Ariel task policy。

四 workspace 与允许 dependency direction 不变。CLI 不 import providers，core 不 import local-host/providers。没有 generic HostRuntime、FilesystemPort、DI framework 或 dispatcher。

### DeepSeek configuration 与 timeout policy

v0.1 只支持 DeepSeek，model 固定为 `deepseek-flash`；不提供 provider/model selector。Credential 来自用户的 DEEPSEEK_API_KEY，不提供 `--api-key`，不持久化 key。undefined、empty 或 whitespace-only key 在 provider operation 前成为安全配置错误，exitCode 1。

M009 local-host 的 product default 为 `120000ms`。Host 显式传入 `{ apiKey, model: "deepseek-flash", timeoutMs: 120_000 }`。这是 user-facing workflow policy，区别于 provider 的 timer representability bound；createDeepSeekModelPort 仍要求显式 timeoutMs，没有隐藏默认值。既有 generic runDeepSeekModelRequest 继续接收 caller 显式 config。

Provider 的 endpoint、thinking disabled、stream false、redirect rejection、single attempt、full-operation abort deadline、safe failures 与 unexpected error propagation 不变。没有 retry、repair 或 fallback。

### Single-file reading

支持 absolute path，relative path 按当前 process cwd 解释。只读取用户指定的一个有效 UTF-8 regular file；保留原始字符包括 BOM，不递归、不搜索 repository、不发现其他文件。

文件不存在、directory、special file、不可读、invalid path/input 或文本解码失败属于预期读取失败，返回安全错误，exitCode 1，不打印 sourceText 全文或 stack。空文件在 model operation 前拒绝；whitespace-only sourceText 合法，原始文本交给 core，不 trim、normalize 或 rewrite。

不写用户文件、不 chmod、不创建 replacement、不执行 shell、用户项目 tests 或 Git。建议只针对本次读取的 sourceText 快照；不创建 filesystem lifecycle 或 concurrency framework。

### Proposal presentation 与 completion

成功时 exitCode 0，stdout 显示文件、oldText/newText 的 deterministic patch-like preview，每行使用 `- ` / `+ ` 前缀；空 newText 明确表示删除。最后明确显示：

```text
Proposal validated.
No files were modified.
```

此 preview 不构成 unified diff 或可自动应用的 patch contract。Proposal 的 newline/tab 用于格式保留，其他 `Cc` control characters 使用可见转义；File label 的 newline/tab 也转义。包含本次 credential 的 preview 文本会被隐去并明确提示，这只改变 presentation，不修改 core proposal/source/request。Completed 保留 ADR-008 的有限语义：有一处唯一 exact-match 替换位置且会产生文本变化；不保证 instruction 理解、语义、语法、bug 修复、文件已修改或 tests 通过。不得显示 fixed/applied/tests passed 等未发生的结果。

### Expected failures 与 process boundary

invalid CLI args、missing key、file-read-failure、invalid-task、model-failure、invalid-proposal 均返回 exitCode 1 和简短中文 stderr；失败 stdout 为空。Presentation 使用应用拥有的安全文字，不透传 provider message/body、key、Authorization 或 sourceText 全文。

Unexpected programming throw/reject 继续传播至既有 bin.ts 最外层 catch，输出固定通用错误并设置 exitCode 1，不输出 stack/path/upstream exception。不在 core、host composition 或 runCli 增加 blanket catch。

### Tests 与 live verification

普通 CI 验证 core contract、CLI behavior、host exact file reads、explicit model/timeout composition、preview 与无文件写入。文件测试使用 temporary directory/file，transport 使用 test-local fetch mock，不读取用户真实 key、不访问真实网络、不增加 production hook。

Live smoke 仅在用户显式授权且 credential available 时运行一次真实 edit request，使用无隐私的临时小文件，验证 exit 0、validated proposal 和文件字节未改变，然后清理临时文件。Live failure 如实记录，不自动重试或放宽 acceptance。缺失 credential 不伪造 success，也不进入默认 CI。

### Explicitly deferred

自动 file mutation/apply confirmation、多文件、repository search、shell/tests/Git execution、Tool/registry/loop、AgentRuntime/AgentExecutor/ExecutionContext、Session/Conversation/Thread、memory、streaming、retry/fallback、routing/provider registry、public usage/cost/model identity/cancellation/events、MCP/LSP/TUI/IDE、daemon/server/remote execution 与 npm publishing 均延期。

## Consequences

- 用户可以在 fresh clone 中安装依赖、配置自己的 key，对一个真实文本文件取得 DeepSeek 驱动且 application-validated 的建议。
- 文件内容和 instruction 会发送给 DeepSeek；只提供愿意向该 provider 分享的文本，credential 永不进入 source/Git/log。
- 严格 JSON/exact-match acceptance 可能拒绝真实模型 output；v0.1 不 retry、repair 或 fuzzy-match。
- `120000ms` 是 explicit host product policy，provider 仍保留显式 configuration 和原有 timeout validation。
- Proposal-only 行为允许用户先审阅，不能声称文件已修改、代码正确或 bug 已解决。
- v0.1 没有交互会话、streaming、取消入口、工具执行或自动 apply，不因此增加未来框架。

## Alternatives

- 自动应用修改或增加 apply confirmation：超出 proposal-only scope，延期。
- 从 CLI 直接读取文件或创建 provider：混淆 frontend 与 host composition，采用 local-host。
- 在 core 加 path/filesystem/env 或在 provider 隐式读取 key/default timeout：违反现有 boundary，采用 explicit CLI/host 配置。
- 新增 model/provider selector、SDK、diff dependency 或 generic CLI framework：当前单 provider/单任务没有需求，不采用。
- 改造 in-memory model-demo 为真实调用：会改变既有离线行为，保留 demo 并新增具名 edit workflow。
