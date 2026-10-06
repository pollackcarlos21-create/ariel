import type { ModelPort } from "@ariel/core";
import {
  createDeepSeekModelPort,
  createOpenAICompatibleModelPort,
} from "@ariel/providers";

// Explicit host product policy; neither provider has a hidden timeout default.
const CODE_EDIT_TIMEOUT_MS = 120_000;

export type ArielModelProvider =
  | { readonly kind: "deepseek"; readonly apiKey: string }
  | {
      readonly kind: "openai-compatible";
      readonly baseUrl: string;
      readonly apiKey?: string;
      readonly model: string;
    };

export type ArielModelConfigResult =
  | { readonly status: "configured"; readonly provider: ArielModelProvider }
  | {
      readonly status: "failed";
      readonly providerName:
        | "DeepSeek"
        | "OpenAI-compatible"
        | "Model provider";
      readonly error: { readonly message: string };
    };

function configFailure(
  providerName: "DeepSeek" | "OpenAI-compatible" | "Model provider",
  message: string,
): ArielModelConfigResult {
  return { status: "failed", providerName, error: { message } };
}

function validBaseUrl(baseUrl: string): boolean {
  if (baseUrl.trim() !== baseUrl || /[\p{Cc}?#\\]/u.test(baseUrl)) return false;
  const authority = /^https?:\/\/([^/]+)(?:\/|$)/i.exec(baseUrl)?.[1];
  if (authority === undefined || authority.includes("@")) return false;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(authority)
  );
}

// Pure parser: only an executable reads env and passes its values here.
export function parseArielModelConfig(
  env: Readonly<Record<string, string | undefined>>,
): ArielModelConfigResult {
  const kind = env.ARIEL_PROVIDER ?? "deepseek";
  if (kind === "deepseek") {
    const apiKey = env.DEEPSEEK_API_KEY;
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      return configFailure(
        "DeepSeek",
        "请先配置非空的 DEEPSEEK_API_KEY 环境变量。",
      );
    }
    if (/[\r\n]/u.test(apiKey)) {
      return configFailure(
        "DeepSeek",
        "Invalid DEEPSEEK_API_KEY configuration.",
      );
    }
    return { status: "configured", provider: { kind, apiKey } };
  }
  if (kind !== "openai-compatible") {
    return configFailure("Model provider", "Unsupported ARIEL_PROVIDER.");
  }

  const baseUrl = env.OPENAI_COMPATIBLE_BASE_URL;
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    return configFailure(
      "OpenAI-compatible",
      "OPENAI_COMPATIBLE_BASE_URL is required.",
    );
  }
  if (!validBaseUrl(baseUrl)) {
    return configFailure(
      "OpenAI-compatible",
      "OPENAI_COMPATIBLE_BASE_URL must be HTTPS or loopback HTTP without credentials, query or fragment.",
    );
  }
  const model = env.OPENAI_COMPATIBLE_MODEL;
  if (
    typeof model !== "string" ||
    model.trim().length === 0 ||
    /\p{Cc}/u.test(model)
  ) {
    return configFailure(
      "OpenAI-compatible",
      "OPENAI_COMPATIBLE_MODEL must be a non-empty model identifier.",
    );
  }
  const apiKey = env.OPENAI_COMPATIBLE_API_KEY;
  if (
    apiKey !== undefined &&
    /[\r\n]/u.test(apiKey) &&
    apiKey.trim().length !== 0
  ) {
    return configFailure(
      "OpenAI-compatible",
      "Invalid OPENAI_COMPATIBLE_API_KEY configuration.",
    );
  }
  return {
    status: "configured",
    provider: {
      kind,
      baseUrl,
      model,
      ...(apiKey === undefined || apiKey.trim().length === 0 ? {} : { apiKey }),
    },
  };
}

export function createConfiguredModelPort(
  provider: ArielModelProvider,
): ModelPort {
  switch (provider.kind) {
    case "deepseek":
      return createDeepSeekModelPort({
        apiKey: provider.apiKey,
        model: "deepseek-flash",
        timeoutMs: CODE_EDIT_TIMEOUT_MS,
      });
    case "openai-compatible":
      return createOpenAICompatibleModelPort({
        baseUrl: provider.baseUrl,
        model: provider.model,
        ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
        timeoutMs: CODE_EDIT_TIMEOUT_MS,
      });
  }
}
