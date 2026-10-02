# ADR-011：User-Confirmed File Apply and Undo Semantics

状态：Accepted

## Context

ADR-008 的 core task 只生成并验证单源码 CodeEditProposal；ADR-009 CLI 只显示建议，不写文件。v0.2 interactive TUI 已单独批准用户明确 Apply、Reject 与至少一次 Undo，需要明确 filesystem authority、stale protection 和写入责任。

这些是 local-host 的真实环境责任，不应扩展 core ModelPort/CodeEditTask，或创建 generic patch engine、Tool/runtime/session。Proposal accepted 不等于代码正确，用户仍需审阅。

## Decision

### Ownership 与显式确认

core proposeCodeEdit 保持不读写文件、不携带 path、hash、credential 或 Undo。local-host 拥有 selected project root 内的读取/写入；薄 TUI controller 保存当前项目、source snapshot、validated proposal 与一次 Undo record 的进程内状态，负责清晰的 Before/After 与独立 Apply/Reject/Undo controls。这些是 frontend operation state，不是 core application state 或持久 Session。

Generate 和 Reject 不写文件。Apply 必须由用户明确触发并二次确认，TUI 将本次 source snapshot 与 core validated proposal 交给 host；host 再次验证 snapshot 和 proposal，不能以任意输入绕过 acceptance。没有 auto-apply 或 background mutation。

### Project boundary

打开项目时 resolve/realpath 并验证 directory。后续 listing/read/apply/undo 只接收 relative path，拒绝 absolute path、traversal、invalid components 与不允许访问的忽略目录。

检查 canonical containment，并拒绝项目内 symlink components（包括指向 root 内部的 symlink）；read/write 只支持 single-link regular files，避免通过 hardlink 访问另一文件。重复检查 root/parent/file identity，使用 no-follow read/temp handles。不存在、directory、special file、hardlink、binary/NUL 或 invalid UTF-8 为安全预期失败，不打印源码或 filesystem stack。

UTF-8 解码保留 BOM 与原始字符，不 trim、normalize 或改写 newlines。单文件读取最多 `5 MiB`，有界读取后复核 size/metadata；超限文件安全拒绝，不截断后送模型。Proposal 不允许生成无法按 UTF-8 round-trip 的文本。UI 只操作显式选择的文件，不递归自主改动、不执行 shell/tests/Git。

### Snapshot 与 stale protection

Generate 读取 source snapshot，并以原始 bytes 计算 SHA-256。进程内状态保存文件 relative path、sourceText/source hash 和 core accepted proposal。

Apply 再次读取同一项目文件，current hash 与 sourceText 必须仍等于生成时 snapshot；不一致返回 stale-proposal，要求重新 Generate。同时重新检查 oldText 非空、newText 为 string、文本会变化，oldText 在 current source 中 exact-match 唯一，包含 overlapping start positions；不进行 fuzzy matching、JSON repair 或 AST/syntax interpretation。

文件内容只作一处原始 string replacement，其他字符不改写。Proposal 对当前 snapshot 的唯一位置有意义，不承诺其他版本可用。

### Atomic replacement

同一 ProjectFiles instance 的 Apply/Undo 排队串行。写入采用同目录、唯一 temporary file，再 rename 替换目标；不直接原地覆盖目标到一半。

临时文件使用 exclusive creation/copy，保留可支持的既有 mode，不调用 chmod。通过 no-follow handle 写入完整 UTF-8 bytes 并 sync/close；commit 前重新检查 parent/target identity、version 和 content/hash，确认仍对应预期 snapshot，再 atomic rename。权限、ownership、special mode 或 filesystem 条件不满足时安全失败，不降低权限限制来强行写入。不承诺保留 ACL、extended attributes 或文件 identity；有这些 metadata 保留要求的文件不属于当前支持范围。

失败路径仅清理本操作创建且 identity 仍匹配的 temporary file；不能将变化的 parent/path 导向无关文件。极端的 parent replacement 可能使本次 temporary file 无法安全清理，宁可留下临时文件也不能沿变化路径删除无关文件。没有删除用户源文件、rename 无关文件、Git operation 或任意 patch application。

