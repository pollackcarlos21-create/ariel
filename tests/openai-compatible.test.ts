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
import {
  createOpenAICompatibleModelPort,
  type OpenAICompatibleModelPortConfig,
} from "@ariel/providers";

const FAKE_KEY = "fixture-only-compatible-credential";
const PRIVATE_MARKER = "fixture-private-source-and-upstream-body";
const config: OpenAICompatibleModelPortConfig = {
  baseUrl: "https://example.com/v1",
  apiKey: FAKE_KEY,
  model: "fixture-model",
  timeoutMs: 1000,
};
const INVALID_BASE_URL =
  "baseUrl must be HTTPS or loopback HTTP without credentials, query or fragment.";

function completion(
  content: unknown = "fixture final",
  messageFields: Record<string, unknown> = {},
  choiceFields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    choices: [
      {
        message: { content, ...messageFields },
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
  expect(serialized).not.toContain(FAKE_KEY);
  expect(serialized).not.toContain(PRIVATE_MARKER);
  expect(serialized).not.toContain("Authorization");
}

function signalFrom(options: RequestInit | undefined): AbortSignal {
  if (!options?.signal) throw new Error("Fixture expected an AbortSignal.");
  return options.signal;
}

// Shared global transport is replaced serially and restored after every case.
describe.serial("OpenAI-compatible public adapter without network", () => {
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

  test.each([
    {
      baseUrl: "https://example.com/v1",
      endpoint: "https://example.com/v1/chat/completions",
    },
    {
      baseUrl: "https://example.com/v1/",
      endpoint: "https://example.com/v1/chat/completions",
    },
    {
      baseUrl: "https://example.com/provider/api///",
      endpoint: "https://example.com/provider/api/chat/completions",
    },
    {
      baseUrl: "https://example.com",
      endpoint: "https://example.com/chat/completions",
    },
    {
      baseUrl: "http://localhost:8000/v1",
      endpoint: "http://localhost:8000/v1/chat/completions",
    },
    {
      baseUrl: "http://127.0.0.1:8000/v1",
      endpoint: "http://127.0.0.1:8000/v1/chat/completions",
    },
    {
      baseUrl: "http://[::1]:8000/v1",
      endpoint: "http://[::1]:8000/v1/chat/completions",
    },
    {
      baseUrl: "https://example.com/custom%3Fprefix%23segment",
      endpoint:
        "https://example.com/custom%3Fprefix%23segment/chat/completions",
    },
  ])(
    "joins $baseUrl without guessing an API prefix",
    async ({ baseUrl, endpoint }) => {
      fetchSpy.mockResolvedValue(Response.json(completion()));
      expect(
        await createOpenAICompatibleModelPort({
          ...config,
          baseUrl,
        }).generateText({
          userText: "fixture prompt",
        }),
      ).toEqual({ status: "completed", text: "fixture final" });
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(endpoint);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    "http://example.com/v1",
    "http://localhost.example.com/v1",
    "http://127.0.0.2/v1",
    "http://127.1/v1",
    "http://0x7f000001/v1",
    "http://localhost./v1",
    "file:///tmp/api",
    "ftp://example.com",
    "data:application/json,{}",
    "javascript:alert(1)",
    "not a URL",
    "https://",
    "https:example.com/v1",
    " https://example.com/v1",
    "https://example.com/v1 ",
    "https://exa\nmple.com/v1",
    "https://example.com/\tapi",
    "https://example.com/\r\napi",
    "https://example.com\\v1",
    "http://localhost\\@example.com/v1",
    `https://${FAKE_KEY}:password@example.com/v1`,
    `https://${FAKE_KEY}@example.com/v1`,
    "https://@example.com/v1",
    "https://example.com/v1?token=private",
    "https://example.com/v1?",
    "https://example.com/v1#private",
    "https://example.com/v1#",
  ])("rejects unsafe or malformed baseUrl %j before HTTP", (baseUrl) => {
    expect(() =>
      createOpenAICompatibleModelPort({ ...config, baseUrl }),
    ).toThrow(new TypeError(INVALID_BASE_URL));
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test("rejects runtime non-string baseUrl without echoing configuration", () => {
    expect(() =>
      Reflect.apply(createOpenAICompatibleModelPort, undefined, [
        { ...config, baseUrl: { secret: FAKE_KEY } },
      ]),
    ).toThrow(new TypeError(INVALID_BASE_URL));
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test.each([1, 1000, 2_147_483_647])(
    "accepts timeoutMs %j at construction without HTTP or a long timer",
    (timeoutMs) => {
      expect(
        typeof createOpenAICompatibleModelPort({ ...config, timeoutMs })
          .generateText,
      ).toBe("function");
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
  )("rejects invalid timeoutMs $label without clamping", ({ timeoutMs }) => {
    expect(() =>
      createOpenAICompatibleModelPort({ ...config, timeoutMs }),
    ).toThrow(
      new TypeError("timeoutMs must be an integer between 1 and 2147483647."),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test.each(["", " \t\n "])("rejects blank model %j", (model) => {
    expect(() => createOpenAICompatibleModelPort({ ...config, model })).toThrow(
      new TypeError("model must be a non-empty string."),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test("rejects runtime non-string model synchronously", () => {
    expect(() =>
      Reflect.apply(createOpenAICompatibleModelPort, undefined, [
        { ...config, model: 42 },
      ]),
    ).toThrow(new TypeError("model must be a non-empty string."));
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  test.each([`${FAKE_KEY}\rheader`, `${FAKE_KEY}\nheader`])(
    "rejects credential header injection before HTTP",
    (apiKey) => {
      expect(() =>
        createOpenAICompatibleModelPort({ ...config, apiKey }),
      ).toThrow(new TypeError("apiKey must be a string without CR or LF."));
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    },
  );

  test("rejects runtime non-string apiKey safely", () => {
    expect(() =>
      Reflect.apply(createOpenAICompatibleModelPort, undefined, [
        { ...config, apiKey: { secret: FAKE_KEY } },
      ]),
    ).toThrow(new TypeError("apiKey must be a string without CR or LF."));
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
    "sends exact model/messages/stream with $label",
    async ({ request, messages }) => {
      fetchSpy.mockResolvedValue(Response.json(completion()));
      const model = "  vendor/model-without-gpt-prefix  ";
      const apiKey = `  ${FAKE_KEY}  `;
      await createOpenAICompatibleModelPort({
        ...config,
        model,
        apiKey,
      }).generateText(request);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [_url, options] = fetchSpy.mock.calls[0] ?? [];
      expect(options?.method).toBe("POST");
      expect(options?.redirect).toBe("error");
      expect(options?.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      });
      if (typeof options?.body !== "string")
        throw new Error("Expected JSON body.");
      const body: unknown = JSON.parse(options.body);
      expect(body).toEqual({ model, messages, stream: false });
      expect(signalFrom(options).aborted).toBe(false);
    },
  );

  test.each([
    { label: "absent", apiKey: undefined },
    { label: "empty", apiKey: "" },
    { label: "whitespace", apiKey: " \t " },
  ])("omits Authorization when key is $label", async ({ apiKey }) => {
    fetchSpy.mockResolvedValue(Response.json(completion()));
    const { apiKey: _discarded, ...withoutKey } = config;
    await createOpenAICompatibleModelPort({
      ...withoutKey,
      ...(apiKey === undefined ? {} : { apiKey }),
    }).generateText({ userText: "fixture prompt" });
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test.each(["fixture final", "", "  \n\t "])(
    "preserves final content %j without trimming",
    async (content) => {
      fetchSpy.mockResolvedValue(Response.json(completion(content)));
      expect(
        await createOpenAICompatibleModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).toEqual({
        status: "completed",
        text: content,
      });
    },
  );

  test("accepts explicit assistant/stop and ignores unrelated identity/usage/reasoning", async () => {
    fetchSpy.mockResolvedValue(
      Response.json({
        ...completion(
          "visible answer",
          { role: "assistant", reasoning_content: PRIVATE_MARKER },
          { finish_reason: "stop" },
        ),
        model: "different-provider-reported-model",
        usage: { total_tokens: 3 },
      }),
    );
    expect(
      await createOpenAICompatibleModelPort(config).generateText({
        userText: "fixture prompt",
      }),
    ).toEqual({ status: "completed", text: "visible answer" });
  });

  test("uses the first choice without requiring exactly one choice", async () => {
    fetchSpy.mockResolvedValue(
      Response.json({
        choices: [
          { message: { content: "first final" } },
          { message: { content: "second final" } },
        ],
      }),
    );
    expect(
      await createOpenAICompatibleModelPort(config).generateText({
        userText: "fixture prompt",
      }),
    ).toEqual({ status: "completed", text: "first final" });
  });

  test.each([
    { label: "null", value: null },
    { label: "array", value: [] },
    { label: "scalar", value: "fixture" },
    { label: "missing choices", value: {} },
    { label: "non-array choices", value: { choices: {} } },
    { label: "empty choices", value: { choices: [] } },
    { label: "null choice", value: { choices: [null] } },
    { label: "array choice", value: { choices: [[]] } },
    { label: "missing message", value: { choices: [{}] } },
    { label: "null message", value: { choices: [{ message: null }] } },
    { label: "array message", value: { choices: [{ message: [] }] } },
    { label: "missing content", value: { choices: [{ message: {} }] } },
    { label: "null content", value: completion(null) },
    { label: "number content", value: completion(1) },
    {
      label: "object content",
      value: completion({ text: "cannot stringify" }),
    },
    { label: "array content", value: completion(["cannot stringify"]) },
    { label: "boolean content", value: completion(false) },
    {
      label: "non-assistant role",
      value: completion("partial", { role: "user" }),
    },
    { label: "null role", value: completion("partial", { role: null }) },
  ])("rejects unsupported response: $label", async ({ value }) => {
    fetchSpy.mockResolvedValue(Response.json(value));
    expect(
      await createOpenAICompatibleModelPort(config).generateText({
        userText: PRIVATE_MARKER,
      }),
    ).toEqual(failure("OpenAI-compatible returned an unsupported response."));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test.each([
    { tool_calls: [] },
    { tool_calls: null },
    { tool_calls: [{ id: "fixture", type: "function" }] },
    { function_call: null },
    { function_call: { name: "fixture" } },
  ])(
    "rejects any tool/function field even with string content",
    async (messageFields) => {
      fetchSpy.mockResolvedValue(
        Response.json(completion("partial", messageFields)),
      );
      expect(
        await createOpenAICompatibleModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).toEqual(failure("OpenAI-compatible returned an unsupported response."));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    "length",
    "content_filter",
    "tool_calls",
    "function_call",
    "fixture-unknown",
    null,
  ])("rejects explicit unsupported finish_reason %j", async (finish_reason) => {
    fetchSpy.mockResolvedValue(
      Response.json(completion("partial", {}, { finish_reason })),
    );
    expect(
      await createOpenAICompatibleModelPort(config).generateText({
        userText: "fixture prompt",
      }),
    ).toEqual(failure("OpenAI-compatible returned an unsupported response."));
  });

  test.each([400, 401, 403, 429, 500, 503])(
    "maps HTTP %j without body/credential leakage or retry",
    async (status) => {
      fetchSpy.mockResolvedValue(
        new Response(`${FAKE_KEY} ${PRIVATE_MARKER}`, { status }),
      );
      const result = await createOpenAICompatibleModelPort(config).generateText(
        { userText: PRIVATE_MARKER },
      );
      expect(result).toEqual(
        failure(`OpenAI-compatible request failed with HTTP ${status}.`),
      );
      expectSafe(result);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    new TypeError(PRIVATE_MARKER),
    new DOMException(PRIVATE_MARKER, "AbortError"),
  ])("maps recognized network failure safely", async (error) => {
    fetchSpy.mockRejectedValue(error);
    const result = await createOpenAICompatibleModelPort(config).generateText({
      userText: PRIVATE_MARKER,
    });
    expect(result).toEqual(
      failure("OpenAI-compatible network request failed."),
    );
    expectSafe(result);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("requires redirect:error and safely maps redirect rejection without following it", async () => {
    fetchSpy.mockImplementation(async (_url, options) => {
      expect(options?.redirect).toBe("error");
      throw new TypeError("fixture redirect refused");
    });
    expect(
      await createOpenAICompatibleModelPort(config).generateText({
        userText: "fixture prompt",
      }),
    ).toEqual(failure("OpenAI-compatible network request failed."));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("maps malformed JSON safely", async () => {
    fetchSpy.mockResolvedValue(
      new Response(`not-json ${FAKE_KEY} ${PRIVATE_MARKER}`),
    );
    const result = await createOpenAICompatibleModelPort(config).generateText({
      userText: PRIVATE_MARKER,
    });
    expect(result).toEqual(failure("OpenAI-compatible returned invalid JSON."));
    expectSafe(result);
  });

  test.each(["throw", "reject"])(
    "preserves unknown fetch %s identity without retry",
    async (mode) => {
      const error = new Error("fixture programming error");
      fetchSpy.mockImplementation(() => {
        if (mode === "throw") throw error;
        return Promise.reject(error);
      });
      await expect(
        createOpenAICompatibleModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).rejects.toBe(error);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  test("maps known body read failure safely", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError(PRIVATE_MARKER));
          },
        }),
      ),
    );
    const result = await createOpenAICompatibleModelPort(config).generateText({
      userText: PRIVATE_MARKER,
    });
    expect(result).toEqual(
      failure("OpenAI-compatible response body could not be read."),
    );
    expectSafe(result);
  });

  test("preserves unknown body error identity", async () => {
    const error = new Error("fixture programming error");
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
      createOpenAICompatibleModelPort(config).generateText({
        userText: "fixture prompt",
      }),
    ).rejects.toBe(error);
  });

  test("only normalizes SyntaxError in the JSON decoder", async () => {
    const error = new TypeError("fixture unexpected parser error");
    fetchSpy.mockResolvedValue(new Response("{}"));
    const parseSpy = spyOn(JSON, "parse").mockImplementation(() => {
      throw error;
    });
    try {
      await expect(
        createOpenAICompatibleModelPort(config).generateText({
          userText: "fixture prompt",
        }),
      ).rejects.toBe(error);
    } finally {
      parseSpy.mockRestore();
    }
  });

  test("aborts pending fetch before headers without retry", async () => {
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
      await createOpenAICompatibleModelPort({
        ...config,
        timeoutMs: 20,
      }).generateText({ userText: "fixture prompt" }),
    ).toEqual(failure("OpenAI-compatible request timed out."));
    expect(signal?.aborted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("keeps deadline active until all response body bytes are consumed", async () => {
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
      await createOpenAICompatibleModelPort({
        ...config,
        timeoutMs: 20,
      }).generateText({ userText: "fixture prompt" }),
    ).toEqual(failure("OpenAI-compatible request timed out."));
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
  ])("clears operation timer after %s", async (path) => {
    let signal: AbortSignal | undefined;
    const error = new Error("fixture programming error");
    fetchSpy.mockImplementation(async (_url, options) => {
      signal = signalFrom(options);
      if (path === "network") throw new TypeError("fixture network failure");
      if (path === "unexpected") throw error;
      if (path === "HTTP") return new Response("private", { status: 401 });
      if (path === "JSON") return new Response("not-json");
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
    const result = createOpenAICompatibleModelPort({
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

  test("creates independent abort controllers per generateText operation", async () => {
    fetchSpy.mockImplementation(async () => Response.json(completion()));
    const port = createOpenAICompatibleModelPort(config);
    await Promise.all([
      port.generateText({ userText: "first" }),
      port.generateText({ userText: "second" }),
    ]);
    expect(signalFrom(fetchSpy.mock.calls[0]?.[1])).not.toBe(
      signalFrom(fetchSpy.mock.calls[1]?.[1]),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("does not swallow a programming error while building the request", async () => {
    const error = new Error("fixture request getter error");
    const request: ModelRequest = {
      get userText(): string {
        throw error;
      },
    };
    await expect(
      createOpenAICompatibleModelPort(config).generateText(request),
    ).rejects.toBe(error);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
});
