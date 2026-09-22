# Ariel

Ariel 是一个从第一性原理构建 autonomous coding agent 的开源项目，目前处于 **Milestone 001 — Repository Foundation** 阶段。

当前实际具备的是工程基础：TypeScript + Bun + ESM、四个 workspace、严格类型检查、lint、自动格式化、Bun 单元测试基础设施、架构边界检查、构建命令及 GitHub Actions CI 配置。

各 workspace 只有用于验证包解析和构建的占位模块。当前没有可用的 coding agent、CLI 命令、model provider 或 agent loop，也没有发布包或可执行文件。

- [开发与验证](docs/DEVELOPMENT.md)
- [当前架构与边界](docs/ARCHITECTURE.md)
- [阶段与验收目标](docs/ROADMAP.md)
- [架构决策索引](docs/DECISIONS.md)
- [Coding agent 仓库规则](AGENTS.md)

许可证尚待 Chief Architect 决定，本 milestone 不包含 LICENSE。
