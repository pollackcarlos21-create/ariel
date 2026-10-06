import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { ModelResult } from "@ariel/core";
import {
  type FileCodeEditResult,
  runDeepSeekCodeEditFromFile,
  runDeepSeekCodeEditTask,
} from "@ariel/local-host";
import * as providers from "@ariel/providers";

const FAKE_KEY = "fixture-only-not-a-real-api-key";
const PRIVATE_MARKER = "fixture-private-source-or-provider-detail";
const INSTRUCTION = "Rename loadData to fetchData.";
const SOURCE = "function loadData() { return 1; }\n";
const PROPOSAL = { oldText: "loadData", newText: "fetchData" };

function completion(content: string): Record<string, unknown> {
  return {
    id: "fixture-code-edit",
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

function expectSafeFailure(
  result: FileCodeEditResult,
  kind:
    | "file-read-failure"
    | "invalid-task"
    | "model-failure"
    | "invalid-proposal",
) {
  expect(result.status).toBe("failed");
  if (result.status !== "failed") {
    throw new Error("Expected a structured file code edit failure.");
  }
  expect(result.error.kind).toBe(kind);
  expect(result.error.message.length).toBeGreaterThan(0);
  expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  expect(JSON.stringify(result)).not.toContain(PRIVATE_MARKER);
}

// The global fetch fixture is restored after every serial test. No real network.
describe.serial("local-host file code edit composition without network", () => {
  let directory: string;
  let fetchSpy: Mock<
    (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
  >;

  beforeEach(async () => {
    fetchSpy = spyOn(globalThis, "fetch");
    fetchSpy.mockRejectedValue(
      new Error("Offline file test requires an explicit fetch fixture."),
    );
    directory = await mkdtemp(join(tmpdir(), "ariel-code-edit-file-"));
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await rm(directory, { recursive: true, force: true });
  });

  async function sourceFile(source: string | Uint8Array = SOURCE) {
    const filePath = join(directory, "source example.ts");
    await writeFile(filePath, source);
    return filePath;
  }

  function successfulResponse(proposal = PROPOSAL) {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(completion(JSON.stringify(proposal)))),
    );
  }

  test.each([
    { name: "ordinary UTF-8", sourceText: SOURCE },
    { name: "CRLF and trailing whitespace", sourceText: "\tloadData();\r\n  " },
    { name: "UTF-8 BOM", sourceText: "\uFEFFloadData();\n" },
    { name: "Unicode", sourceText: "// 中文\nloadData();\n" },
  ])(
    "reads exact $name sourceText and original instruction",
    async ({ sourceText }) => {
      const filePath = await sourceFile(sourceText);
      const instruction = ` \t${INSTRUCTION}\n `;
      successfulResponse();

      const result = await runDeepSeekCodeEditFromFile(
        filePath,
        instruction,
        FAKE_KEY,
      );

      expect(result).toEqual({ status: "completed", proposal: PROPOSAL });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, options] = fetchSpy.mock.calls[0] ?? [];
      const body = JSON.parse(String(options?.body));
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toContain("oldText");
      expect(body.messages[0].content).toContain("newText");
      expect(body.messages[1].role).toBe("user");
      expect(JSON.parse(body.messages[1].content)).toEqual({
        instruction,
        sourceText,
      });
      expect(await readFile(filePath, "utf8")).toBe(sourceText);
    },
  );

  test("preserves whitespace-only sourceText and accepts a validated proposal", async () => {
    const sourceText = " \t\r\n ";
    const proposal = { oldText: sourceText, newText: "const value = 1;\n" };
    const filePath = await sourceFile(sourceText);
    successfulResponse(proposal);

    expect(
      await runDeepSeekCodeEditFromFile(
        filePath,
        "Add a declaration.",
        FAKE_KEY,
      ),
    ).toEqual({ status: "completed", proposal });
    const [, options] = fetchSpy.mock.calls[0] ?? [];
    const body = JSON.parse(String(options?.body));
    expect(JSON.parse(body.messages[1].content).sourceText).toBe(sourceText);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("supports an absolute source path", async () => {
    const filePath = await sourceFile();
    successfulResponse();

    expect(
      await runDeepSeekCodeEditFromFile(filePath, INSTRUCTION, FAKE_KEY),
    ).toEqual({ status: "completed", proposal: PROPOSAL });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("resolves a relative source path against the current process cwd", async () => {
    const filePath = await sourceFile();
    const relativePath = relative(process.cwd(), filePath);
    successfulResponse();

    expect(
      await runDeepSeekCodeEditFromFile(relativePath, INSTRUCTION, FAKE_KEY),
    ).toEqual({ status: "completed", proposal: PROPOSAL });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await readFile(filePath, "utf8")).toBe(SOURCE);
  });

  test("rejects an empty source before any model operation", async () => {
    const filePath = await sourceFile("");

    expectSafeFailure(
      await runDeepSeekCodeEditFromFile(filePath, INSTRUCTION, FAKE_KEY),
      "invalid-task",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(await readFile(filePath, "utf8")).toBe("");
  });

  test("rejects a whitespace-only instruction before any model operation", async () => {
    const filePath = await sourceFile();

    expectSafeFailure(
      await runDeepSeekCodeEditFromFile(filePath, " \n\t ", FAKE_KEY),
      "invalid-task",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test("returns a safe file-read failure for a missing file", async () => {
    const filePath = join(directory, `${PRIVATE_MARKER}.ts`);
    const result = await runDeepSeekCodeEditFromFile(
      filePath,
      INSTRUCTION,
      FAKE_KEY,
    );

    expectSafeFailure(result, "file-read-failure");
    expect(JSON.stringify(result)).not.toContain(filePath);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test("returns a safe file-read failure for a directory", async () => {
    expectSafeFailure(
      await runDeepSeekCodeEditFromFile(directory, INSTRUCTION, FAKE_KEY),
      "file-read-failure",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test.each([
    { name: "empty path", filePath: "" },
    { name: "NUL path", filePath: "invalid\0source.ts" },
  ])("returns a safe file-read failure for $name", async ({ filePath }) => {
    expectSafeFailure(
      await runDeepSeekCodeEditFromFile(filePath, INSTRUCTION, FAKE_KEY),
      "file-read-failure",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test("rejects malformed UTF-8 rather than replacing source characters", async () => {
    const bytes = new Uint8Array([0x66, 0x6f, 0x6f, 0xc3, 0x28]);
    const filePath = await sourceFile(bytes);

    expectSafeFailure(
      await runDeepSeekCodeEditFromFile(filePath, INSTRUCTION, FAKE_KEY),
      "file-read-failure",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(new Uint8Array(await readFile(filePath))).toEqual(bytes);
  });

  test("uses one explicit DeepSeek request and the v0.1 120000ms host timeout", async () => {
    const filePath = await sourceFile();
    successfulResponse();
    const timerSpy = spyOn(globalThis, "setTimeout");
    try {
      expect(
        await runDeepSeekCodeEditFromFile(filePath, INSTRUCTION, FAKE_KEY),
      ).toEqual({ status: "completed", proposal: PROPOSAL });

      expect(timerSpy).toHaveBeenCalledTimes(1);
      expect(timerSpy.mock.calls[0]?.[1]).toBe(120_000);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0] ?? [];
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect(options?.method).toBe("POST");
      expect(options?.redirect).toBe("error");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(options?.headers);
      expect(headers.get("Authorization") === `Bearer ${FAKE_KEY}`).toBe(true);
      expect(headers.get("Content-Type")).toBe("application/json");
      const body = JSON.parse(String(options?.body));
      expect(body).toEqual({
        model: "deepseek-flash",
        messages: [
          { role: "system", content: expect.any(String) },
          {
            role: "user",
            content: JSON.stringify({
              instruction: INSTRUCTION,
              sourceText: SOURCE,
            }),
          },
        ],
        thinking: { type: "disabled" },
        stream: false,
      });
    } finally {
      timerSpy.mockRestore();
    }
  });

  test("leaves source bytes, modification time and permissions unchanged", async () => {
    const source = "\uFEFF\tfunction loadData() {\r\n  return 1;\r\n}\r\n";
    const filePath = await sourceFile(source);
    const beforeBytes = await readFile(filePath);
    const beforeStat = await stat(filePath);
    successfulResponse();

    expect(
      await runDeepSeekCodeEditFromFile(filePath, INSTRUCTION, FAKE_KEY),
    ).toEqual({ status: "completed", proposal: PROPOSAL });

    const afterStat = await stat(filePath);
    expect(await readFile(filePath)).toEqual(beforeBytes);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    expect(afterStat.mode).toBe(beforeStat.mode);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test.each([400, 401, 402, 403, 422, 429, 500, 503, 599])(
    "returns safe HTTP %s diagnostic without exposing the failure body",
    async (status) => {
      const filePath = await sourceFile();
      fetchSpy.mockResolvedValue(
        new Response(`${PRIVATE_MARKER} ${FAKE_KEY}`, { status }),
      );

      const result = await runDeepSeekCodeEditFromFile(
        filePath,
        INSTRUCTION,
        FAKE_KEY,
      );
      expectSafeFailure(result, "model-failure");
      expect(result).toEqual({
        status: "failed",
        error: {
          kind: "model-failure",
          message: `DeepSeek code-edit request failed (HTTP ${status}).`,
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(await readFile(filePath, "utf8")).toBe(SOURCE);
    },
  );

  test.each([
    {
      name: "network",
      message: "DeepSeek code-edit network request failed.",
    },
    {
      name: "body",
      message: "DeepSeek code-edit response body could not be read.",
    },
    {
      name: "JSON",
      message: "DeepSeek code-edit response was not valid JSON.",
    },
    {
      name: "schema",
      message: "DeepSeek code-edit response was unsupported.",
    },
  ])(
    "returns a safe $name diagnostic without retry",
    async ({ name, message }) => {
      const filePath = await sourceFile();
      if (name === "network") {
        fetchSpy.mockRejectedValue(
          new TypeError(`${PRIVATE_MARKER} ${FAKE_KEY}`),
        );
      } else if (name === "body") {
        fetchSpy.mockResolvedValue(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(
                  new TypeError(`${PRIVATE_MARKER} ${FAKE_KEY}`),
                );
              },
            }),
          ),
        );
      } else {
        fetchSpy.mockResolvedValue(
          new Response(name === "JSON" ? PRIVATE_MARKER : "{}"),
        );
      }

      const result = await runDeepSeekCodeEditFromFile(
        filePath,
        INSTRUCTION,
        FAKE_KEY,
      );
      expectSafeFailure(result, "model-failure");
      expect(result).toEqual({
        status: "failed",
        error: { kind: "model-failure", message },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(await readFile(filePath, "utf8")).toBe(SOURCE);
    },
  );

  test("returns a safe timeout diagnostic after transport abort without retry", async () => {
    const filePath = await sourceFile();
    const timerSpy = spyOn(globalThis, "setTimeout");
    fetchSpy.mockImplementation((_url, options) => {
      const signal = options?.signal;
      const deadline = timerSpy.mock.calls[0]?.[0];
      if (!signal || typeof deadline !== "function") {
        throw new Error("Expected the adapter's explicit abort deadline.");
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
        deadline();
      });
    });
    try {
      const result = await runDeepSeekCodeEditFromFile(
        filePath,
        INSTRUCTION,
        FAKE_KEY,
      );
      expectSafeFailure(result, "model-failure");
      expect(result).toEqual({
        status: "failed",
        error: {
          kind: "model-failure",
          message: "DeepSeek code-edit request timed out.",
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(await readFile(filePath, "utf8")).toBe(SOURCE);
    } finally {
      timerSpy.mockRestore();
    }
  });

  test.each([
    PRIVATE_MARKER,
    `DeepSeek request failed with HTTP 401. ${FAKE_KEY}`,
    `DeepSeek request failed with HTTP 401.\n${PRIVATE_MARKER}`,
    `DeepSeek request timed out. ${FAKE_KEY}`,
    "DeepSeek request failed with HTTP 999.",
    "DeepSeek request failed with HTTP 401.",
  ])(
    "keeps the core generic failure for untrusted message %j",
    async (message) => {
      let calls = 0;
      const invalidRequest =
        message === "DeepSeek request failed with HTTP 401.";
      const factorySpy = spyOn(
        providers,
        "createDeepSeekModelPort",
      ).mockReturnValue({
        async generateText(): Promise<ModelResult> {
          calls += 1;
          return {
            status: "failed",
            error: {
              kind: invalidRequest ? "invalid-request" : "provider-failure",
              message,
            },
          };
        },
      });
      try {
        const result = await runDeepSeekCodeEditTask(
          INSTRUCTION,
          SOURCE,
          FAKE_KEY,
        );
        expectSafeFailure(result, "model-failure");
        expect(result).toEqual({
          status: "failed",
          error: {
            kind: "model-failure",
            message: "The model did not return a completed code edit proposal.",
          },
        });
        expect(calls).toBe(1);
        expect(fetchSpy).toHaveBeenCalledTimes(0);
      } finally {
        factorySpy.mockRestore();
      }
    },
  );

  test("keeps concurrent operation diagnostics independent", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(PRIVATE_MARKER, { status: 401 }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(PRIVATE_MARKER, { status: 429 }),
    );

    const results = await Promise.all([
      runDeepSeekCodeEditTask(INSTRUCTION, SOURCE, FAKE_KEY),
      runDeepSeekCodeEditTask(INSTRUCTION, SOURCE, FAKE_KEY),
    ]);

    expect(results).toEqual([
      {
        status: "failed",
        error: {
          kind: "model-failure",
          message: "DeepSeek code-edit request failed (HTTP 401).",
        },
      },
      {
        status: "failed",
        error: {
          kind: "model-failure",
          message: "DeepSeek code-edit request failed (HTTP 429).",
        },
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("preserves synchronous unexpected adapter throw identity", async () => {
    const error = new Error("Unexpected synchronous adapter fixture failure.");
    const factorySpy = spyOn(
      providers,
      "createDeepSeekModelPort",
    ).mockReturnValue({
      generateText() {
        throw error;
      },
    });
    try {
      await expect(
        runDeepSeekCodeEditTask(INSTRUCTION, SOURCE, FAKE_KEY),
      ).rejects.toBe(error);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      factorySpy.mockRestore();
    }
  });

  test("returns invalid-proposal after application validation without retry", async () => {
    const filePath = await sourceFile();
    successfulResponse({ oldText: PRIVATE_MARKER, newText: "replacement" });

    expectSafeFailure(
      await runDeepSeekCodeEditFromFile(filePath, INSTRUCTION, FAKE_KEY),
      "invalid-proposal",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await readFile(filePath, "utf8")).toBe(SOURCE);
  });

  test("preserves unexpected provider rejection identity", async () => {
    const filePath = await sourceFile();
    const error = new Error("Unexpected provider fixture rejection.");
    fetchSpy.mockRejectedValue(error);

    await expect(
      runDeepSeekCodeEditFromFile(filePath, INSTRUCTION, FAKE_KEY),
    ).rejects.toBe(error);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await readFile(filePath, "utf8")).toBe(SOURCE);
  });

  test("preserves unexpected I/O rejection identity before any model request", async () => {
    const filePath = await sourceFile();
    const error = new Error("Unexpected I/O fixture rejection.");
    const openSpy = spyOn(fs, "open").mockRejectedValue(error);
    try {
      await expect(
        runDeepSeekCodeEditFromFile(filePath, INSTRUCTION, FAKE_KEY),
      ).rejects.toBe(error);
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    } finally {
      openSpy.mockRestore();
    }
  });

  test.each(["EACCES", "EPERM", "EIO"])(
    "returns safe file-read failure for expected %s I/O failure",
    async (code) => {
      const filePath = await sourceFile();
      const error = Object.assign(new Error(`${PRIVATE_MARKER} ${FAKE_KEY}`), {
        code,
      });
      const openSpy = spyOn(fs, "open").mockRejectedValue(error);
      try {
        expectSafeFailure(
          await runDeepSeekCodeEditFromFile(filePath, INSTRUCTION, FAKE_KEY),
          "file-read-failure",
        );
        expect(fetchSpy).toHaveBeenCalledTimes(0);
      } finally {
        openSpy.mockRestore();
      }
    },
  );
});
