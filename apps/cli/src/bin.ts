#!/usr/bin/env bun
import { runCli } from "./index";

try {
  const result = await runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
} catch {
  process.stderr.write("错误：Ariel 遇到意外错误。\n");
  process.exitCode = 1;
}
