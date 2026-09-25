import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runCli } from "@ariel/cli";
import manifest from "../apps/cli/package.json";

describe("CLI behavior without a process or terminal", () => {
  test("help writes the name, description, usage and options to stdout", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    for (const text of [
      "Ariel CLI",
      "命令行入口",
      "Usage: ariel",
      "--help",
      "--version",
    ]) {
      expect(result.stdout).toContain(text);
    }
  });

  test("version matches the CLI package manifest", () => {
    expect(runCli(["--version"])).toEqual({
      exitCode: 0,
      stdout: `${manifest.version}\n`,
      stderr: "",
    });
  });

  test("default invocation presents the core application status and exits normally", () => {
    expect(runCli([])).toEqual({
      exitCode: 0,
      stdout:
        "Ariel CLI 已启动。当前尚未实现交互式 Agent。\n使用 ariel --help 查看帮助。\n",
      stderr: "",
    });
  });

  test.each([
    { args: ["--unknown"] },
    { args: ["chat"] },
    { args: ["--help", "--unknown"] },
    { args: ["--unknown", "--version"] },
    { args: ["--version=1"] },
    { args: [""] },
  ])("rejects unsupported arguments: %j", ({ args }) => {
    const result = runCli(args);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("错误：未知参数");
    expect(result.stderr).toContain("ariel --help");
    expect(result.stderr).not.toMatch(/\n\s+at\s|Error:|\.tsx?:\d/);
  });

  test("help takes precedence over version and repeated flags are idempotent", () => {
    expect(runCli(["--version", "--help"])).toEqual(runCli(["--help"]));
    expect(runCli(["--help", "--version"])).toEqual(runCli(["--help"]));
    expect(runCli(["--help", "--help"])).toEqual(runCli(["--help"]));
    expect(runCli(["--version", "--version"])).toEqual(runCli(["--version"]));
  });
});

describe("executable entrypoint", () => {
  const entrypoint = resolve(
    import.meta.dir,
    "../apps/cli",
    manifest.bin.ariel,
  );

  test.each([
    { args: [] },
    { args: ["--help"] },
    { args: ["--version"] },
    { args: ["--unknown"] },
  ])("connects arguments, output streams and exit status: %j", ({ args }) => {
    const expected = runCli(args);
    const result = Bun.spawnSync([process.execPath, entrypoint, ...args], {
      cwd: tmpdir(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(expected.exitCode);
    expect(result.stdout.toString()).toBe(expected.stdout);
    expect(result.stderr.toString()).toBe(expected.stderr);
  });
});
