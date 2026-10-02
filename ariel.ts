#!/usr/bin/env bun
import { runCli } from "@ariel/cli";

// The repository launcher selects a concrete frontend; workspace boundaries stay
// independent. Non-interactive CLI logic remains available through @ariel/cli.
try {
  const args = process.argv.slice(2);
  if (
    args.length === 0 ||
    (args.length === 1 &&
      !args[0]?.startsWith("-") &&
      args[0] !== "edit" &&
      args[0] !== "model-demo")
  ) {
    const { launchTui } = await import("@ariel/tui");
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const exitCode = await launchTui({
      projectPath: args[0] ?? process.cwd(),
      ...(apiKey === undefined ? {} : { apiKey }),
      noColor: process.env.NO_COLOR !== undefined,
    });
    // TTY cleanup has completed. Exiting this executable also ends any pending
    // transport in this process, without adding cancellation to the core API.
    process.exit(exitCode);
  } else {
    const result = await runCli(
      args,
      args[0] === "edit" ? process.env.DEEPSEEK_API_KEY : undefined,
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  }
} catch {
  process.stderr.write("错误：Ariel 遇到意外错误。\n");
  process.exitCode = 1;
}
