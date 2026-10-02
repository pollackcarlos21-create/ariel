# ADR-008：Single-Source Code Edit Proposal Task

状态：Accepted

## Context

M001-M006 已建立四 workspace、application status query、generic model interaction boundary 与 DeepSeek adapter。真实 model call 不自动构成具名 Ariel application task；ADR-007 要求从明确任务、application-owned policy 和独立 completion / failure semantics 出发审核边界。

Chief Architect 已批准第一个具名 task：根据 instruction，为 caller 提供的一份原始 sourceText 生成一处 CodeEditProposal。Application 对输入、内部模型请求、输出解码与 proposal acceptance 负责；本任务只产生建议，不应用修改，不读写文件，不执行代码或 tests。

M007 是 docs-only architecture milestone。本 ADR 冻结 public API 设计与 semantics，不实现或导出这些 API，不新增 tests、dependency 或 CLI command。Contract established 不代表 capability implemented。

## Decision

### Public contract

以下是后续实现的 core public API 设计；`ModelPort` 使用 ADR-006 已有契约：

```ts
export interface CodeEditTask {
  readonly instruction: string;
  readonly sourceText: string;
}

export interface CodeEditProposal {
  readonly oldText: string;
  readonly newText: string;
}

export interface CodeEditError {
  readonly kind:
    | "invalid-task"
    | "model-failure"
    | "invalid-proposal";
  readonly message: string;
}

export type CodeEditProposalResult =
  | {
      readonly status: "completed";
      readonly proposal: CodeEditProposal;
    }
  | {
      readonly status: "failed";
      readonly error: CodeEditError;
    };

export function proposeCodeEdit(
  task: CodeEditTask,
  modelPort: ModelPort,
): Promise<CodeEditProposalResult>;
```

不增加 file path、task ID、execution ID、metadata、model selection、system prompt、task-kind union 或其他公共字段。Proposal 不携带已应用后的 sourceText，也不表示文件已经修改。

### Task validation 与 model attempt

- instruction 必须是 string，且至少包含一个非 whitespace 字符。可以使用 trim 检查，但不得改写原 instruction。
- sourceText 必须是非空 string，不 trim、不 normalize、不 rewrite。Whitespace-only sourceText 合法；空字符串不合法。
- invalid task 返回 `failed / invalid-task`，零次 ModelPort 调用。
- 合法 task 最多且正常情况下恰好执行一次 model attempt。不存在 retry、repair attempt 或 fallback；unexpected exception 不触发第二次调用。

### Policy ownership 与 private encoding

Core application layer 拥有 application instruction、内部 ModelRequest 构造、output encoding policy 与 proposal acceptance policy。Caller 只提供 task data 与显式 ModelPort，不能传任意 system prompt 绕过 task policy。

内部 model output encoding 使用 JSON，这是 private encoding choice。它不修改 ModelPort public contract，不新增 responseFormat、schema、tool-call capability 或 provider-specific request。内部 prompt 的具体文字不是本 ADR 新增的公共 API。

现有 ModelPort、ModelRequest、ModelResult、ModelError 与 `requestModelText()` 契约保持不变；`requestModelText()` 继续 generic，不加入 CodeEditTask-specific policy。Core 仍不知道 DeepSeek、credential、env、fetch 或 CLI。Provider adapter 仍只负责 wire protocol mapping；local-host 仍是 composition root；CLI 仍是 thin frontend，负责 presentation。

### Decoder 与 proposal acceptance

Decoder 只接受合法 JSON object，必须且只能有 oldText / newText 两个字段，且两者均为 string。Null、array、scalar、缺失字段、额外字段或错误字段类型均不接受。不接受以 Markdown code fences 包裹的 output，不剥离 fences，不做 JSON repair。

Acceptance 必须同时满足：

1. oldText 非空。
2. oldText 在本次原始 sourceText 中 exact-match 恰好一次，只有一个替换位置。
3. newText 可以为空，空字符串表示删除该处 oldText。
4. oldText !== newText；no-op proposal 不接受。

Matching 只使用 exact string matching，按不同起始位置判断 occurrence，包括重叠位置。例如 sourceText 为 `aaa`、oldText 为 `aa` 时存在两个匹配位置，不满足唯一性。不使用 fuzzy matching、whitespace normalization、AST 或 syntax interpretation，也不创建 generic patch engine。

