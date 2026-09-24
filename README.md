# Ariel

Ariel 是一个从第一性原理构建 autonomous coding agent 的开源项目，目前处于 **Milestone 002 — CLI Foundation** 阶段。

当前具备 TypeScript + Bun + ESM 工程基础、四个 workspace、严格类型检查、lint、自动格式化、测试、架构边界检查、构建命令及 GitHub Actions CI 配置，以及可从终端启动的最小 CLI。

## 运行 CLI

使用 Bun 1.4.2，在仓库根目录执行：

```sh
bun install
bun run ariel --help
bun run ariel --version
bun run ariel
```

- `ariel --help`：显示名称、描述、usage 和支持的选项。
- `ariel --version`：输出 CLI package.json 中的版本。
- `ariel`：显示当前尚未实现交互式 Agent 的状态信息，退出码为 0。
- 未知参数：向 stderr 输出错误和帮助提示，退出码为 1。

安装后也可使用 `./node_modules/.bin/ariel`；如需在当前命令中直接使用名称：

```sh
PATH="$PWD/node_modules/.bin:$PATH" ariel --help
```

当前没有交互式 Agent、model provider、会话或 agent loop。core、providers 和 local-host 仍为占位模块；包均为 private，未发布。

- [开发与验证](docs/DEVELOPMENT.md)
- [当前架构与边界](docs/ARCHITECTURE.md)
- [阶段与验收目标](docs/ROADMAP.md)
- [架构决策索引](docs/DECISIONS.md)
- [Coding agent 仓库规则](AGENTS.md)

许可证尚待 Chief Architect 决定，仓库不包含 LICENSE。
