# Ariel

Ariel 是一个从第一性原理构建 autonomous coding agent 的开源项目。

当前具备 TypeScript + Bun + ESM 工程基础、四个 workspace、严格类型检查、lint、自动格式化、测试、架构边界检查、构建命令及 GitHub Actions CI 配置。CLI 默认启动查询 core application status；`model-demo` 通过 local-host、core ModelPort 和 providers adapter 执行 deterministic in-memory simulation，没有调用实际 LLM。

## 运行 CLI

使用 Bun 1.4.2，在仓库根目录执行：

```sh
bun install
bun run ariel --help
bun run ariel --version
bun run ariel
bun run ariel model-demo "hello"
```

- `ariel --help`：显示名称、描述、usage 和支持的选项。
- `ariel --version`：输出 CLI package.json 中的版本。
- `ariel`：显示当前尚未实现交互式 Agent 的状态信息，退出码为 0。
- `ariel model-demo "<text>"`：执行离线 in-memory 模拟演示，显示模拟标识和 `Echo: <text>`，退出码为 0。不需要 API key、网络、认证或配置。
- 未知参数：向 stderr 输出错误和帮助提示，退出码为 1。

`model-demo` 恰好接收一个 text 参数；缺失、多余或空白 text 均退出 1。它不读取 stdin、不进入交互模式。没有 `--system` 或其他模型选项。

安装后也可使用 `./node_modules/.bin/ariel`；如需在当前命令中直接使用名称：

```sh
PATH="$PWD/node_modules/.bin:$PATH" ariel --help
```

core 保留无参数、同步、无副作用的 `getApplicationStatus(): ApplicationStatus`，返回 `{ agentExecution: "not-implemented" }`。新增的 `requestModelText(request, modelPort): Promise<ModelResult>` 校验输入并显式调用传入的 ModelPort；契约不依赖供应商 SDK 或宿主实现。

providers 提供确定性的 in-memory adapter，local-host 负责离线 demo 的真实装配。该 demo 不代表 Agent execution，application status 不变。当前没有真实 LLM provider、会话、tool、streaming 或 agent loop；包均为 private，未发布。

- [开发与验证](docs/DEVELOPMENT.md)
- [当前架构与边界](docs/ARCHITECTURE.md)
- [阶段与验收目标](docs/ROADMAP.md)
- [架构决策索引](docs/DECISIONS.md)
- [Coding agent 仓库规则](AGENTS.md)

许可证尚待 Chief Architect 决定，仓库不包含 LICENSE。
