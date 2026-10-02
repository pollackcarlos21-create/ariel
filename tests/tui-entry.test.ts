import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runCli } from "@ariel/cli";

const launcher = resolve(import.meta.dir, "../ariel.ts");

function launch(args: readonly string[]) {
  return Bun.spawnSync([process.execPath, launcher, ...args], {
    cwd: tmpdir(),
    env: { NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  });
}

describe("repository launcher keeps non-interactive CLI compatibility", () => {
  test.each([
    { args: ["--help"] },
    { args: ["--version"] },
    { args: ["--unknown"] },
    { args: ["model-demo", "hello"] },
    { args: ["model-demo"] },
    { args: ["model-demo", "a", "b"] },
    { args: ["edit"] },
    { args: ["edit", "example.ts"] },
    { args: ["edit", "example.ts", "instruction", "extra"] },
    { args: ["edit", "example.ts", "instruction"] },
  ])(
    "delegates without importing the interactive frontend: %j",
    async ({ args }) => {
      const expected = await runCli(args);
      const actual = launch(args);
      expect(actual.exitCode).toBe(expected.exitCode);
      expect(actual.stdout.toString()).toBe(expected.stdout);
      expect(actual.stderr.toString()).toBe(expected.stderr);
      expect(actual.stdout.toString()).not.toContain("\u001b");
    },
  );

  test.each([{ args: [] }, { args: ["."] }, { args: [tmpdir()] }])(
    "interactive invocation fails safely when no TTY is attached: %j",
    ({ args }) => {
      const actual = launch(args);
      expect(actual.exitCode).toBe(1);
      expect(actual.stdout.toString()).toBe("");
      expect(actual.stderr.toString()).toContain("TTY");
      expect(actual.stderr.toString()).not.toMatch(
        /\n\s+at\s|Error:|\.tsx?:\d/,
      );
      expect(actual.stderr.toString()).not.toContain("\u001b");
    },
  );
});
