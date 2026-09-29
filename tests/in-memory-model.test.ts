import { expect, test } from "bun:test";
import type { ModelPort, ModelResult } from "@ariel/core";
import { runInMemoryModelDemo } from "@ariel/local-host";
import { createInMemoryModelPort } from "@ariel/providers";

test.each([
  ["hello", "Echo: hello"],
  ["different input", "Echo: different input"],
  ["  hello  ", "Echo:   hello  "],
])("in-memory adapter deterministically echoes %j", async (userText, text) => {
  const modelPort: ModelPort = createInMemoryModelPort();
  const request = { userText };
  const expected: ModelResult = { status: "completed", text };

  expect(await modelPort.generateText(request)).toEqual(expected);
  expect(await modelPort.generateText(request)).toEqual(expected);
});

test("local-host composes the real adapter and core operation", async () => {
  expect(await runInMemoryModelDemo("hello")).toEqual({
    status: "completed",
    text: "Echo: hello",
  });
});

test("local-host returns core validation failure", async () => {
  expect(await runInMemoryModelDemo(" \t\n ")).toMatchObject({
    status: "failed",
    error: { kind: "invalid-request" },
  });
});

test("in-memory composition runs with an empty environment and no setup", () => {
  const child = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      'import { runInMemoryModelDemo } from "@ariel/local-host"; console.log(JSON.stringify(await runInMemoryModelDemo("offline")));',
    ],
    {
      cwd: `${import.meta.dir}/..`,
      env: {},
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  expect(child.exitCode).toBe(0);
  expect(new TextDecoder().decode(child.stdout)).toBe(
    '{"status":"completed","text":"Echo: offline"}\n',
  );
  expect(new TextDecoder().decode(child.stderr)).toBe("");
});
