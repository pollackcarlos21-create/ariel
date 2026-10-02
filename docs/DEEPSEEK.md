# DeepSeek First Real Model Adapter Contract

Contract review date: 2026-10-01

本文件记录 Chief Architect 已批准的第一个真实 provider implementation contract，适用范围是 DeepSeek 的单次、非流式、纯文本输入到完整 final text 输出。它不是通用 Provider framework。

M005 记录契约；M006 Phase 1 实现 `createDeepSeekModelPort(config)` 和 local-host 的 `runDeepSeekModelRequest(request, config)`，并通过 mocked fetch 离线验证。2026-10-02 完成一次明确授权的真实 generic model smoke integration，记录见 [Real integration verification](#real-integration-verification)。M009 后续批准 proposal-only `ariel edit`；v0.2 terminal composition 同样从启动环境读取 credential，经 local-host 复用 core proposeCodeEdit 与既有 adapter，TUI 不直接创建 provider。in-memory model-demo 与 provider 本身不读取 env 的边界保留。用户入口见 [ADR-009](decisions/ADR-009-first-user-facing-code-edit-cli.md) 与 [ADR-010](decisions/ADR-010-terminal-native-tui-boundary.md)。

外部 DeepSeek API 会变化。M006 实现前以及官方 API 发生变化时，必须重新核验本文使用的 endpoint、model identifier、模式、response schema 和错误行为；不能将本次文档快照视为永久的 provider 保证。

## 已批准的协议路径

| 项目 | M006 contract |
| --- | --- |
| Provider | DeepSeek |
| Method / endpoint | `POST https://api.deepseek.com/chat/completions` |
| Model | `deepseek-flash` |
| Thinking | `{"type":"disabled"}` |
| Streaming | `false` |
| Client direction | raw `fetch` |
| Authentication | `Authorization: Bearer <API_KEY>` |
| Content-Type | `application/json` |

兼容 OpenAI schema 不意味着必须依赖 OpenAI SDK。M006 按 raw fetch 方向实现，不因此新增 SDK 或其他 provider 协议。

## Request mapping

| Ariel input | DeepSeek wire mapping |
| --- | --- |
| `ModelRequest.userText` | user message 的 string `content`，原样传递 |
| `ModelRequest.systemText !== undefined` | 在 user message 前加入 system message，string `content` 原样传递 |
| `systemText === undefined` | 完全省略 system message |
| `systemText === ""` | 保留空字符串的 system message |

Adapter 不得 trim、rewrite、拼接 system/user，或加入隐藏的 provider-owned Ariel product prompt。core 原有空白 userText validation 不变；合法 request 的文本继续原样交给 port。发送 system message 不承诺模型一定遵从 instruction，也不承诺不同 model 的行为一致。

固定 request body 行为如下；这是请求结构示例，不是真实 API 调用记录：

```json
{
  "model": "deepseek-flash",
  "messages": [
    { "role": "system", "content": "Reply briefly." },
    { "role": "user", "content": "Hello!" }
  ],
  "thinking": { "type": "disabled" },
  "stream": false
}
```

`model` 和 `messages` 是 API 必需字段；本 contract 显式固定 `thinking` 与 `stream`，不依赖 provider 的隐含模式。不得加入 `temperature`、`top_p`、`max_tokens`、`seed`、`tools` 或 `response_format`。

## Provider configuration

`@ariel/providers` 公共入口导出以下 config 与 factory：

```ts
export interface DeepSeekModelPortConfig {
  readonly apiKey: string;
  readonly model: "deepseek-flash";
  readonly timeoutMs: number;
}

export function createDeepSeekModelPort(
  config: DeepSeekModelPortConfig,
): ModelPort;
```

实现位于 `packages/providers/src/deepseek.ts`；response mapping 和 transport 细节不作为公共 API 导出。local-host 的 `runDeepSeekModelRequest(request: ModelRequest, config: DeepSeekModelPortConfig): Promise<ModelResult>` 只创建 port 并调用 core `requestModelText`，不重复 validation 或改写 prompt。

- `apiKey` 必须显式提供，没有默认值，由 local-host 提供，永不进入 core 或 ModelRequest。
- `model` 必须显式提供；M006 只批准 `deepseek-flash`，不批准任意 model、隐式选模、registry 或 routing。
- `timeoutMs` 必须显式提供，且为 integer milliseconds in the inclusive range `1..2147483647`：`Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 2_147_483_647`。
- 上限是 Bun 1.4.2 / Node-compatible single `setTimeout` 的 host-runtime representability bound，不是 Ariel product timeout policy、默认值或推荐值。内部 `MAX_TIMEOUT_MS` 不导出，也不进入 core。
- 越界、fractional、NaN 或 infinite 值在 factory 构造阶段同步 fail-fast；不 clamp，不采用 chunked long timer、递归 timer 或 scheduler abstraction。
- M006 本身没有批准默认 timeout；M009 code-edit workflow 后续批准 host-level product default `120000ms`，local-host 显式传给 factory。Provider 仍无隐藏默认 timeout；generic runDeepSeekModelRequest 仍接收显式 config。
- `baseUrl` 不进入 config；M006 固定官方 HTTPS endpoint，不允许自动 redirect 到其他 endpoint。

非法配置在任何 fetch attempt 前同步抛出安全、固定文本的 `TypeError`。API key 必须为 non-empty、非 whitespace-only string；trim 仅用于判空，实际 key 不改写。model 在 runtime 也必须精确为 `deepseek-flash`。这些是构造/装配阶段的配置失败，不是 ModelResult provider failure，不新增 core config error type。

## Timeout 与 cancellation

| 能力 | 决定 |
| --- | --- |
| Cooperative caller cancellation | DEFER |
| Transport deadline | REQUIRED FOR M006 |

Deadline 必须覆盖完整 HTTP operation，包括连接、等待和完整 body consumption；到期真正 abort transport，并在所有结束路径清理 timer。DeepSeek non-streaming keep-alive 空行不能重置 Ariel total deadline。

每次 `generateText` 创建独立 `AbortController`，在 fetch 前启动单个 `setTimeout(() => controller.abort(), timeoutMs)`。完整 `response.text()` 读取完成后才进行 HTTP status 和 JSON mapping；最外层 `finally` 清理 timer，覆盖成功、HTTP/body/network failure、timeout、parse/schema failure 与 unexpected exception。

不得仅用 `Promise.race()` 提前结束等待来冒充 transport cancellation。丢弃 Promise 或停止 await 不等于取消请求；process exit 也不能替代 embeddable API cancellation。

`AbortSignal` / `AbortController` 可以存在于 providers implementation，但不进入 core public contract。本阶段没有调用者通过 ModelPort 合作取消的能力；有限 deadline 不应被描述成完整 caller cancellation API。

本地 transport abort 不承诺 DeepSeek 服务端已经停止 inference 或计费。官方等待连接的 keep-alive/关闭机制也不能替代 Ariel 完整请求 deadline。出现实际用户取消、长期宿主或其他不同的 cancellation 需求时重新审核。

## Completion semantics

只有同时满足以下条件才返回 `status: "completed"`：

- successful HTTP response；
- valid non-streaming `chat.completion` envelope；
- exactly one choice；
- assistant message；
- `content` 是 string；
- `finish_reason === "stop"`；
- no actual tool call output。

Required envelope validation 检查 string `id`、`object === "chat.completion"`、integer `created`、string `model`、string `system_fingerprint` 与 `choices`；choice 检查 integer `index`、nullable object `logprobs`、message、role、content 和 finish_reason。外部 JSON 先作为 `unknown`，通过 runtime narrowing 检查；不以类型断言信任 response。model 和 fingerprint 不进入 core result，usage 不参与 completion 判断。

Text 原样返回。`content === ""` 和 whitespace-only string 都是合法 completed text；不得 trim，也不得把它们自动改成 error。`tool_calls` 缺失或空数组可表示无工具输出，存在但结构异常仍属于无效 response。

| Response case | ModelResult mapping |
| --- | --- |
| 满足上述条件的 final content，包括空字符串和空白字符串 | `completed`，text 原样返回 |
| `length` | `failed` / `provider-failure` |
| `content_filter` | `failed` / `provider-failure` |
| `tool_calls` 或实际工具输出 | `failed` / `provider-failure` |
| `insufficient_system_resource` | `failed` / `provider-failure` |
| `aborted` | `failed` / `provider-failure` |
| null、missing 或非 string content | `failed` / `provider-failure` |
| empty 或 multiple choices | `failed` / `provider-failure` |
| malformed JSON | `failed` / `provider-failure` |
| invalid required response structure | `failed` / `provider-failure` |
| unknown `finish_reason` | `failed` / `provider-failure` |

HTTP success 不等于 model completion。存在 partial text 时也不能把截断、过滤、资源中断或工具调用静默包装为完整答案；不返回新的 partial-result 或 Tool types。

自然语言 refusal 如果仍是正常 `stop` 和合法 final text，就作为 completed text 返回，不创建独立 refusal semantic。Completed 只承诺协议上的完整 final text，不保证事实正确、任务满足或 instruction 遵从。

## Reasoning

M006 显式关闭 thinking。`ModelResult.completed.text` 只表示 final user-visible content。

不得返回 `reasoning_content`，不得拼接 reasoning 与 final，也不得在 final 缺失时用 reasoning 替代。即使 response 附带 reasoning，也不能让它进入返回的 text。Reasoning exposure 继续延期。

## Error mapping 与安全诊断

Core public error kinds 保持 `"invalid-request" | "provider-failure"`，M006 不增加更多 core error kinds。

Core invalid user text 继续返回 `invalid-request`。以下预期外部失败映射为 `provider-failure`：

- non-2xx HTTP，包括认证拒绝、余额不足、rate limit、server overload/error；
- DNS/connect/TLS transport failure；
- deadline 到期；
- response JSON parse failure；
- required response schema failure；
- unsupported completion state。

DeepSeek 400/422 不重新解释成 core `invalid-request`。映射不依赖 provider error body 必定是某个 JSON schema。

Unexpected programming error 继续 throw/reject。不得 blanket catch 所有 exception 后全部改成 `provider-failure`；外部 parse/schema/transport failure 与 adapter bug 必须区分。core、local-host 与 runCli 保持 unexpected error 传播，现有 `bin.ts` 继续承担最外层 process boundary。

当前 transport catch 仅围绕 fetch 和 body consumption，识别 `TypeError`、`DOMException` 的 `AbortError` 及 adapter 自身的 abort reason；未知 error 原样传播，不猜测其他 runtime error classes。JSON parsing 只将 `SyntaxError` 转为安全失败。离线 mock 验证这些分支，不代表真实 DNS/connect/TLS 错误形态已经实测。

Provider failure message 必须由 adapter 生成安全文本。不得直接透传 Authorization、raw request headers、API key、complete provider error body 或 complete upstream exception object；不要把 request/config secret 加进新建异常、日志或 fixture。保留 TLS 验证，不启用会输出 credential 的 transport diagnostics。

Code-edit host composition 可通过私有 wrapper 观察固定 adapter failure message，以精确 allowlist 重新生成 host 自有诊断文字，供 TUI 区分 HTTP status、timeout、network 与响应格式失败。未知 message 不透传；core 仍返回 model-failure，TUI 只映射已知 host 诊断，CLI 保留通用失败文字。此观察不新增字段、日志、重试或网络请求，不 catch 未知异常。

## Retry 与 redirect

M006 automatic retry = NONE。一次实际进入 adapter 的 `ModelPort.generateText()` 对应 one attempted DeepSeek generation HTTP request；core validation 拒绝的输入不调用 port，也不发送 HTTP。

不得增加 retry loop、backoff 或 fallback。Raw fetch 不增加 retry；如果未来使用 SDK，隐藏 retry 必须显式关闭并经过重新审核。

HTTP redirect 必须拒绝，不能自动跟随到未批准 endpoint。Transport tests 必须验证 one HTTP attempt 和 redirect rejection，不能仅靠一次 port invocation 推断没有隐藏网络重试。

## Model identity 与 usage

Configured/requested model identity 在 adapter config 内明确为 `deepseek-flash`。Provider-reported response identity 继续 DEFER from core contract，不新增 `ModelResult.model`；不得把 request identifier 和 reported identity 当作同一种事实或不可变模型版本保证。

Usage 继续 DEFER from core contract，不新增 ModelUsage、token fields 或 cost fields。当前 DeepSeek adapter 丢弃 usage metadata。

未来 integration verification 可以观察 reported identity 和 usage，但它们只作为验证 evidence，不代表公共 API 已批准。Missing usage 表示 unknown，不能填成 `0`，也不能用字符估算冒充 provider token facts。

## Streaming

Streaming 继续 DEFER。M006 只批准 non-streaming JSON response，不创建 StreamingModelPort、ModelEvent、AsyncIterable、SSE abstraction 或 event bus。完整结果仍使用 M004 的 `Promise<ModelResult>`。

## Secret ownership

| 层 | 当前 ownership |
| --- | --- |
| CLI | presentation；M009 executable edit boundary 读取 DEEPSEEK_API_KEY，不提供 `--api-key` |
| 根目录 TUI launcher | 从启动 env 读取 DEEPSEEK_API_KEY，显式经 TUI 传给 local-host；不在交互界面输入/存储 key，不直接访问 provider |
| core | 不知道 credential，不读取 `process.env`，不把 secret 放入 ModelRequest |
| local-host | generic operation 接收显式 config；CLI/TUI task workflow 接收显式 key，装配固定 model 和 120000ms policy；不自行读取 env |
| providers | 接收 key，构造 Authorization header，知道 DeepSeek endpoint，执行 HTTP 与 wire mapping |

Provider 不自行隐藏读取 `process.env` 获取 credential。真实 API key 不进入 Git、test fixture 或 CLI stderr；离线测试只用明显 fake credential。M006 Phase 1 不实现 env reading 或配置持久化，不读取真实 API key。

## M006 test contract

M006 的验证分为三层；Phase 1 已实现前两层，第三层已于 2026-10-02 完成一次明确授权的 successful smoke verification：

| 层 | 范围 | 执行边界 |
| --- | --- | --- |
| Pure response mapping tests | DeepSeek JSON fixture 到 ModelResult | 普通 CI，禁止真实网络 |
| Transport/request tests | HTTP request、deadline、attempt count 和安全错误映射 | 普通 CI，禁止真实网络 |
| Opt-in real integration verification | 真实 DeepSeek response evidence | 显式提供 real credential 且明确授权后运行；不进入默认 CI |

普通 CI 必须覆盖：

- URL、method、Authorization presence without exposing its value、Content-Type 和 request body；
- system/user exact mapping，包括 absent 和 empty systemText，以及合法文本的空白保留；
- model、thinking disabled、stream false；
- one HTTP attempt、redirect rejected；
- timeout actually aborts transport、deadline includes body consumption、keep-alive 不重置 deadline、timer cleanup；
- non-2xx mapping 和全部已批准 finish_reason mappings；
- malformed JSON/schema、empty/multiple choices、null/missing content；
- 合法 empty/whitespace completed text；
- reasoning not exposed、自然语言 refusal 按正常 final text 返回；
- unexpected programming error 不被伪装成 provider-failure。

Transport tests 使用隔离的测试替身，不增加生产 failure switch、magic prompt、隐藏命令或 generic injection framework。Fixtures 不含真实 credential，测试失败诊断也不能打印 key。

`tests/deepseek-model.test.ts` 从 `@ariel/providers` 和 `@ariel/local-host` 公共入口验证 mapping 与 composition，使用 `describe.serial` 和每个测试独立恢复的 global fetch spy。普通测试不访问真实网络。timeout config tests 覆盖整数边界、fractional 与 overflow 拒绝；上限只验证 factory construction，不启动长 timer。

Integration verification 不断言固定自然语言答案，不打印 key，不在默认安装、测试或 CI 中隐式联网。没有真实 integration evidence 时，M006 不得声称真实 DeepSeek connection 已完成验证。

M005/M006 provider contract 本身不批准新 CLI command，也不把 in-memory model-demo 静默改成真实模型调用。M009 单独通过 ADR-009 批准具名 edit workflow；model-demo 仍离线。未来任何 live verification 仍需显式授权，不进入默认 CI。

## Real integration verification

以下是 Chief Architect 已确认的历史验证记录：2026-10-02 在明确授权下，通过 `@ariel/local-host.runDeepSeekModelRequest(...)` 执行了一次真实 DeepSeek request。

| Evidence | Recorded value |
| --- | --- |
| Verification date | `2026-10-02` |
| Verified commit | `4d3a2c93e3606481008a5379090b7bd4d87a8ba9` |
| Request | one explicitly authorized live request |
| Model / thinking / stream | `deepseek-flash` / `disabled` / `false` |
| Invocation timeoutMs | `180000` |
| Result | `status = completed` |
| Text length | `textLength = 22` |
| Preview | `Received your request.` |
| Integration exit code | `0` |
| Working tree after verification | clean；`git status --short` 无输出 |
| Credential lifecycle | 临时使用，未写入文件、Git、测试或日志；运行结束后 `DEEPSEEK_API_KEY` 已从 shell unset |

`180000ms` 仅是该次 verification invocation 显式传入的值，不是 default timeout、recommended timeout 或 product policy；该 generic model operation 仍必须显式提供 timeoutMs。M009 的 `120000ms` host product default 是后续独立批准的 edit workflow policy，不改写这条历史记录。

该次成功验证了 production adapter 访问真实官方 endpoint、credential authentication、`deepseek-flash` request 被接受，以及 non-streaming + thinking disabled 调用成功。真实 response 通过当前 runtime validator，final content 映射为 `ModelResult.completed`，local-host → core → provider 的真实调用路径得到验证。

这只是一次 successful smoke verification，不代表 production ready 或全部 DeepSeek 行为已验证。HTTP/provider failures、timeout、malformed schema、error propagation 和 secret hygiene 仍由 deterministic offline tests 覆盖；真实 network error classification、billing cancellation 与 server-side inference cancellation 没有在该次成功调用中得到验证。

未来任何 live verification 仍必须显式 opt-in、单独授权并提供临时 credential，不进入默认 CI，也不打印 API key、Authorization value、完整环境或其他 secret。

## 与 ADR 的关系及延期范围

本 contract 是 [ADR-006](decisions/ADR-006-minimal-model-interaction-boundary.md) 已批准 provider boundary 的具体实现约束，没有改变 workspace dependency direction、core ModelResult semantics 或 runtime lifecycle abstraction；M006 provider 实现本身未新增 ADR。后续 ADR-008 记录独立 application task contract，ADR-009 记录首个 user-facing workflow。

未来若增加 core cancellation、public usage、public model identity、provider-neutral lifecycle 或 generic retry/fallback，再重新判断是否需要新 ADR。Agent execution 的定义与延期见 [ADR-007](decisions/ADR-007-agent-execution-semantics-and-deferral.md)。

本 provider contract 不批准 AgentRequest、AgentResult、AgentExecutor、executeAgentRequest、ExecutionContext、Session、Conversation、TurnId、history/persistence、Tools、Agent Loop、memory、multi-agent、registry/routing、fallback、token budgeting、cost accounting、MCP、server、TUI 或 IDE。`requestModelText()` 保持 generic。M008 的具名 task 实现单独将 ApplicationStatus 迁移为 `{ agentExecution: "single-source-code-edit-proposal" }`，并非因为接入 provider 自动产生 Agent execution。

## 官方审查依据

以下链接对应 2026-10-01 contract review 所采用的一手资料；M005 没有实际调用 DeepSeek API。实现前重新核验文档不等于已完成真实 integration verification。

- [Your First API Call](https://api-docs.deepseek.com/)
- [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)
- [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Error Codes](https://api-docs.deepseek.com/quick_start/error_codes/)
- [Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit/)
- [Change Log](https://api-docs.deepseek.com/updates/)
