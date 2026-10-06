#!/usr/bin/env bun
import { runCli } from "./index";
import { parseArielModelConfig } from "@ariel/local-host";

try {
  const args = process.argv.slice(2);
  const config =
    args[0] === "edit" ? parseArielModelConfig(process.env) : undefined;
  const result = await runCli(args, config);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
} catch {
  process.stderr.write("错误：Ariel 遇到意外错误。\n");
  process.exitCode = 1;
}