Atomic rename 保证目标路径看到完整旧/新内容；它不等于跨进程 compare-and-swap。普通外部变化在 read/hash/version checks 被拒绝，但 portable filesystem APIs 不能保证其他进程在最后检查与 rename 之间的对抗性修改完全被锁住。v0.2 不建立跨进程 filesystem lock、transaction framework、crash recovery 或 power-loss durability contract；同权限恶意本地进程不是本应用隔离的安全域。

### Undo

Apply 成功后在进程内保存 relative path、beforeText、afterText 与 after hash。Undo 必须用户明确触发，重新读取并验证 current hash/content 等于对应 after snapshot，才以同样 atomic replacement 恢复 before content。

如果已被外部修改，返回 stale-undo，不能覆盖用户新内容。UTF-8 支持范围内，BOM/newlines/原始字符原样恢复；不根据旧 anchor 猜测恢复位置。

只保证当前进程中的一次有效 Undo。成功新 Apply 替换旧 Undo，成功 Undo 消费该记录，打开其他 project 或退出 TUI 清空状态。不要求跨重启 persistence、chat history 或完整 edit journal。

### Failure 与 completion semantics

预期 path/read/write/schema/anchor/stale failure 使用结构化安全错误，由 TUI 显示简短可操作文字，不暴露 stack、key、Authorization、raw provider body 或完整源文件到 error logs。未知 programming throw/reject 由 host 保留，在最外层 terminal process boundary 显示通用错误并恢复 terminal。

Apply success 只表示对指定 snapshot 的文本替换已完成；Undo success 只表示对应原文本已恢复。不声称代码正确、bug solved、tests passed 或 instruction 一定满足。UI 清楚区分 proposal-ready、applying、applied、undo/error。

### Tests 与 scope

Offline tests 使用 temporary projects，覆盖 canonical containment、traversal/symlink/hardlink、lazy listing/ignore、UTF-8/binary、source hash、no auto-write、stale proposal、exact unique match、atomic Apply、Undo/stale Undo、安全 write failure 和权限保留；不修改真实用户项目。

TUI/controller integration 验证 Generate → review → explicit Apply confirmation → Undo，并验证文件内容实际变化/恢复。Real smoke 只按当前用户授权次数上限执行，不绕过 core acceptance 或自动 retry。

本 ADR 不批准多文件自主修改、generic patch engine、file watchers、shell/tests/Git、Tool registry/loop、AgentRuntime/Session、conversation persistence、remote execution 或自动 apply。

## Consequences

- v0.2 首次拥有受明确用户动作约束的 filesystem mutation；core proposal-only contract 与 CLI 行为不变。
- SHA-256/content/version checks 与 unique anchor check 防止应用已观察到的 stale proposal，Undo 不覆盖已观察到的外部新内容。
- 同目录完整 temporary write + rename 避免部分覆盖，不能承诺所有外部进程竞争或系统崩溃场景。
- conservative path/file checks 会拒绝 symlink、hardlink、NUL/binary、超过5 MiB、special-mode 或无法安全保留权限/ownership 的文件；不以 chmod 改写权限来绕过。
- Undo 与 proposal 只在当前 process 生效，不引入持久 Session、history、memory system 或数据库。

## Alternatives

- 自动 Apply：违反显式用户确认，拒绝。
- 只检查 oldText anchor、不比较 source hash：可能把过期建议应用到其他文本版本，使用 hash/content 与 unique anchor 两层检查。
- 原地 writeFile 覆盖：可能留下部分文件，采用同目录 temporary + atomic rename。
- Undo 不检查 after hash：会覆盖外部新修改，拒绝 stale Undo。
- core 增加 filesystem/path/hash/Undo API 或 generic patch engine：混淆 task acceptance 与 host responsibility，不采用。
- 跨进程 transaction/lock/journal：当前没有支持真实需求的可移植最小保证，不因此扩展为 filesystem framework。
