import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { runCli } from "@ariel/cli";

const FAKE_API_KEY = "fixture-only-not-a-real-api-key";
const PRIVATE_PROVIDER_BODY = "fixture-private-upstream-body";
const SOURCE_TEXT = "function loadData() {\n  return 42;\n}\n";
const INSTRUCTION = "  make this function async  ";
const PROPOSAL = {
  oldText: "function loadData() {",
  newText: "async function loadData() {",
};
const entrypoint = resolve(import.meta.dir, "../apps/cli/src/bin.ts");

function responseBody(content: string): object {
  return {
    id: "fixture-completion",
    object: "chat.completion",
    created: 0,
    model: "fixture-reported-model",
    system_fingerprint: "fixture-fingerprint",
    choices: [
      {
        index: 0,
        logprobs: null,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
  };
}

function completion(proposal: unknown): Response {
  return new Response(JSON.stringify(responseBody(JSON.stringify(proposal))));
}

function expectSafeFailure(result: Awaited<ReturnType<typeof runCli>>): void {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toStartWith("错误：");
  expect(result.stderr).not.toContain(FAKE_API_KEY);
  expect(result.stderr).not.toContain(PRIVATE_PROVIDER_BODY);
  expect(result.stderr).not.toContain(SOURCE_TEXT);
  expect(result.stderr).not.toMatch(/\n\s+at\s|Error:|\.tsx?:\d/);
}

describe.serial("real-provider edit CLI with offline transport", () => {
  let directory: string;
  let sourcePath: string;
  let fetchSpy: Mock<
    (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
  >;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ariel-cli-edit-"));
    sourcePath = join(directory, "example.ts");
    await writeFile(sourcePath, SOURCE_TEXT);
    fetchSpy = spyOn(globalThis, "fetch");
    fetchSpy.mockRejectedValue(
      new Error("Offline test requires an explicit fetch fixture."),
    );
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await rm(directory, { recursive: true, force: true });
  });

  test("help includes the real edit usage without requesting a model", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('ariel edit <file> "<instruction>"');
    expect(result.stdout).toContain("DeepSeek");
    expect(result.stdout).toContain("不修改文件");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test.each([
    { args: ["edit"] },
    { args: ["edit", "example.ts"] },
    { args: ["edit", "example.ts", "instruction", "extra"] },
  ])(
    "rejects invalid edit arguments without a model call: %j",
    async ({ args }) => {
      const result = await runCli(args, FAKE_API_KEY);
      expectSafeFailure(result);
      expect(result.stderr).toContain("file 和 instruction 两个参数");
      expect(result.stderr).toContain('ariel edit <file> "<instruction>"');
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  test.each([undefined, "", " \t\n "])(
    "rejects missing or blank explicit credentials without a model call: %j",
    async (apiKey) => {
      const result = await runCli(["edit", sourcePath, INSTRUCTION], apiKey);
      expectSafeFailure(result);
      expect(result.stderr).toContain("DEEPSEEK_API_KEY");
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  test("accepts two positional arguments and displays a validated proposal without changing the source", async () => {
    fetchSpy.mockResolvedValue(completion(PROPOSAL));
    const result = await runCli(
      ["edit", sourcePath, INSTRUCTION],
      FAKE_API_KEY,
    );
    expect(result).toEqual({
      exitCode: 0,
      stdout: `Ariel Code Edit Proposal\n\nFile: ${sourcePath}\n\n--- before\n+++ after\n@@ proposal @@\n- function loadData() {\n+ async function loadData() {\n\nProposal validated.\nNo files were modified.\n`,
      stderr: "",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(options?.method).toBe("POST");
    expect(options?.redirect).toBe("error");
    expect(
      new Headers(options?.headers).get("Authorization") ===
        `Bearer ${FAKE_API_KEY}`,
    ).toBe(true);
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe("deepseek-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.stream).toBe(false);
    expect(body.messages[0].role).toBe("system");
    expect(JSON.parse(body.messages[1].content)).toEqual({
      instruction: INSTRUCTION,
      sourceText: SOURCE_TEXT,
    });
    expect(await readFile(sourcePath, "utf8")).toBe(SOURCE_TEXT);
  });

  test("resolves a relative file path against the current cwd", async () => {
    fetchSpy.mockResolvedValue(completion(PROPOSAL));
    const fileArgument = relative(process.cwd(), sourcePath);
    const result = await runCli(
      ["edit", fileArgument, INSTRUCTION],
      FAKE_API_KEY,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`File: ${fileArgument}\n`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await readFile(sourcePath, "utf8")).toBe(SOURCE_TEXT);
  });

  test("renders every old and new line with a separate prefix", async () => {
    fetchSpy.mockResolvedValue(
      completion({
        oldText: SOURCE_TEXT,
        newText: "async function loadData() {\n  return 43;\n}\n",
      }),
    );
    const result = await runCli(
      ["edit", sourcePath, INSTRUCTION],
      FAKE_API_KEY,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "- function loadData() {\n-   return 42;\n- }\n- \n",
    );
    expect(result.stdout).toContain(
      "+ async function loadData() {\n+   return 43;\n+ }\n+ \n",
    );
    expect(result.stdout).toContain("No files were modified.");
    expect(await readFile(sourcePath, "utf8")).toBe(SOURCE_TEXT);
  });

  test("renders an empty replacement as deletion", async () => {
    fetchSpy.mockResolvedValue(
      completion({ oldText: SOURCE_TEXT, newText: "" }),
    );
    const result = await runCli(
      ["edit", sourcePath, "delete this function"],
      FAKE_API_KEY,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("（删除；newText 为空）");
    expect(result.stdout).not.toContain("\n+ ");
    expect(result.stdout).toContain(
      "Proposal validated.\nNo files were modified.",
    );
    expect(await readFile(sourcePath, "utf8")).toBe(SOURCE_TEXT);
  });

  test("preserves whitespace-only source text through the host and core", async () => {
    const sourceText = " \t\n ";
    await writeFile(sourcePath, sourceText);
    fetchSpy.mockResolvedValue(completion({ oldText: "\t", newText: "  " }));
    const result = await runCli(
      ["edit", sourcePath, "replace tab"],
      FAKE_API_KEY,
    );
    expect(result.exitCode).toBe(0);
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(String(options?.body));
    expect(JSON.parse(body.messages[1].content).sourceText).toBe(sourceText);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceText);
  });

  test("presents an empty file as an invalid task without a model call", async () => {
    await writeFile(sourcePath, "");
    const result = await runCli(
      ["edit", sourcePath, INSTRUCTION],
      FAKE_API_KEY,
    );
    expectSafeFailure(result);
    expect(result.stderr).toContain("源码文件必须非空");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test.each(["", " \t\n "])(
    "presents invalid instructions without a model call: %j",
    async (instruction) => {
      const result = await runCli(
        ["edit", sourcePath, instruction],
        FAKE_API_KEY,
      );
      expectSafeFailure(result);
      expect(result.stderr).toContain("修改要求必须包含非空白字符");
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  test("presents a missing file as a safe read failure without a model call", async () => {
    const result = await runCli(
      ["edit", join(directory, "missing.ts"), INSTRUCTION],
      FAKE_API_KEY,
    );
    expectSafeFailure(result);
    expect(result.stderr).toContain("无法读取源码文件");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("presents a directory as a safe read failure without a model call", async () => {
    const result = await runCli(["edit", directory, INSTRUCTION], FAKE_API_KEY);
    expectSafeFailure(result);
    expect(result.stderr).toContain("无法读取源码文件");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("presents invalid proposals without exposing model content or retrying", async () => {
    fetchSpy.mockResolvedValue(
      completion({ ...PROPOSAL, explanation: PRIVATE_PROVIDER_BODY }),
    );
    const result = await runCli(
      ["edit", sourcePath, INSTRUCTION],
      FAKE_API_KEY,
    );
    expectSafeFailure(result);
    expect(result.stderr).toContain("未通过 Ariel validation");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await readFile(sourcePath, "utf8")).toBe(SOURCE_TEXT);
  });

  test("presents provider failures with fixed text and no upstream body", async () => {
    fetchSpy.mockResolvedValue(
      new Response(`${FAKE_API_KEY} ${PRIVATE_PROVIDER_BODY}`, { status: 401 }),
    );
    const result = await runCli(
      ["edit", sourcePath, INSTRUCTION],
      FAKE_API_KEY,
    );
    expectSafeFailure(result);
    expect(result.stderr).toContain("DeepSeek 模型请求失败");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await readFile(sourcePath, "utf8")).toBe(SOURCE_TEXT);
  });

  test("lets unexpected errors propagate through runCli unchanged", async () => {
    const error = new Error(PRIVATE_PROVIDER_BODY);
    fetchSpy.mockRejectedValue(error);
    await expect(
      runCli(["edit", sourcePath, INSTRUCTION], FAKE_API_KEY),
    ).rejects.toBe(error);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await readFile(sourcePath, "utf8")).toBe(SOURCE_TEXT);
  });

  test("escapes terminal controls only for display while accepting exact source anchors", async () => {
    const sourceText = "const value = '\u001b[31m';\r\n";
    const replacement = "const value = '\u001b[32m';\r\n";
    await writeFile(sourcePath, sourceText);
    fetchSpy.mockResolvedValue(
      completion({ oldText: sourceText, newText: replacement }),
    );
    const result = await runCli(
      ["edit", sourcePath, INSTRUCTION],
      FAKE_API_KEY,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("- const value = '\\u001b[31m';\\u000d\n");
    expect(result.stdout).toContain("+ const value = '\\u001b[32m';\\u000d\n");
    expect(result.stdout).not.toContain("\u001b");
    expect(result.stdout).not.toContain("\r");
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(String(options?.body));
    expect(JSON.parse(body.messages[1].content).sourceText).toBe(sourceText);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceText);
  });

  test("escapes newline and terminal controls in the displayed file path", async () => {
    sourcePath = join(directory, "example\n\u001b.ts");
    await writeFile(sourcePath, SOURCE_TEXT);
    fetchSpy.mockResolvedValue(completion(PROPOSAL));
    const result = await runCli(
      ["edit", sourcePath, INSTRUCTION],
      FAKE_API_KEY,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("example\\n\\u001b.ts\n");
    expect(result.stdout).not.toContain("\u001b");
    expect(await readFile(sourcePath, "utf8")).toBe(SOURCE_TEXT);
  });

  test("hides configured credential occurrences in the preview without rewriting the task or file", async () => {
    const configuredKey = ` ${FAKE_API_KEY} `;
    const sourceText = `const first = '${configuredKey}';\nconst second = '${FAKE_API_KEY}';\n`;
    const newText = `const replacement = '${FAKE_API_KEY}';\n`;
    sourcePath = join(directory, `${FAKE_API_KEY}.ts`);
    await writeFile(sourcePath, sourceText);
    fetchSpy.mockResolvedValue(completion({ oldText: sourceText, newText }));
    const result = await runCli(
      ["edit", sourcePath, INSTRUCTION],
      configuredKey,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(FAKE_API_KEY);
    expect(result.stdout).not.toContain(configuredKey);
    expect(result.stdout).toContain("File: ");
    expect(result.stdout).toContain(`${directory}/.ts\n`);
    expect(result.stdout).toContain("- const first = '';\n");
    expect(result.stdout).toContain("- const second = '';\n");
    expect(result.stdout).toContain("+ const replacement = '';\n");
    expect(result.stdout).toContain(
      "Credential occurrences are hidden in this preview.",
    );
    expect(result.stdout).toContain(
      "Proposal validated.\nNo files were modified.",
    );
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(String(options?.body));
    expect(JSON.parse(body.messages[1].content)).toEqual({
      instruction: INSTRUCTION,
      sourceText,
    });
    expect(await readFile(sourcePath, "utf8")).toBe(sourceText);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("does not reintroduce a short credential through a redaction marker", async () => {
    const apiKey = "credential";
    const sourceText = "const credentialValue = 'credential';\n";
    const newText = "const credentialValue = 'new credential';\n";
    sourcePath = join(directory, "credential.ts");
    await writeFile(sourcePath, sourceText);
    fetchSpy.mockResolvedValue(completion({ oldText: sourceText, newText }));
    const result = await runCli(["edit", sourcePath, INSTRUCTION], apiKey);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(apiKey);
    expect(result.stdout).toContain(`${directory}/.ts\n`);
    expect(result.stdout).toContain("- const Value = '';\n");
    expect(result.stdout).toContain("+ const Value = 'new ';\n");
    expect(result.stdout).toContain(
      "Credential occurrences are hidden in this preview.",
    );
    expect(result.stdout).toContain(
      "Proposal validated.\nNo files were modified.",
    );
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(String(options?.body));
    expect(JSON.parse(body.messages[1].content).sourceText).toBe(sourceText);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceText);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("bin maps explicit fake environment configuration to the complete successful offline edit path", async () => {
    const preload = join(directory, "transport-fixture.ts");
    await writeFile(
      preload,
      `
let calls = 0;
globalThis.fetch = async (input, options) => {
  calls += 1;
  if (calls !== 1 || input !== "https://api.deepseek.com/chat/completions") {
    throw new Error("Unexpected fixture request.");
  }
  if (new Headers(options.headers).get("Authorization") !== ${JSON.stringify(`Bearer ${FAKE_API_KEY}`)}) {
    throw new Error("Fixture credential was not passed explicitly.");
  }
  const body = JSON.parse(options.body);
  const task = JSON.parse(body.messages[1].content);
  if (body.model !== "deepseek-flash" || task.sourceText !== ${JSON.stringify(SOURCE_TEXT)} || task.instruction !== ${JSON.stringify(INSTRUCTION)}) {
    throw new Error("Fixture composition did not preserve the task.");
  }
  return new Response(${JSON.stringify(JSON.stringify(responseBody(JSON.stringify(PROPOSAL))))});
};
`,
    );
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--preload",
        preload,
        entrypoint,
        "edit",
        "example.ts",
        INSTRUCTION,
      ],
      {
        cwd: directory,
        env: { DEEPSEEK_API_KEY: FAKE_API_KEY },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toContain("File: example.ts\n");
    expect(result.stdout.toString()).toContain(
      "- function loadData() {\n+ async function loadData() {",
    );
    expect(result.stdout.toString()).toContain(
      "Proposal validated.\nNo files were modified.",
    );
    expect(result.stdout.toString()).not.toContain(FAKE_API_KEY);
    expect(await readFile(sourcePath, "utf8")).toBe(SOURCE_TEXT);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("bin converts an unexpected rejection to its generic process-boundary error", async () => {
    const preload = join(directory, "unexpected-fixture.ts");
    await writeFile(
      preload,
      `globalThis.fetch = async () => { throw new Error(${JSON.stringify(`${FAKE_API_KEY} ${PRIVATE_PROVIDER_BODY}`)}); };`,
    );
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--preload",
        preload,
        entrypoint,
        "edit",
        sourcePath,
        INSTRUCTION,
      ],
      {
        cwd: directory,
        env: { DEEPSEEK_API_KEY: FAKE_API_KEY },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("错误：Ariel 遇到意外错误。\n");
    expect(await readFile(sourcePath, "utf8")).toBe(SOURCE_TEXT);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("bin presents missing environment configuration without transport", async () => {
    const preload = join(directory, "unreachable-fixture.ts");
    await writeFile(
      preload,
      `globalThis.fetch = async () => { throw new Error("Transport must not be reached."); };`,
    );
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--preload",
        preload,
        entrypoint,
        "edit",
        sourcePath,
        INSTRUCTION,
      ],
      {
        cwd: directory,
        env: {},
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe(
      "错误：请先配置非空的 DEEPSEEK_API_KEY 环境变量。\n",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
