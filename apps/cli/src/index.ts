import { type CodeEditProposal, getApplicationStatus } from "@ariel/core";
import {
  runDeepSeekCodeEditFromFile,
  runInMemoryModelDemo,
} from "@ariel/local-host";
import { version } from "../package.json";

export interface CliResult {
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
}

const help = `Ariel CLI
Ariel 的命令行入口；当前支持单源码修改建议任务。

Usage: ariel [project-path]  进入交互式 TUI（需要 TTY）
       ariel [--help | --version]
       ariel model-demo <text>
       ariel edit <file> "<instruction>"

Commands:
  model-demo <text>  运行 in-memory 模拟演示（未调用真实模型）
  edit <file> "<instruction>"  用 DeepSeek 生成一处修改建议，不修改文件

Options:
  --help     显示帮助信息
  --version  显示 CLI 版本
`;

function terminalText(text: string): string {
  // Display untrusted terminal controls as text; proposal values stay unchanged.
  return text.replace(/\p{Cc}/gu, (character) => {
    if (character === "\n" || character === "\t") return character;
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

function renderProposal(
  filePath: string,
  proposal: CodeEditProposal,
  apiKey: string,
): string {
  let redacted = false;
  const display = (text: string): string => {
    let hidden = text.replaceAll(apiKey, "");
    const credential = apiKey.trim();
    while (hidden.includes(credential)) {
      hidden = hidden.replaceAll(credential, "");
    }
    if (hidden !== text) redacted = true;
    return terminalText(hidden);
  };
  const before = display(proposal.oldText)
    .split("\n")
    .map((line) => `- ${line}`)
    .join("\n");
  const after =
    proposal.newText === ""
      ? "（删除；newText 为空）"
      : display(proposal.newText)
          .split("\n")
          .map((line) => `+ ${line}`)
          .join("\n");
  const fileLabel = display(filePath)
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  const redactionNotice = redacted
    ? "Credential occurrences are hidden in this preview.\n"
    : "";
  return `Ariel Code Edit Proposal\n\nFile: ${fileLabel}\n\n--- before\n+++ after\n@@ proposal @@\n${before}\n${after}\n\n${redactionNotice}Proposal validated.\nNo files were modified.\n`;
}

export async function runCli(
  args: readonly string[],
  apiKey?: string,
): Promise<CliResult> {
  if (args[0] === "edit") {
    const filePath = args[1];
    const instruction = args[2];
    if (
      args.length !== 3 ||
      filePath === undefined ||
      instruction === undefined
    ) {
      return {
        exitCode: 1,
        stdout: "",
        stderr:
          '错误：edit 需要且只接受 file 和 instruction 两个参数。\nUsage: ariel edit <file> "<instruction>"\n',
      };
    }
    if (apiKey === undefined || apiKey.trim().length === 0) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "错误：请先配置非空的 DEEPSEEK_API_KEY 环境变量。\n",
      };
    }

    const result = await runDeepSeekCodeEditFromFile(
      filePath,
      instruction,
      apiKey,
    );
    if (result.status === "completed") {
      return {
        exitCode: 0,
        stdout: renderProposal(filePath, result.proposal, apiKey),
        stderr: "",
      };
    }
    const errors = {
      "file-read-failure": "无法读取源码文件，请检查路径和文件读取权限。",
      "invalid-task": "修改要求必须包含非空白字符，源码文件必须非空。",
      "model-failure": "DeepSeek 模型请求失败，请检查配置或稍后重试。",
      "invalid-proposal": "模型返回的修改建议未通过 Ariel validation。",
    };
    return {
      exitCode: 1,
      stdout: "",
      stderr: `错误：${errors[result.error.kind]}\n`,
    };
  }

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
    case "single-source-code-edit-proposal":
      return {
        exitCode: 0,
        stdout:
          "Ariel CLI 已启动。当前支持单源码修改建议任务。\n使用 ariel --help 查看帮助。\n",
        stderr: "",
      };
  }
}
