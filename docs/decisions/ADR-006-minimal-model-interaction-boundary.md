# ADR-006：最小 Model Interaction Boundary

状态：Accepted

## Context

Milestone 003 只有同步 application status query，默认 CLI 可以读取当前 Agent execution 尚未实现这一事实。四 workspace 及源码依赖方向已经批准：cli → core、local-host；local-host → core、providers；providers → core；core → 无。

当前需要建立一次真实模型交互边界，验证 CLI、local-host、core port 和 providers adapter 的纵向调用链。当前没有真实 provider、session、tool 或 streaming UI；本次用无需网络、API key、认证或配置的 deterministic in-memory simulation 验证边界，不集成实际 LLM。

## Decision

core 拥有 `ModelRequest`、`ModelError`、`ModelResult`、`ModelPort` 与具名 application function `requestModelText(request, modelPort): Promise<ModelResult>`。该函数显式接收 port；ModelPort 当前只有 `generateText(request): Promise<ModelResult>`，异步返回完整结果，没有 dispatcher 或 provider registry。

`ModelRequest` 只有 `readonly userText: string` 与可选 `readonly systemText?: string`。system/user 是 application semantic slots，不是供应商 Message 类型；没有通用 Message[]、role enum、conversation history 或工具消息。

`ModelResult` 是判别联合：`completed` 携带 text，`failed` 携带 ModelError。ModelError 只有 `invalid-request`、`provider-failure` 两种 kind 与 message。core 用 `userText.trim().length === 0` 拒绝空白请求，返回 invalid-request 且不调用 port。合法请求的原始对象交给 port 恰好一次，userText 和 systemText 均不改写、不合并，返回同一 ModelResult；completed text 可以为空字符串。

invalid-request 由 core application function 产生；provider-failure 留给 adapter 归一化预期外部失败。意外 throw 或 Promise reject 自然传播，不转换为成功文本，不增加通用异常恢复体系。core 不做 retry、fallback、logging framework、timeout、routing 或 history management。

providers 提供 concrete adapter factory `createInMemoryModelPort(): ModelPort`，实现确定性的 in-memory echo。它返回 `completed` 与 `Echo: ${request.userText}`；不解释 systemText，不暗示真实模型 system-role 行为，也不把 systemText 拼入 userText。不访问网络、环境变量、API key、filesystem、随机数或时钟，不创建后台资源，不需要 dispose，不提供 magic prompt、失败开关或其他公共失败模式。

local-host 的 `runInMemoryModelDemo(userText): Promise<ModelResult>` 承担 composition root 职责：创建真实 in-memory adapter，构造 `{ userText }`，调用 core `requestModelText` 并返回结果。validation 仍属于 core，不在 local-host 增加 prompt policy、retry 或 agent loop，不创建 generic application/runtime facade、DI container 或 service locator。

CLI 通过 local-host 执行唯一新增命令 `model-demo <text>`，恰好接收一个 text 参数，拒绝缺失与多余参数。CLI 明确展示 in-memory 模拟标识和未调用真实模型的说明；没有 `--system` 或模型配置选项。`runCli` 统一迁移为 `Promise<CliResult>`，由 bin.ts await 后处理 process 边界。CLI 仍直接使用 core 的 status query，同时因真实 demo 调用声明 `@ariel/local-host: workspace:*`，不直接依赖 providers。

runtime control flow 为 CLI → local-host → core → ModelPort → providers adapter；source dependency direction 仍遵循上述已批准方向。core 不 import providers，providers 通过 core 公共入口实现契约。core 仍无 workspace 或第三方 runtime dependency，不使用 Bun、Node、filesystem、process/env、cwd、network 或 clock；保持 `types: []` 与 browser-target build。Promise 使用 ES 标准能力，不引入 DOM lib。

`ApplicationStatus` 和 `getApplicationStatus()` 保持原样，仍返回 `{ agentExecution: "not-implemented" }`。in-memory demo 不代表 Agent execution，application status 不是 capabilities registry。

streaming、cancellation、usage、model identity、retry、auth/config 全部延期。当前不定义 StreamingModelPort、ModelEvent、AsyncIterable、ReadableStream、AbortSignal、token usage、model 字段或对应占位接口。

## Consequences

- core 可以通过显式 port 独立驱动模型调用；adapter 可以由其他满足契约的实现替换，不需要 module mock 或全局状态。
- 供应商 SDK 类型不进入 core，当前调用链没有网络或认证要求，真实 composition path 可直接离线验证。
- 当前没有真实 LLM、首 token streaming、cooperative cancellation、usage facts 或 model identity；不返回伪造的 token 数量或模型身份。
- 完整结果契约要求结果可用后再返回，完整响应需要缓冲，无法逐块向 CLI 交付。
- `runCli` 的统一 async 返回值是内部 breaking migration，所有调用者和 direct tests 必须 await。
- 未来需要真实 I/O 时重新审核 cancellation、真实 model identity、provider usage facts 和 streaming；第一个真实 provider 接入前必须完成 cancellation、identity、usage 审核。
- 出现首 token UI、用户取消、tool call、multi-block output 或长时真实远程调用需求时，重新审核独立 streaming capability，不提前创建空接口。
- 本 ADR 不批准 Session、Conversation、Tool、Agent Loop、permission、persistence、generic runtime lifecycle 或其他延期能力。

## Alternatives

- typed closure：可用单个 typed function 表示调用，但当前已批准具名 `ModelPort.generateText`，以明确 adapter 所实现的最小契约；不再同时提供 closure 入口。
- providers-neutral facade：在 port 之外增加 facade 会重复当前具名 application function 的职责；当前没有多个 provider、配置、路由或共享生命周期需求，不增加第二层通用抽象。
- stream-first：当前没有 streaming UI、取消或长时远程调用需求；预先设计事件、结束语义、收集与缓冲策略会扩大契约。采用 Promise 完整结果，遇到明确需求后重新审核 streaming capability。
