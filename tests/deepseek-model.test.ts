import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import type { ModelRequest, ModelResult } from "@ariel/core";
import { runDeepSeekModelRequest } from "@ariel/local-host";
import {
  createDeepSeekModelPort,
  type DeepSeekModelPortConfig,
} from "@ariel/providers";

const FAKE_KEY = "fixture-only-not-a-real-api-key";
const SECRET_MARKER = "fixture-private-upstream-body";
const config: DeepSeekModelPortConfig = {
  apiKey: FAKE_KEY,
  model: "deepseek-flash",
  timeoutMs: 1000,
};

function completion(
  message: Record<string, unknown> = {
    role: "assistant",
    content: "fixture final",
  },
  choiceFields: Record<string, unknown> = {},
): Record<string, unknown> {
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
        message,
        ...choiceFields,
      },
    ],
  };
}

function failure(message: string): ModelResult {
  return { status: "failed", error: { kind: "provider-failure", message } };
}

function expectSafe(result: ModelResult): void {
  const serialized = JSON.stringify(result);
  expect(serialized.includes(FAKE_KEY)).toBe(false);
  expect(serialized.includes(SECRET_MARKER)).toBe(false);
}

function signalFrom(options: RequestInit | undefined): AbortSignal {
  if (!options?.signal) throw new Error("Fixture expected an AbortSignal.");
  return options.signal;
}

