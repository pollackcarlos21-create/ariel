import { getApplicationStatus } from "@ariel/core";
import { runInMemoryModelDemo } from "@ariel/local-host";
import { version } from "../package.json";

export interface CliResult {
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
}

const help = `Ariel CLI
Ariel 的命令行入口；当前尚未实现交互式 Agent。

Usage: ariel [--help | --version]
       ariel model-demo <text>

Commands:
  model-demo <text>  运行 in-memory 模拟演示（未调用真实模型）

Options:
  --help     显示帮助信息
  --version  显示 CLI 版本
`;

export async function runCli(args: readonly string[]): Promise<CliResult> {
  if (args[0] === "model-demo") {
    const userText = args[1];
    if (userText === undefined) {
      return {
        exitCode: 1,
        stdout: "",
        stderr:
          "错误：model-demo 需要一个 text 参数。\nUsage: ariel model-demo <text>\n",
      };
    }
    if (args.length !== 2) {
      return {
        exitCode: 1,
        stdout: "",
        stderr:
          "错误：model-demo 只接受一个 text 参数。\nUsage: ariel model-demo <text>\n",
      };
    }

    const result = await runInMemoryModelDemo(userText);
    switch (result.status) {
      case "completed":
        return {
          exitCode: 0,
          stdout: `in-memory 模拟演示（未调用真实模型）。\n${result.text}\n`,
          stderr: "",
        };
      case "failed":
        return {
          exitCode: 1,
          stdout: "",
          stderr: `错误：in-memory 模拟演示失败（${result.error.kind}）：${result.error.message}\n`,
        };
    }
  }

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
