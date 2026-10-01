# ADR-007：Agent Execution Semantics and Deferral

状态：Accepted

## Context

Milestone 004 已建立真实的 model interaction boundary：`ModelRequest`、`ModelResult`、`ModelError`、`ModelPort` 与 `requestModelText()`。当前通过 deterministic in-memory adapter 验证调用链，没有真实 LLM，也没有独立于 model operation 的 Ariel application-level agent task contract。

仅增加固定 system prompt、调用 ModelPort 并重命名 request/result DTO，不能说明 application 已经承担新的任务责任。需要先明确 application 接受什么任务、拥有何种 policy，以及对什么 completion / failure semantics 作出承诺，再决定是否建立独立 Agent boundary。

## Decision

### Agent execution 的工程定义

Agent execution 是 application 接受一个已定义任务，按照 application-owned policy 处理它，并对本次运行的 completion / failure semantics 负责；model call 是其中的实现能力之一。

多次 model call、tool、session 或 persistence 都不是 Agent execution 的必备先决条件。一次 model call 可以构成未来某个 Agent execution 的实现路径，但固定 system prompt + ModelPort 调用 + DTO rename 本身不足以证明新的 Agent boundary 已经存在。

当前延期的理由是：尚不存在一个值得独立命名、测试和承诺的 Ariel application task contract。不得通过增加复杂度或改名来替代这个需求。

### 当前契约与状态

当前不新增 `AgentRequest`、`AgentResult`、`AgentExecutor`、`executeAgentRequest()` 或 `ExecutionContext`，不创建对应空接口、占位模块或目录。

M004 的 `requestModelText()` 继续保持 generic：它校验空白 userText，通过显式 ModelPort 请求完整 ModelResult，不添加 Ariel product prompt 或 Agent policy。M004 model public contract 与既有错误传播语义不变。

`ApplicationStatus.agentExecution` 保持 `"not-implemented"`。当前 model interaction demo 不是 Agent execution；未来接入真实 model provider 本身也不足以改变此状态。

### Ownership

| 层 | 职责 |
| --- | --- |
| CLI | presentation；将结构化结果转为用户输出 |
| local-host | composition / host facts；装配具体 adapter 与核心调用 |
| core application layer | future Ariel application policy；在真实任务需求出现后拥有任务语义 |
| provider adapter | wire protocol mapping；实现 ModelPort，归一化预期 provider 失败 |

provider adapter 不得偷偷拥有 Ariel product identity/policy。local-host 不因承担 composition 而拥有 application policy；CLI 不因负责 presentation 而定义 application task semantics。已批准的 workspace dependency direction 不变。

### 明确延期与重审条件

Session、Conversation、TurnId、Tools、Agent Loop、ExecutionContext、Agent DTO、agent CLI command、memory 与 multi-agent 全部延期。本 ADR 不批准 `agent-demo` 或 `ask` 命令，不创建未来 runtime、dispatcher 或通用执行框架。

只有出现真正不同于 ModelPort 的 application 需求，才重新审核 Agent execution boundary。具体触发条件包括：

- 明确的 application task contract，需要独立命名、测试和承诺。
- 独立于 model result 的 application result/failure semantics。
- Concrete action/environment responsibility，需要 application 对运行责任作出定义。
- 其他真正不同于 ModelPort 的 application behavior。

这些条件不构成必须同时具备的功能清单，也不授权提前创建 API。重审时仍需以已批准的真实需求决定最小边界。

## Consequences

- model operation 与 Agent execution 的语义保持清晰；更换或接入真实 provider 不自动产生 Agent application contract。
- 当前没有新增 Agent public API、runtime capability 或 CLI command，`agentExecution` 继续如实表示尚未实现。
- 单次 model call 的未来 application 实现路径仍然可用，不强迫未来 Agent 先拥有 tools、session、多次调用或 persistence。
- Future Ariel application policy 归 core application layer，provider 实现不能通过隐藏 prompt 引入产品行为。
- Agent boundary 的后续设计必须从真实任务与责任出发，遵循当前四 workspace 边界，不建立 speculative API。

## Alternatives

- 立即增加 Agent DTO 与固定 prompt wrapper：当前没有独立 task/result/failure contract，改名和转发不能提供新的 application 承诺；延期。
- 以 tools、多次 model call、session 或 persistence 作为统一门槛：这些能力可能服务真实任务，但不是 Agent execution 的必备定义；不采用。
- 由 CLI、local-host 或 provider 持有 Ariel application policy：会混淆 presentation、composition、wire mapping 与 application 责任；保留 core application layer 的 ownership。
- 提前创建 generic AgentExecutor 或 ExecutionContext：当前没有需要它们解决的真实 application behavior；延期至明确需求后重新审核。
