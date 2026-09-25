import { getApplicationStatus } from "@ariel/core";
import { version } from "../package.json";

export interface CliResult {
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
}

const help = `Ariel CLI
Ariel 的命令行入口；当前尚未实现交互式 Agent。

Usage: ariel [--help | --version]

Options:
  --help     显示帮助信息
  --version  显示 CLI 版本
`;

export function runCli(args: readonly string[]): CliResult {
  const unknown = args.find((arg) => arg !== "--help" && arg !== "--version");
  if (unknown !== undefined) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `错误：未知参数 ${JSON.stringify(unknown)}。\n使用 ariel --help 查看帮助。\n`,
    };
  }

  if (args.includes("--help")) {
    return { exitCode: 0, stdout: help, stderr: "" };
  }

  if (args.includes("--version")) {
    return { exitCode: 0, stdout: `${version}\n`, stderr: "" };
  }

  const status = getApplicationStatus();
  switch (status.agentExecution) {
    case "not-implemented":
      return {
        exitCode: 0,
        stdout:
          "Ariel CLI 已启动。当前尚未实现交互式 Agent。\n使用 ariel --help 查看帮助。\n",
        stderr: "",
      };
  }
}
