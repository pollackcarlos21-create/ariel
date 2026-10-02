#!/usr/bin/env bun
import { runCli } from "./index";

try {
  const args = process.argv.slice(2);
  const apiKey = args[0] === "edit" ? process.env.DEEPSEEK_API_KEY : undefined;
  const result = await runCli(args, apiKey);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
} catch {
  process.stderr.write("错误：Ariel 遇到意外错误。\n");
  process.exitCode = 1;
}
