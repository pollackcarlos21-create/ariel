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
import {
  type ArielModelProvider,
  parseArielModelConfig,
  runConfiguredCodeEditFromFile,
  runConfiguredCodeEditTask,
} from "@ariel/local-host";

const FAKE_KEY = "fixture-only-compatible-key";
const SOURCE = "function loadData() { return 1; }\r\n";
const PROPOSAL = { oldText: "loadData", newText: "fetchData" };
const COMPATIBLE = {
  kind: "openai-compatible",
  baseUrl: "https://example.com/v1/",
  model: "fixture-model",
} satisfies ArielModelProvider;
const COMPATIBLE_ENV = {
  ARIEL_PROVIDER: "openai-compatible",
  OPENAI_COMPATIBLE_BASE_URL: COMPATIBLE.baseUrl,
  OPENAI_COMPATIBLE_MODEL: COMPATIBLE.model,
};

describe("explicit model environment config parser", () => {
  test.each([undefined, "deepseek"])(
    "defaults or explicitly selects DeepSeek: %j",
    (kind) => {
      expect(
        parseArielModelConfig({
          ARIEL_PROVIDER: kind,
          DEEPSEEK_API_KEY: FAKE_KEY,
        }),
      ).toEqual({
        status: "configured",
        provider: { kind: "deepseek", apiKey: FAKE_KEY },
      });
    },
  );
  test.each([undefined, "", " \t\n "])(
    "rejects absent/blank DeepSeek key: %j",
    (key) => {
      expect(parseArielModelConfig({ DEEPSEEK_API_KEY: key })).toEqual({
        status: "failed",
        providerName: "DeepSeek",
        error: { message: "请先配置非空的 DEEPSEEK_API_KEY 环境变量。" },
      });
    },
  );
  test.each(["", "unknown", " deepseek ", FAKE_KEY])(
    "rejects unknown provider without echoing it: %j",
    (kind) => {
      expect(
        parseArielModelConfig({
          ARIEL_PROVIDER: kind,
          DEEPSEEK_API_KEY: FAKE_KEY,
        }),
      ).toEqual({
        status: "failed",
        providerName: "Model provider",
        error: { message: "Unsupported ARIEL_PROVIDER." },
      });
    },
  );
  test("accepts compatible config with key and preserves original model/key", () => {
    const model = " fixture-model ";
    const key = ` ${FAKE_KEY} `;
    expect(
      parseArielModelConfig({
        ...COMPATIBLE_ENV,
        OPENAI_COMPATIBLE_MODEL: model,
        OPENAI_COMPATIBLE_API_KEY: key,
      }),
    ).toEqual({
      status: "configured",
      provider: { ...COMPATIBLE, model, apiKey: key },
    });
  });
  test.each([undefined, "", " \t\r\n "])(
    "allows compatible endpoints without authentication: %j",
    (key) => {
      expect(
        parseArielModelConfig({
          ...COMPATIBLE_ENV,
          OPENAI_COMPATIBLE_API_KEY: key,
        }),
      ).toEqual({ status: "configured", provider: COMPATIBLE });
    },
  );
  test.each(["OPENAI_COMPATIBLE_BASE_URL", "OPENAI_COMPATIBLE_MODEL"])(
    "requires %s",
    (field) => {
      for (const value of [undefined, "", " \t "]) {
        const result = parseArielModelConfig({
          ...COMPATIBLE_ENV,
          [field]: value,
        });
        expect(result.status).toBe("failed");
        if (result.status === "failed")
          expect(result.error.message).toContain(field);
      }
    },
  );
  test.each([
    "https://example.com/v1",
    "http://localhost:8000/v1",
    "http://127.0.0.1:8000/v1",
    "http://[::1]:8000/v1",
  ])("accepts explicit allowed URL %s", (baseUrl) => {
    expect(
      parseArielModelConfig({
        ...COMPATIBLE_ENV,
        OPENAI_COMPATIBLE_BASE_URL: baseUrl,
      }).status,
    ).toBe("configured");
  });
  test.each([
    "http://example.com/v1",
    "file:///tmp/api",
    "ftp://example.com",
    "not a URL",
    `https://${FAKE_KEY}@example.com/v1`,
    "https://@example.com/v1",
    "https://example.com/v1?",
    "https://example.com/v1#",
    "https://example.com/v1?q=1",
    "https://example.com/v1#fragment",
    " https://example.com/v1",
    "http://127.1/v1",
    "http://0x7f000001/v1",
    "http://localhost.example.com/v1",
    "http://localhost\\@example.com/v1",
    "https://example.com\\v1",
    "https://exa\nmple.com/v1",
    "https://example.com/v\t1",
  ])("rejects unsafe base URL without echoing it: %s", (baseUrl) => {
    const result = parseArielModelConfig({
      ...COMPATIBLE_ENV,
      OPENAI_COMPATIBLE_BASE_URL: baseUrl,
    });
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(result)).not.toContain(baseUrl);
  });
  test.each(["DEEPSEEK_API_KEY", "OPENAI_COMPATIBLE_API_KEY"])(
    "rejects header injection in %s safely",
    (field) => {
      const result = parseArielModelConfig({
        ...(field === "DEEPSEEK_API_KEY" ? {} : COMPATIBLE_ENV),
        [field]: `${FAKE_KEY}\r\nInjected: value`,
      });
      expect(result.status).toBe("failed");
      expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
      expect(JSON.stringify(result)).not.toContain("Injected");
    },
  );
});

