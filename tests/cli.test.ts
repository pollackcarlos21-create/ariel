import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runCli } from "@ariel/cli";
import manifest from "../apps/cli/package.json";

describe("CLI behavior without a process or terminal", () => {
  test("help writes the name, description, usage and options to stdout", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    for (const text of [
      "Ariel CLI",
      "命令行入口",
      "Usage: ariel",
      "--help",
      "--version",
      "model-demo <text>",
      "in-memory",
      'edit <file> "<instruction>"',
    ]) {
      expect(result.stdout).toContain(text);
    }
  });

  test("version matches the CLI package manifest", async () => {
    expect(await runCli(["--version"])).toEqual({
      exitCode: 0,
      stdout: `${manifest.version}\n`,
      stderr: "",
    });
  });

  test("default invocation presents the core application status and exits normally", async () => {
    expect(await runCli([])).toEqual({
      exitCode: 0,
      stdout:
        "Ariel CLI 已启动。当前支持单源码修改建议任务。\n使用 ariel --help 查看帮助。\n",
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
  ])("rejects unsupported arguments: %j", async ({ args }) => {
    const result = await runCli(args);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("错误：未知参数");
    expect(result.stderr).toContain("ariel --help");
    expect(result.stderr).not.toMatch(/\n\s+at\s|Error:|\.tsx?:\d/);
  });

  test("help takes precedence over version and repeated flags are idempotent", async () => {
    expect(await runCli(["--version", "--help"])).toEqual(
      await runCli(["--help"]),
    );
    expect(await runCli(["--help", "--version"])).toEqual(
      await runCli(["--help"]),
    );
    expect(await runCli(["--help", "--help"])).toEqual(
      await runCli(["--help"]),
    );
    expect(await runCli(["--version", "--version"])).toEqual(
      await runCli(["--version"]),
    );
  });
});

describe("in-memory model demo", () => {
  test("presents the deterministic result as a simulation", async () => {
    expect(await runCli(["model-demo", "hello"])).toEqual({
      exitCode: 0,
      stdout: "in-memory 模拟演示（未调用真实模型）。\nEcho: hello\n",
      stderr: "",
    });
  });

  test("rejects a missing text argument", async () => {
    expect(await runCli(["model-demo"])).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "错误：model-demo 需要一个 text 参数。\nUsage: ariel model-demo <text>\n",
    });
  });

  test("rejects extra arguments", async () => {
    expect(await runCli(["model-demo", "a", "b"])).toEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "错误：model-demo 只接受一个 text 参数。\nUsage: ariel model-demo <text>\n",
    });
  });

  test.each(["", " \t\n "])(
    "presents the core invalid-request result for %j",
    async (userText) => {
      expect(await runCli(["model-demo", userText])).toEqual({
        exitCode: 1,
        stdout: "",
        stderr:
          "错误：in-memory 模拟演示失败（invalid-request）：userText must not be empty.\n",
      });
    },
  );
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
    { args: ["model-demo", "hello"] },
    { args: ["model-demo"] },
    { args: ["model-demo", "a", "b"] },
    { args: ["model-demo", " "] },
  ])(
    "connects arguments, output streams and exit status: %j",
    async ({ args }) => {
      const expected = await runCli(args);
      const result = Bun.spawnSync([process.execPath, entrypoint, ...args], {
        cwd: tmpdir(),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(expected.exitCode);
      expect(result.stdout.toString()).toBe(expected.stdout);
      expect(result.stderr.toString()).toBe(expected.stderr);
    },
  );
});
