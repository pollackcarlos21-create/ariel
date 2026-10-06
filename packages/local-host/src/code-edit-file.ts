import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  type CodeEditProposalResult,
  type ModelPort,
  proposeCodeEdit,
} from "@ariel/core";
import {
  type ArielModelProvider,
  createConfiguredModelPort,
} from "./model-config";

const SAFE_MODEL_FAILURE_MESSAGES = new Map([
  ["DeepSeek request timed out.", "DeepSeek code-edit request timed out."],
  [
    "DeepSeek network request failed.",
    "DeepSeek code-edit network request failed.",
  ],
  [
    "DeepSeek response body could not be read.",
    "DeepSeek code-edit response body could not be read.",
  ],
  [
    "DeepSeek returned invalid JSON.",
    "DeepSeek code-edit response was not valid JSON.",
  ],
  [
    "DeepSeek returned an unsupported response.",
    "DeepSeek code-edit response was unsupported.",
  ],
  [
    "OpenAI-compatible request timed out.",
    "OpenAI-compatible code-edit request timed out.",
  ],
  [
    "OpenAI-compatible network request failed.",
    "OpenAI-compatible code-edit network request failed.",
  ],
  [
    "OpenAI-compatible response body could not be read.",
    "OpenAI-compatible code-edit response body could not be read.",
  ],
  [
    "OpenAI-compatible returned invalid JSON.",
    "OpenAI-compatible code-edit response was not valid JSON.",
  ],
  [
    "OpenAI-compatible returned an unsupported response.",
    "OpenAI-compatible code-edit response was unsupported.",
  ],
]);

function safeModelFailureMessage(message: string): string | undefined {
  const match =
    /^(DeepSeek|OpenAI-compatible) request failed with HTTP ([1-5]\d{2})\.$/.exec(
      message,
    );
  if (match !== null && match[0] === message) {
    return `${match[1]} code-edit request failed (HTTP ${match[2]}).`;
  }
  return SAFE_MODEL_FAILURE_MESSAGES.get(message);
}

const READ_ERROR_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "EISDIR",
  "ENOTDIR",
  "EINVAL",
  "ENAMETOOLONG",
  "ELOOP",
  "EIO",
  "EMFILE",
  "ENFILE",
  "EBADF",
  "EBUSY",
  "ENOMEM",
  "EFBIG",
]);

export type FileCodeEditResult =
  | CodeEditProposalResult
  | {
      readonly status: "failed";
      readonly error: {
        readonly kind: "file-read-failure";
        readonly message: string;
      };
    };

function fileReadFailure(): FileCodeEditResult {
  return {
    status: "failed",
    error: {
      kind: "file-read-failure",
      message: "The source file could not be read as UTF-8 text.",
    },
  };
}

export async function runConfiguredCodeEditFromFile(
  filePath: string,
  instruction: string,
  provider: ArielModelProvider,
): Promise<FileCodeEditResult> {
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.includes("\0")
  ) {
    return fileReadFailure();
  }

  let sourceText: string;
  // Only filesystem operations are in this catch; model errors remain outside it.
  try {
    const file = await open(
      filePath,
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
    try {
      if (!(await file.stat()).isFile()) return fileReadFailure();
      const bytes = await file.readFile();
      try {
        sourceText = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
      } catch (error) {
        if (error instanceof TypeError) return fileReadFailure();
        throw error;
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      READ_ERROR_CODES.has(error.code)
    ) {
      return fileReadFailure();
    }
    throw error;
  }

  return runConfiguredCodeEditTask(instruction, sourceText, provider);
}

export function runConfiguredCodeEditTask(
  instruction: string,
  sourceText: string,
  provider: ArielModelProvider,
): Promise<CodeEditProposalResult> {
  const modelPort = createConfiguredModelPort(provider);
  let safeMessage: string | undefined;
  // Observe only known adapter-generated failures; core receives the original
  // result and owns acceptance. Unknown messages and exceptions stay unchanged.
  const observedPort: ModelPort = {
    async generateText(request) {
      const result = await modelPort.generateText(request);
      if (
        result.status === "failed" &&
        result.error.kind === "provider-failure"
      ) {
        safeMessage = safeModelFailureMessage(result.error.message);
      }
      return result;
    },
  };
  return proposeCodeEdit({ instruction, sourceText }, observedPort).then(
    (result) =>
      result.status === "failed" &&
      result.error.kind === "model-failure" &&
      safeMessage !== undefined
        ? { ...result, error: { ...result.error, message: safeMessage } }
        : result,
  );
}

// Existing public DeepSeek operations remain thin compatibility wrappers.
export function runDeepSeekCodeEditFromFile(
  filePath: string,
  instruction: string,
  apiKey: string,
): Promise<FileCodeEditResult> {
  return runConfiguredCodeEditFromFile(filePath, instruction, {
    kind: "deepseek",
    apiKey,
  });
}

export function runDeepSeekCodeEditTask(
  instruction: string,
  sourceText: string,
  apiKey: string,
): Promise<CodeEditProposalResult> {
  return runConfiguredCodeEditTask(instruction, sourceText, {
    kind: "deepseek",
    apiKey,
  });
}