describe.serial(
  "configured host and CLI composition with offline transport",
  () => {
    let fetchSpy: Mock<
      (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
    >;
    let directory: string;
    let filePath: string;

    beforeEach(async () => {
      fetchSpy = spyOn(globalThis, "fetch");
      fetchSpy.mockRejectedValue(
        new Error("Offline test requires a response fixture."),
      );
      directory = await mkdtemp(join(tmpdir(), "ariel-configured-model-"));
      filePath = join(directory, "example.ts");
      await writeFile(filePath, SOURCE);
    });
    afterEach(async () => {
      fetchSpy.mockRestore();
      await rm(directory, { recursive: true, force: true });
    });

    function fixture(content = JSON.stringify(PROPOSAL)) {
      fetchSpy.mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "fixture",
            object: "chat.completion",
            created: 0,
            model: "fixture-reported",
            system_fingerprint: "fixture",
            choices: [
              {
                index: 0,
                logprobs: null,
                finish_reason: "stop",
                message: { role: "assistant", content },
              },
            ],
          }),
        ),
      );
    }

    test.each([undefined, "deepseek"])(
      "CLI preserves DeepSeek default/explicit selection: %j",
      async (kind) => {
        fixture();
        const config = parseArielModelConfig({
          ARIEL_PROVIDER: kind,
          DEEPSEEK_API_KEY: FAKE_KEY,
        });
        const result = await runCli(
          ["edit", filePath, "Rename loadData"],
          config,
        );
        expect(result.exitCode).toBe(0);
        const [url, options] = fetchSpy.mock.calls[0] ?? [];
        expect(url).toBe("https://api.deepseek.com/chat/completions");
        expect(JSON.parse(String(options?.body))).toMatchObject({
          model: "deepseek-flash",
          stream: false,
          thinking: { type: "disabled" },
        });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(await readFile(filePath, "utf8")).toBe(SOURCE);
      },
    );

    test.each([undefined, FAKE_KEY])(
      "CLI compatible success with optional authentication %j",
      async (apiKey) => {
        fixture();
        const config = parseArielModelConfig({
          ...COMPATIBLE_ENV,
          OPENAI_COMPATIBLE_API_KEY: apiKey,
        });
        const result = await runCli(
          ["edit", filePath, "Rename loadData"],
          config,
        );
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain("- loadData\n+ fetchData");
        expect(result.stdout).toContain(
          "Proposal validated.\nNo files were modified.",
        );
        const [url, options] = fetchSpy.mock.calls[0] ?? [];
        expect(url).toBe("https://example.com/v1/chat/completions");
        expect(JSON.parse(String(options?.body))).toMatchObject({
          model: "fixture-model",
          stream: false,
        });
        expect(JSON.parse(String(options?.body))).not.toHaveProperty(
          "thinking",
        );
        expect(new Headers(options?.headers).get("Authorization")).toBe(
          apiKey === undefined ? null : `Bearer ${apiKey}`,
        );
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(await readFile(filePath, "utf8")).toBe(SOURCE);
      },
    );

    test("host reads exact original source/instruction through configured compatible composition", async () => {
      fixture();
      const instruction = " \tRename loadData\r\n ";
      expect(
        await runConfiguredCodeEditFromFile(
          relative(process.cwd(), filePath),
          instruction,
          COMPATIBLE,
        ),
      ).toEqual({ status: "completed", proposal: PROPOSAL });
      const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
      expect(JSON.parse(body.messages[1].content)).toEqual({
        instruction,
        sourceText: SOURCE,
      });
      expect(body.messages[0].content).toContain("oldText");
      expect(body.messages[0].content).toContain("newText");
      expect(await readFile(filePath, "utf8")).toBe(SOURCE);
    });

    test("compatible host explicitly passes the 120000ms product deadline", async () => {
      const timerSpy = spyOn(globalThis, "setTimeout");
      try {
        fixture();
        await runConfiguredCodeEditTask("Rename", SOURCE, COMPATIBLE);
        expect(timerSpy.mock.calls[0]?.[1]).toBe(120_000);
        expect(timerSpy).toHaveBeenCalledTimes(1);
      } finally {
        timerSpy.mockRestore();
      }
    });

    test("configured whitespace-only source remains valid; empty source does not call model", async () => {
      const sourceText = " \t\r\n ";
      fixture(JSON.stringify({ oldText: sourceText, newText: "declaration" }));
      await writeFile(filePath, sourceText);
      expect(
        (
          await runConfiguredCodeEditFromFile(
            filePath,
            "Add declaration",
            COMPATIBLE,
          )
        ).status,
      ).toBe("completed");
      expect(
        JSON.parse(
          JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).messages[1]
            .content,
        ).sourceText,
      ).toBe(sourceText);
      expect(await readFile(filePath, "utf8")).toBe(sourceText);
      fetchSpy.mockClear();
      await writeFile(filePath, "");
      const result = await runConfiguredCodeEditFromFile(
        filePath,
        "Add declaration",
        COMPATIBLE,
      );
      expect(result).toMatchObject({
        status: "failed",
        error: { kind: "invalid-task" },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test.each(["missing", "directory"])(
      "configured host safely rejects %s file input",
      async (kind) => {
        const path =
          kind === "directory" ? directory : join(directory, "absent.ts");
        expect(
          await runConfiguredCodeEditFromFile(path, "Rename", COMPATIBLE),
        ).toMatchObject({
          status: "failed",
          error: { kind: "file-read-failure" },
        });
        expect(fetchSpy).not.toHaveBeenCalled();
      },
    );

    test.each([401, 429, 500])(
      "compatible HTTP %i host/CLI failure is safe without retry",
      async (status) => {
        fetchSpy.mockResolvedValue(
          new Response(`private source and ${FAKE_KEY}`, { status }),
        );
        const hostResult = await runConfiguredCodeEditTask(
          "private instruction",
          SOURCE,
          COMPATIBLE,
        );
        expect(hostResult).toEqual({
          status: "failed",
          error: {
            kind: "model-failure",
            message: `OpenAI-compatible code-edit request failed (HTTP ${status}).`,
          },
        });
        fetchSpy.mockClear();
        const result = await runCli(["edit", filePath, "private instruction"], {
          status: "configured",
          provider: { ...COMPATIBLE, apiKey: FAKE_KEY },
        });
        expect(result).toEqual({
          exitCode: 1,
          stdout: "",
          stderr:
            "错误：OpenAI-compatible 模型请求失败，请检查配置或稍后重试。\n",
        });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
        expect(JSON.stringify(result)).not.toContain(SOURCE);
      },
    );

    test("compatible preview redacts credential occurrences", async () => {
      fixture(
        JSON.stringify({ oldText: "loadData", newText: `${FAKE_KEY}Value` }),
      );
      const result = await runCli(["edit", filePath, "Rename"], {
        status: "configured",
        provider: { ...COMPATIBLE, apiKey: FAKE_KEY },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain(FAKE_KEY);
      expect(result.stdout).toContain("Credential occurrences are hidden");
    });

    test("compatible invalid proposal fails validation without retry", async () => {
      fixture(JSON.stringify({ oldText: "not in source", newText: "changed" }));
      const result = await runCli(["edit", filePath, "Rename"], {
        status: "configured",
        provider: COMPATIBLE,
      });
      expect(result).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: "错误：模型返回的修改建议未通过 Ariel validation。\n",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test("unknown programming rejection propagates through configured host and CLI", async () => {
      const unexpected = new Error("fixture programming failure");
      fetchSpy.mockRejectedValue(unexpected);
      await expect(
        runConfiguredCodeEditTask("Rename", SOURCE, COMPATIBLE),
      ).rejects.toBe(unexpected);
      await expect(
        runCli(["edit", filePath, "Rename"], {
          status: "configured",
          provider: COMPATIBLE,
        }),
      ).rejects.toBe(unexpected);
    });

    test.each([
      { ARIEL_PROVIDER: "unknown" },
      { ARIEL_PROVIDER: "openai-compatible" },
      {
        ARIEL_PROVIDER: "openai-compatible",
        OPENAI_COMPATIBLE_BASE_URL: "https://example.com/v1",
      },
    ])(
      "invalid configured CLI input fails without file/model access: %j",
      async (env) => {
        const result = await runCli(
          ["edit", join(directory, "absent.ts"), "Rename"],
          parseArielModelConfig(env),
        );
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(
          env.ARIEL_PROVIDER === "unknown"
            ? "Unsupported ARIEL_PROVIDER"
            : "OPENAI_COMPATIBLE_",
        );
        expect(fetchSpy).not.toHaveBeenCalled();
      },
    );

    test("in-memory demo ignores failed provider configuration", async () => {
      expect(
        await runCli(
          ["model-demo", "hello"],
          parseArielModelConfig({ ARIEL_PROVIDER: "unknown" }),
        ),
      ).toEqual({
        exitCode: 0,
        stdout: "in-memory 模拟演示（未调用真实模型）。\nEcho: hello\n",
        stderr: "",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  },
);

describe("configured executable environment boundary", () => {
  test("root launcher and CLI bin select compatible provider without a key, using only test-local preload", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "ariel-configured-executable-"),
    );
    try {
      const filePath = join(directory, "example.ts");
      const preloadPath = join(directory, "offline-fetch.js");
      await writeFile(filePath, SOURCE);
      await writeFile(
        preloadPath,
        `globalThis.fetch = async (url, options) => {
        if (url !== "https://example.com/v1/chat/completions") throw new Error("Wrong fixture endpoint");
        const body = JSON.parse(options.body);
        if (body.model !== "fixture-model" || body.stream !== false || new Headers(options.headers).has("Authorization")) throw new Error("Wrong fixture configuration");
        return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(${JSON.stringify(PROPOSAL)})}}]}));
      };`,
      );
      for (const entrypoint of ["ariel.ts", "apps/cli/src/bin.ts"]) {
        const result = Bun.spawnSync(
          [
            process.execPath,
            "--preload",
            preloadPath,
            resolve(import.meta.dir, "..", entrypoint),
            "edit",
            filePath,
            "Rename",
          ],
          {
            cwd: directory,
            env: COMPATIBLE_ENV,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        expect(result.exitCode).toBe(0);
        expect(result.stderr.toString()).toBe("");
        expect(result.stdout.toString()).toContain(
          "Proposal validated.\nNo files were modified.",
        );
        expect(await readFile(filePath, "utf8")).toBe(SOURCE);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
