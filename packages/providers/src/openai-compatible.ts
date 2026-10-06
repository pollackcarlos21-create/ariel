import type { ModelPort, ModelResult } from "@ariel/core";

// Single-timer host-runtime bound, not a default or product timeout policy.
const MAX_TIMEOUT_MS = 2_147_483_647;
const INVALID_BASE_URL =
  "baseUrl must be HTTPS or loopback HTTP without credentials, query or fragment.";

export interface OpenAICompatibleModelPortConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly timeoutMs: number;
}

function endpointFrom(baseUrl: string): string {
  if (
    typeof baseUrl !== "string" ||
    baseUrl !== baseUrl.trim() ||
    /\p{Cc}/u.test(baseUrl) ||
    baseUrl.includes("\\") ||
    baseUrl.includes("?") ||
    baseUrl.includes("#")
  ) {
    throw new TypeError(INVALID_BASE_URL);
  }
  const authority = /^https?:\/\/([^/\\?#]+)/i.exec(baseUrl)?.[1];
  if (!authority || authority.includes("@")) {
    throw new TypeError(INVALID_BASE_URL);
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    if (error instanceof TypeError) throw new TypeError(INVALID_BASE_URL);
    throw error;
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(authority)
      ))
  ) {
    throw new TypeError(INVALID_BASE_URL);
  }
  return `${url.href.replace(/\/+$/, "")}/chat/completions`;
}

function failure(message: string): ModelResult {
  return { status: "failed", error: { kind: "provider-failure", message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapResponse(value: unknown): ModelResult {
  const unsupported = "OpenAI-compatible returned an unsupported response.";
  if (
    !isRecord(value) ||
    !Array.isArray(value.choices) ||
    value.choices.length === 0
  ) {
    return failure(unsupported);
  }
  const choice: unknown = value.choices[0];
  if (
    !isRecord(choice) ||
    (Object.hasOwn(choice, "finish_reason") &&
      choice.finish_reason !== "stop") ||
    !isRecord(choice.message) ||
    (Object.hasOwn(choice.message, "role") &&
      choice.message.role !== "assistant") ||
    Object.hasOwn(choice.message, "tool_calls") ||
    Object.hasOwn(choice.message, "function_call") ||
    typeof choice.message.content !== "string"
  ) {
    return failure(unsupported);
  }
  return { status: "completed", text: choice.message.content };
}

function transportFailure(
  error: unknown,
  signal: AbortSignal,
  message: string,
): ModelResult {
  // Narrow transport catches only; unknown programming errors retain identity.
  if (signal.aborted && error === signal.reason) {
    return failure("OpenAI-compatible request timed out.");
  }
  if (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return failure(
      signal.aborted ? "OpenAI-compatible request timed out." : message,
    );
  }
  throw error;
}

export function createOpenAICompatibleModelPort(
  config: OpenAICompatibleModelPortConfig,
): ModelPort {
  const { baseUrl, apiKey, model, timeoutMs } = config;
  const endpoint = endpointFrom(baseUrl);
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new TypeError("model must be a non-empty string.");
  }
  if (
    apiKey !== undefined &&
    (typeof apiKey !== "string" || /[\r\n]/.test(apiKey))
  ) {
    throw new TypeError("apiKey must be a string without CR or LF.");
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new TypeError(
      `timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}.`,
    );
  }

  return {
    async generateText(request) {
      const messages = [];
      if (request.systemText !== undefined) {
        messages.push({ role: "system", content: request.systemText });
      }
      messages.push({ role: "user", content: request.userText });
      const body = JSON.stringify({ model, messages, stream: false });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey !== undefined && apiKey.trim().length !== 0) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetch(endpoint, {
            method: "POST",
            headers,
            body,
            redirect: "error",
            signal: controller.signal,
          });
        } catch (error) {
          return transportFailure(
            error,
            controller.signal,
            "OpenAI-compatible network request failed.",
          );
        }

        let text: string;
        try {
          text = await response.text();
        } catch (error) {
          return transportFailure(
            error,
            controller.signal,
            "OpenAI-compatible response body could not be read.",
          );
        }
        if (controller.signal.aborted) {
          return failure("OpenAI-compatible request timed out.");
        }
        if (!response.ok) {
          return failure(
            `OpenAI-compatible request failed with HTTP ${response.status}.`,
          );
        }

        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch (error) {
          if (error instanceof SyntaxError) {
            return failure("OpenAI-compatible returned invalid JSON.");
          }
          throw error;
        }
        return mapResponse(data);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