Proposal 的 oldText / newText 原样保留，不 trim、normalize 或 rewrite。唯一性与文本变化只针对本次输入的 sourceText；不承诺其他文本版本上的位置或可用性，不执行替换或 file mutation。

### Completion semantics

`completed` 的有限含义是：

> 已生成一处针对本次输入 sourceText、具有唯一替换位置且会产生文本变化的修改建议。

它不保证：

- instruction 被正确理解；
- proposal 语义正确；
- 代码语法正确；
- bug 已修复；
- 修改已应用；
- tests 已通过。

`completed` 是 application proposal acceptance 的结果，不只是 HTTP success、ModelResult.completed 或可解析的 JSON。

### Error boundary

| 情况 | CodeEditProposalResult / propagation |
| --- | --- |
| invalid task | `failed / invalid-task`；零次 ModelPort 调用 |
| ModelResult.failed | `failed / model-failure` |
| 预期 JSON decode/schema failure | `failed / invalid-proposal` |
| empty oldText、anchor missing 或 exact-match 不唯一 | `failed / invalid-proposal` |
| oldText === newText | `failed / invalid-proposal` |
| unexpected programming throw/reject | 原样传播 |

只将预期 decode/schema/anchor/uniqueness/no-op failure 归一化为 invalid-proposal。Unexpected throw/reject 不转换成 model-failure 或 invalid-proposal，不包装替换原异常，禁止 blanket catch。既有 core、local-host 与 runCli 的异常传播语义不变，bin.ts 仍承担最终 process boundary；本轮没有新增执行入口。

### ApplicationStatus 与 implementation deferral

M007 只建立契约，ApplicationStatus.agentExecution 必须继续保持 `"not-implemented"`，不得提前改为 available / implemented。

真正实现、相应 tests 与 status migration 留给后续单独批准的 implementation milestone。本 ADR 不设计 M008 API，也不授权创建占位源码、目录、runtime object 或提前新增公共导出。

### Explicitly deferred / forbidden

本 milestone 不批准或实现：

- AgentRuntime、AgentExecutor、ExecutionContext；
- Session、Conversation、Thread、TurnId、ExecutionId；
- Tool、tool registry、tool loop；
- filesystem/shell execution、file mutation、task-driven Git operations；
- generic patch engine；
- StreamingModelPort、public task events、caller cancellation；
- retry/fallback、public usage/cost/model identity、model routing；
- metadata bag、generic task-kind union；
- server protocol、TUI/REPL/IDE integration；
- new CLI command。

现有 in-memory CLI demo 和 DeepSeek model boundary 不因本契约而改变，也不新增 AgentRequest、AgentResult 或 generic Agent execution API。

## Consequences

- Ariel 首个具名 task 的输入、policy 与 acceptance 责任有了明确契约；不同于只转发 generic model request，但本轮未产生 runtime capability。
- Task policy 归 core，provider 不承载 Ariel application policy，composition 与 presentation 边界保持不变。
- 单次 model attempt 与严格 JSON/proposal acceptance 可能返回 invalid-proposal；本契约不通过 retry、repair 或 fuzzy matching 自动恢复。
- Acceptance 可确认唯一替换位置和文本变化，无法证明代码、语义或任务正确性，也不会应用修改或运行 tests。
- Contract-only milestone 保持 `agentExecution: "not-implemented"`；未来 implementation 与 status migration 需要单独授权。

## Alternatives

- 将 generic ModelRequest/ModelResult 重命名为 Agent DTO：缺少独立 proposal acceptance 与任务责任，不采用；使用具名 CodeEditTask contract。
- Caller 提供任意 system prompt：会绕过 application-owned task policy，不采用。
- 修改 ModelPort，增加 JSON/schema/tool-call capability：JSON 是 task 的 private encoding choice，不改变既有 provider-neutral contract。
- Fuzzy matching、normalization、AST 或 generic patch engine：超出本次 exact single-source proposal scope，不采用。
- 自动 JSON repair、retry 或 fallback：会增加 model attempts 和新的恢复语义，不采用。
- 同时实现 executor/runtime、file mutation、CLI 或 status migration：M007 仅建立文档契约，implementation deferred。
