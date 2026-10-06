# ADR-012：Configured Model Provider Composition

状态：Accepted

## Context

Ariel 已有 provider-neutral ModelPort、core-owned Single-Source Code Edit Proposal、DeepSeek raw-fetch adapter 和 thin CLI/TUI。当前真实需求是在同一 coding workflow 使用一个明确配置的 OpenAI-compatible Chat Completions endpoint，同时保留既有 DeepSeek 默认行为。

provider choice、credential 和 transport configuration 属于 host/composition，不属于 core task，也不应由 frontend 直接创建 adapter。两个 production adapters 不需要 provider registry、runtime、plugin system 或 SDK。

## Decision

### 有限 composition 与 ownership

local-host 提供 ArielModelProvider 判别联合：deepseek 分支持有 apiKey，openai-compatible 分支持有 baseUrl、model 和可选 apiKey。Pure parseArielModelConfig(env) 接收显式 env record，返回 configured/provider 或带安全 providerName/error.message 的 failed config，不读取 process.env、不发请求、不保存配置。

只有 root launcher 与 CLI executable 从启动环境读取配置，再显式传入薄 frontend/host。TUI 不直接 import providers；CLI 不直接 import providers；core/providers 不读取 env。五 workspace dependency direction 与 explicit public exports 保持不变。

runConfiguredCodeEditTask / runConfiguredCodeEditFromFile 选择 concrete ModelPort 后调用既有 core proposeCodeEdit；原 DeepSeek helper wrapper 保留兼容。没有为每个 provider 复制 filesystem/task workflow。Code-edit host 继续显式传入 120000ms product timeout，provider factories 不获得隐藏默认 timeout。

本 ADR 有限扩展 ADR-009/ADR-010 的固定 DeepSeek composition；不修改历史 ADR，不改变 ADR-006 model public contract、ADR-008 task acceptance、CLI proposal-only 或 ADR-011 Apply/Undo authority。

### 启动配置与兼容性

- ARIEL_PROVIDER 未设置时默认 deepseek；显式 deepseek 使用 DEEPSEEK_API_KEY，缺失/空/whitespace-only key 安全失败。仍固定 deepseek-flash、thinking disabled、stream:false。
- openai-compatible 使用显式 OPENAI_COMPATIBLE_BASE_URL 与 OPENAI_COMPATIBLE_MODEL，OPENAI_COMPATIBLE_API_KEY 可选；缺失/空/whitespace-only compatible key 不发送 Authorization。
- 未知 provider 或非法 required configuration 安全失败，不 silently fallback。没有自动 .env loading、CLI --api-key、TUI key entry、config file 或 credential persistence。
- provider 在 process 启动时选择，不提供 model picker、dynamic routing、fallback 或能力发现。model-demo 始终是独立 in-memory simulation。

### Generic Chat Completions adapter

providers 提供 createOpenAICompatibleModelPort(config)，baseUrl/model/timeoutMs 必须显式给出，apiKey 可选。raw fetch 使用 POST {baseUrl}/chat/completions；尾部 slash normalize 后保留用户 API prefix，不猜 /v1、不删除 path、不 fallback endpoint。

baseUrl 必须是严格解析的 HTTPS，或 localhost、127.0.0.1、[::1] 的本地 HTTP。拒绝 malformed URL、其他 scheme、普通远程 HTTP、embedded credentials、query/fragment。Content-Type 为 application/json，只有 non-empty key 才构造 Bearer Authorization；credential 不进入 message、日志或错误。

Request 显式 model、原样 system/user messages、stream:false。Provider 不 trim/rewrite task text、不添加隐藏 system instruction、temperature、tools、JSON mode 或 provider-specific reasoning option。Core 拥有 product prompt/output encoding policy。

每次 operation 使用独立 AbortController 和单 timer，覆盖 fetch、headers 与完整 body consumption，所有结束路径 finally cleanup。timeoutMs 必须是 1..2147483647 integer milliseconds；非法配置同步 fail-fast，无 clamp、chunked timer、retry 或 redirect。保持预期 transport failure 安全归一化与未知 programming error 原样传播。

成功 response 从 unknown 验证 object、非空 choices、首项 message 与 string content；不 stringify 非文本 content、不 trim，空/whitespace text 留给 core/application。tool/function-call output 不支持；finish_reason 若存在只能为 stop，缺失时使用最小文本 schema。HTTP error 最多展示安全 status，不能包含 raw response body、source、instruction、key 或 Authorization。

这是有限的 Chat Completions-style interoperability contract，不声称任意 endpoint 完全兼容 OpenAI，也不绑定 api.openai.com、GPT model names、Responses API 或 OpenAI SDK。原 DeepSeek wire protocol 与 strict response rules 不改写为该 generic schema。

### Presentation 与 privacy

CLI edit 与 TUI Generate 使用相同 configured host composition。Header 显示 DeepSeek 或 OpenAI-compatible 及本地配置状态，不展示 credential；CONFIGURED 不代表认证、余额、连接或 compatibility 已验证。首次 Generate 前明确 selected source 将发送 configured model provider，并显示 provider 名；取消零次请求，每 process 一次确认。Selected source/instruction 只发送当前配置 endpoint，没有 fallback。

安全 expected failures 保持简短用户文字；unknown exception 仍由既有 process/terminal boundary 最后处理，TUI 在任务结束或错误关闭后继续接受输入。不扩大为 logging/error framework 或新的 core failure kind。

### 验证与范围

普通 CI 验证 request/response mapping、URL security、optional authentication、total deadline、no retry、safe errors、pure env parsing、CLI/TUI composition 与连续 task keyboard regression。测试使用 temporary files 和 test-local fetch，不读取真实 key、不访问真实 endpoint、不增加 production failure hook。

真实 compatible integration 只在当前用户明确授权及配置可用时 opt-in，使用无隐私 temporary source，验证 Generate → validated proposal → Reject 后仍可操作；真实结果与本地离线测试、远程 CI 分别报告。不能因 provider 格式失败自动重试或放宽 core acceptance。

## Consequences

- 用户可保留原 DeepSeek 配置，也可显式选择支持当前 schema 的 compatible endpoint；未设置 ARIEL_PROVIDER 的原行为不变。
- Core 继续只消费 ModelPort，不知道 provider、URL、credential、env 或 transport；两个 frontend 只消费 host composition。
- Configuration 是 process 启动快照；切换 provider 需要修改启动环境并重新运行，不形成持久 secret/config system。
- 任意供应商可能不支持当前 text-only schema；安全失败优先于隐式工具处理、endpoint guessing 或放宽 proposal validation。
- 120000ms 仍是 host product policy；providers 没有隐藏 timeout/retry。Usage、reported identity、reasoning exposure、streaming、cancellation、routing/model picker 继续延期。
- 不新增 AgentRuntime、Session、tools/loop、registry、DI container、plugin loading、HTTP server 或 browser frontend。

## Alternatives

- 每个 provider 复制 task/file workflow：会扩大公开 host helper 数量，采用两个具名 provider 分支与共享 composition。
- 在 core 加 provider/model fields 或修改 ModelPort：选择和 transport config 不是 application task data，保持 core contract。
- TUI/CLI 直接创建 adapter或各处读取 env：混淆 presentation 与 composition，采用 executable 显式读取、pure host parser 与 host factory。
- 安装 OpenAI SDK 或绑定官方 OpenAI endpoint/model：当前需求是 generic Chat Completions raw HTTP，不采用 SDK 或官方平台限制。
- 自动发现 endpoint、fallback、ProviderRegistry/Runtime、model picker/config persistence：当前两个显式 adapters 无此需求，延期。
