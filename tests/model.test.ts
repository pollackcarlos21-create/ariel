import { describe, expect, test } from "bun:test";
import {
  type ModelError,
  type ModelPort,
  type ModelRequest,
  type ModelResult,
  requestModelText,
} from "@ariel/core";

describe("core model interaction through the public API", () => {
  test("calls the port once with the original request and returns its result unchanged", async () => {
    const request: ModelRequest = {
      userText: "  hello  ",
      systemText: "  system context\n",
    };
    const result: ModelResult = { status: "completed", text: "model text" };
    const received: ModelRequest[] = [];
    const port: ModelPort = {
      async generateText(input) {
        received.push(input);
        return result;
      },
    };

    expect(await requestModelText(request, port)).toBe(result);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(request);
    expect(received[0]).toEqual({
      userText: "  hello  ",
      systemText: "  system context\n",
    });
  });

  test.each(["", "   ", "\n\t"])(
    "rejects empty or whitespace-only userText %j without calling the port",
    async (userText) => {
      let calls = 0;
      const port: ModelPort = {
        async generateText() {
          calls += 1;
          return { status: "completed", text: "unused" };
        },
      };

      expect(await requestModelText({ userText }, port)).toEqual({
        status: "failed",
        error: {
          kind: "invalid-request",
          message: "userText must not be empty.",
        },
      });
      expect(calls).toBe(0);
    },
  );

  test("preserves a completed result with empty text", async () => {
    const result: ModelResult = { status: "completed", text: "" };
    const port: ModelPort = {
      async generateText() {
        return result;
      },
    };

    expect(await requestModelText({ userText: "hello" }, port)).toBe(result);
  });

  test("preserves a structured provider failure without converting it to success", async () => {
    const error: ModelError = {
      kind: "provider-failure",
      message: "Expected provider failure.",
    };
    const result: ModelResult = { status: "failed", error };
    const port: ModelPort = {
      async generateText() {
        return result;
      },
    };

    expect(await requestModelText({ userText: "hello" }, port)).toBe(result);
  });

  test("uses whichever port is explicitly supplied", async () => {
    const request: ModelRequest = { userText: "hello" };
    const first: ModelPort = {
      async generateText() {
        return { status: "completed", text: "first" };
      },
    };
    const second: ModelPort = {
      async generateText() {
        return { status: "completed", text: "second" };
      },
    };

    expect(await requestModelText(request, first)).toEqual({
      status: "completed",
      text: "first",
    });
    expect(await requestModelText(request, second)).toEqual({
      status: "completed",
      text: "second",
    });
  });

  test("propagates an unexpected synchronous port throw", async () => {
    const error = new Error("Unexpected port failure.");
    const port: ModelPort = {
      generateText() {
        throw error;
      },
    };

    await expect(requestModelText({ userText: "hello" }, port)).rejects.toBe(
      error,
    );
  });

  test("propagates an unexpected rejected port promise", async () => {
    const error = new Error("Unexpected port rejection.");
    const port: ModelPort = {
      generateText() {
        return Promise.reject(error);
      },
    };

    await expect(requestModelText({ userText: "hello" }, port)).rejects.toBe(
      error,
    );
  });
});
