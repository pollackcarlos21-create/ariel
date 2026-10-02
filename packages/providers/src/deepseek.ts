import type { ModelPort, ModelResult } from "@ariel/core";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
// Bun's single-timer representability bound, not a default or product policy.
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface DeepSeekModelPortConfig {
  readonly apiKey: string;
  readonly model: "deepseek-flash";
  readonly timeoutMs: number;
}

function providerFailure(message: string): ModelResult {
  return { status: "failed", error: { kind: "provider-failure", message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapResponse(value: unknown): ModelResult {
  const unsupported = "DeepSeek returned an unsupported response.";
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.object !== "chat.completion" ||
    !Number.isInteger(value.created) ||
    typeof value.model !== "string" ||
    typeof value.system_fingerprint !== "string" ||
    !Array.isArray(value.choices) ||
    value.choices.length !== 1
  ) {
    return providerFailure(unsupported);
  }

  const choice: unknown = value.choices[0];
  if (
    !isRecord(choice) ||
    !Number.isInteger(choice.index) ||
    (choice.logprobs !== null && !isRecord(choice.logprobs)) ||
    choice.finish_reason !== "stop" ||
    !isRecord(choice.message) ||
    choice.message.role !== "assistant" ||
    typeof choice.message.content !== "string"
  ) {
    return providerFailure(unsupported);
  }

  const toolCalls = choice.message.tool_calls;
  if (
    toolCalls !== undefined &&
    (!Array.isArray(toolCalls) || toolCalls.length !== 0)
  ) {
    return providerFailure(unsupported);
  }

  return { status: "completed", text: choice.message.content };
}

function transportFailure(
  error: unknown,
  signal: AbortSignal,
  message: string,
): ModelResult {
  // Only transport catches call this; unknown programming errors still escape.
  if (signal.aborted && error === signal.reason) {
    return providerFailure("DeepSeek request timed out.");
  }
  if (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return providerFailure(
      signal.aborted ? "DeepSeek request timed out." : message,
    );
  }
  throw error;
}

export function createDeepSeekModelPort(
  config: DeepSeekModelPortConfig,
): ModelPort {
  const { apiKey, model, timeoutMs } = config;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new TypeError("apiKey must be a non-empty credential.");
  }
  if (model !== "deepseek-flash") {
    throw new TypeError("model must be deepseek-flash.");
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
      const body = JSON.stringify({
        model,
        messages,
        thinking: { type: "disabled" },
        stream: false,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetch(DEEPSEEK_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body,
            redirect: "error",
            signal: controller.signal,
          });
        } catch (error) {
          return transportFailure(
            error,
            controller.signal,
            "DeepSeek network request failed.",
          );
        }

        let text: string;
        try {
          text = await response.text();
        } catch (error) {
          return transportFailure(
            error,
            controller.signal,
            "DeepSeek response body could not be read.",
          );
        }

        if (controller.signal.aborted) {
          return providerFailure("DeepSeek request timed out.");
        }
        if (!response.ok) {
          return providerFailure(
            `DeepSeek request failed with HTTP ${response.status}.`,
          );
        }

        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch (error) {
          if (error instanceof SyntaxError) {
            return providerFailure("DeepSeek returned invalid JSON.");
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