// These tests replace a shared global. Always run serially and restore it per test.
describe.serial(
  "DeepSeek public adapter and composition without network",
  () => {
    let fetchSpy: Mock<
      (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
    >;

    beforeEach(() => {
      fetchSpy = spyOn(globalThis, "fetch");
      fetchSpy.mockRejectedValue(
        new Error("Offline test requires an explicit fetch fixture."),
      );
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    test.each([1, 1000, 2_147_483_647])(
      "accepts timeoutMs %j at construction without starting HTTP",
      (timeoutMs) => {
        const port = createDeepSeekModelPort({ ...config, timeoutMs });
        expect(typeof port.generateText).toBe("function");
        expect(fetchSpy).toHaveBeenCalledTimes(0);
      },
    );

    test.each(
      [
        0,
        -1,
        NaN,
        Infinity,
        -Infinity,
        1.5,
        2_147_483_648,
        Number.MAX_SAFE_INTEGER,
      ].map((timeoutMs) => ({ label: String(timeoutMs), timeoutMs })),
    )(
      "rejects invalid timeoutMs $label synchronously before HTTP",
      ({ timeoutMs }) => {
        expect(() => createDeepSeekModelPort({ ...config, timeoutMs })).toThrow(
          new TypeError(
            "timeoutMs must be an integer between 1 and 2147483647.",
          ),
        );
        expect(fetchSpy).toHaveBeenCalledTimes(0);
      },
    );

    test.each(["", " \t\n "])(
      "rejects empty credential %j before HTTP",
      (apiKey) => {
        expect(() => createDeepSeekModelPort({ ...config, apiKey })).toThrow(
          new TypeError("apiKey must be a non-empty credential."),
        );
        expect(fetchSpy).toHaveBeenCalledTimes(0);
      },
    );

    test("rejects a runtime-invalid model safely before HTTP", () => {
      const invalid = {
        ...config,
        model: "fixture-unsupported-model",
      } as unknown as DeepSeekModelPortConfig;
      expect(() => createDeepSeekModelPort(invalid)).toThrow(
        new TypeError("model must be deepseek-flash."),
      );
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });

    test.each([
      {
        label: "absent system",
        request: { userText: "  user\n\t" },
        messages: [{ role: "user", content: "  user\n\t" }],
      },
      {
        label: "nonempty system",
        request: { userText: "  user\n\t", systemText: "\t system \n" },
        messages: [
          { role: "system", content: "\t system \n" },
          { role: "user", content: "  user\n\t" },
        ],
      },
      {
        label: "empty system",
        request: { userText: "  user\n\t", systemText: "" },
        messages: [
          { role: "system", content: "" },
          { role: "user", content: "  user\n\t" },
        ],
      },
    ])(
      "sends the exact approved request with $label",
      async ({ request, messages }) => {
        fetchSpy.mockResolvedValue(Response.json(completion()));
        // Inspect the raw fetch argument so credential validation cannot silently trim it.
        const apiKey = `  ${FAKE_KEY}  `;
        expect(
          await createDeepSeekModelPort({ ...config, apiKey }).generateText(
            request,
          ),
        ).toEqual({ status: "completed", text: "fixture final" });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, options] = fetchSpy.mock.calls[0] ?? [];
        expect(url).toBe("https://api.deepseek.com/chat/completions");
        expect(options?.method).toBe("POST");
        expect(options?.redirect).toBe("error");
        const headers = options?.headers;
        expect(
          typeof headers === "object" &&
            headers !== null &&
            "Authorization" in headers &&
            headers.Authorization === `Bearer ${apiKey}`,
        ).toBe(true);
        expect(new Headers(headers).get("Content-Type")).toBe(
          "application/json",
        );
        expect(typeof options?.body).toBe("string");
        if (typeof options?.body !== "string")
          throw new Error("Expected JSON body.");
        const body: unknown = JSON.parse(options.body);
        expect(body).toEqual({
          model: "deepseek-flash",
          messages,
          thinking: { type: "disabled" },
          stream: false,
        });
        expect(signalFrom(options).aborted).toBe(false);
      },
    );

    test.each(["fixture final", "", "   ", "I cannot help with that request."])(
      "preserves valid final text %j",
      async (content) => {
        fetchSpy.mockResolvedValue(
          Response.json(completion({ role: "assistant", content })),
        );
        expect(
          await createDeepSeekModelPort(config).generateText({
            userText: "fixture prompt",
          }),
        ).toEqual({ status: "completed", text: content });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      },
    );

    test("ignores reasoning, usage and reported identity while preserving final text", async () => {
      fetchSpy.mockResolvedValue(
        Response.json({
          ...completion({
            role: "assistant",
            content: "visible final",
            reasoning_content: "private fixture reasoning",
          }),
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }),
      );
      expect(
        await createDeepSeekModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).toEqual({ status: "completed", text: "visible final" });
    });

    test("accepts a valid completion without usage", async () => {
      fetchSpy.mockResolvedValue(Response.json(completion()));
      expect(
        await createDeepSeekModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).toEqual({ status: "completed", text: "fixture final" });
    });

    test("accepts an empty tool_calls array", async () => {
      fetchSpy.mockResolvedValue(
        Response.json(
          completion({ role: "assistant", content: "final", tool_calls: [] }),
        ),
      );
      expect(
        await createDeepSeekModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).toEqual({ status: "completed", text: "final" });
    });

    test.each([
      "length",
      "content_filter",
      "tool_calls",
      "insufficient_system_resource",
      "aborted",
      "fixture-unknown",
      null,
    ])(
      "rejects unsupported finish_reason %j even with partial text",
      async (finish_reason) => {
        fetchSpy.mockResolvedValue(
          Response.json(completion(undefined, { finish_reason })),
        );
        expect(
          await createDeepSeekModelPort(config).generateText({
            userText: "fixture prompt",
          }),
        ).toEqual(failure("DeepSeek returned an unsupported response."));
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      },
    );

    test.each([
      { label: "null content", message: { role: "assistant", content: null } },
      {
        label: "missing content with reasoning",
        message: { role: "assistant", reasoning_content: "not a final answer" },
      },
      { label: "numeric content", message: { role: "assistant", content: 42 } },
      { label: "missing role", message: { content: "text" } },
      { label: "wrong role", message: { role: "user", content: "text" } },
      {
        label: "actual tool output",
        message: {
          role: "assistant",
          content: "text",
          tool_calls: [
            {
              id: "fixture-tool",
              type: "function",
              function: { name: "fixture", arguments: "{}" },
            },
          ],
        },
      },
      {
        label: "null tool_calls",
        message: { role: "assistant", content: "text", tool_calls: null },
      },
      {
        label: "object tool_calls",
        message: { role: "assistant", content: "text", tool_calls: {} },
      },
    ])("rejects $label", async ({ message }) => {
      fetchSpy.mockResolvedValue(Response.json(completion(message)));
      expect(
        await createDeepSeekModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).toEqual(failure("DeepSeek returned an unsupported response."));
    });

    test.each([
      "id",
      "object",
      "created",
      "model",
      "system_fingerprint",
      "choices",
    ])("rejects a missing required envelope field %s", async (field) => {
      const value = completion();
      delete value[field];
      fetchSpy.mockResolvedValue(Response.json(value));
      expect(
        await createDeepSeekModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).toEqual(failure("DeepSeek returned an unsupported response."));
    });

    test.each([
      { id: 1 },
      { object: "chat.completion.chunk" },
      { created: "0" },
      { created: 1.5 },
      { model: null },
      { system_fingerprint: null },
      { choices: [] },
      { choices: [null] },
      { choices: [{}, {}] },
      { choices: "invalid" },
    ])("rejects an invalid envelope %j", async (fields) => {
      fetchSpy.mockResolvedValue(Response.json({ ...completion(), ...fields }));
      expect(
        await createDeepSeekModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).toEqual(failure("DeepSeek returned an unsupported response."));
    });

    test.each([
      { value: null },
      { value: [] },
      { value: "fixture" },
      { value: 42 },
    ])("rejects a non-object envelope %j", async ({ value }) => {
      fetchSpy.mockResolvedValue(Response.json(value));
      expect(
        await createDeepSeekModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).toEqual(failure("DeepSeek returned an unsupported response."));
    });

    test.each([
      { index: undefined },
      { index: "0" },
      { index: 1.5 },
      { message: undefined },
      { message: null },
      { finish_reason: undefined },
      { logprobs: undefined },
      { logprobs: "invalid" },
    ])("rejects invalid required choice fields %j", async (fields) => {
      fetchSpy.mockResolvedValue(Response.json(completion(undefined, fields)));
      expect(
        await createDeepSeekModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).toEqual(failure("DeepSeek returned an unsupported response."));
    });

    test("maps malformed JSON to a safe failure", async () => {
      fetchSpy.mockResolvedValue(
        new Response(`not-json ${SECRET_MARKER} ${FAKE_KEY}`),
      );
      const result = await createDeepSeekModelPort(config).generateText({
        userText: "fixture prompt",
      });
      expect(result).toEqual(failure("DeepSeek returned invalid JSON."));
      expectSafe(result);
    });

    test.each([400, 401, 402, 403, 422, 429, 500, 503])(
      "maps HTTP %j without retry or upstream secrets",
      async (status) => {
        fetchSpy.mockResolvedValue(
          new Response(`${SECRET_MARKER} ${FAKE_KEY}`, { status }),
        );
        const result = await createDeepSeekModelPort(config).generateText({
          userText: "fixture prompt",
        });
        expect(result).toEqual(
          failure(`DeepSeek request failed with HTTP ${status}.`),
        );
        expectSafe(result);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      },
    );

    test.each([
      new TypeError(SECRET_MARKER),
      new DOMException(SECRET_MARKER, "AbortError"),
    ])("maps a recognized transport failure safely", async (error) => {
      fetchSpy.mockRejectedValue(error);
      const result = await createDeepSeekModelPort(config).generateText({
        userText: "fixture prompt",
      });
      expect(result).toEqual(failure("DeepSeek network request failed."));
      expectSafe(result);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test.each(["throw", "reject"])(
      "propagates an unexpected fetch %s unchanged",
      async (mode) => {
        const error = new Error("unexpected programming failure");
        fetchSpy.mockImplementation(() => {
          if (mode === "throw") throw error;
          return Promise.reject(error);
        });
        await expect(
          createDeepSeekModelPort(config).generateText({
            userText: "fixture prompt",
          }),
        ).rejects.toBe(error);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      },
    );

    test("maps a recognized body transport failure", async () => {
      fetchSpy.mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError(SECRET_MARKER));
            },
          }),
        ),
      );
      const result = await createDeepSeekModelPort(config).generateText({
        userText: "fixture prompt",
      });
      expect(result).toEqual(
        failure("DeepSeek response body could not be read."),
      );
      expectSafe(result);
    });

    test("propagates an unexpected body error unchanged", async () => {
      const error = new Error("unexpected programming failure");
      fetchSpy.mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(error);
            },
          }),
        ),
      );
      await expect(
        createDeepSeekModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).rejects.toBe(error);
    });

    test("aborts pending fetch before headers with one attempt", async () => {
      let signal: AbortSignal | undefined;
      fetchSpy.mockImplementation((_url, options) => {
        signal = signalFrom(options);
        return new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal?.reason), {
            once: true,
          }),
        );
      });
      expect(
        await createDeepSeekModelPort({
          ...config,
          timeoutMs: 20,
        }).generateText({ userText: "fixture prompt" }),
      ).toEqual(failure("DeepSeek request timed out."));
      expect(signal?.aborted).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test("keeps the deadline active during body consumption after keep-alive bytes", async () => {
      let signal: AbortSignal | undefined;
      let bodyAborted = false;
      fetchSpy.mockImplementation(async (_url, options) => {
        signal = signalFrom(options);
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("\n\n"));
              signal?.addEventListener(
                "abort",
                () => {
                  bodyAborted = true;
                  controller.error(signal?.reason);
                },
                { once: true },
              );
            },
          }),
        );
      });
      expect(
        await createDeepSeekModelPort({
          ...config,
          timeoutMs: 20,
        }).generateText({ userText: "fixture prompt" }),
      ).toEqual(failure("DeepSeek request timed out."));
      expect(signal?.aborted).toBe(true);
      expect(bodyAborted).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test.each([
      "success",
      "HTTP",
      "JSON",
      "schema",
      "network",
      "body",
      "unexpected",
    ])("clears its timer after %s termination", async (path) => {
      let signal: AbortSignal | undefined;
      const error = new Error("unexpected programming failure");
      fetchSpy.mockImplementation(async (_url, options) => {
        signal = signalFrom(options);
        if (path === "network") throw new TypeError("fixture transport error");
        if (path === "unexpected") throw error;
        if (path === "HTTP")
          return new Response("fixture failure", { status: 401 });
        if (path === "JSON") return new Response("invalid json");
        if (path === "schema") return Response.json({});
        if (path === "body")
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError("fixture body failure"));
              },
            }),
          );
        return Response.json(completion());
      });
      const result = createDeepSeekModelPort({
        ...config,
        timeoutMs: 20,
      }).generateText({ userText: "fixture prompt" });
      if (path === "unexpected") await expect(result).rejects.toBe(error);
      else
        expect((await result).status).toBe(
          path === "success" ? "completed" : "failed",
        );
      await new Promise((resolve) => setTimeout(resolve, 35));
      expect(signal?.aborted).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test("creates independent controllers for separate operations", async () => {
      fetchSpy.mockImplementation(async () => Response.json(completion()));
      const port = createDeepSeekModelPort(config);
      await Promise.all([
        port.generateText({ userText: "first" }),
        port.generateText({ userText: "second" }),
      ]);
      const first = signalFrom(fetchSpy.mock.calls[0]?.[1]);
      const second = signalFrom(fetchSpy.mock.calls[1]?.[1]);
      expect(first).not.toBe(second);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    test("local-host composes the public adapter and core operation", async () => {
      fetchSpy.mockResolvedValue(Response.json(completion()));
      const request: ModelRequest = {
        userText: " fixture user ",
        systemText: " fixture system ",
      };
      expect(await runDeepSeekModelRequest(request, config)).toEqual({
        status: "completed",
        text: "fixture final",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    test("local-host leaves blank input validation to core without HTTP", async () => {
      expect(
        await runDeepSeekModelRequest({ userText: " \n\t " }, config),
      ).toEqual({
        status: "failed",
        error: {
          kind: "invalid-request",
          message: "userText must not be empty.",
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });

    test("local-host preserves an unexpected provider rejection", async () => {
      const error = new Error("unexpected programming failure");
      fetchSpy.mockRejectedValue(error);
      await expect(
        runDeepSeekModelRequest({ userText: "fixture prompt" }, config),
      ).rejects.toBe(error);
    });
  },
);
