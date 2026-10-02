import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  type CodeEditProposalResult,
  type ModelPort,
  proposeCodeEdit,
} from "@ariel/core";
import { createDeepSeekModelPort } from "@ariel/providers";

// v0.1 host product policy. The provider still requires an explicit timeout.
const CODE_EDIT_TIMEOUT_MS = 120_000;
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
]);

function safeModelFailureMessage(message: string): string | undefined {
  const httpStatus = /^DeepSeek request failed with HTTP ([1-5]\d{2})\.$/.exec(
    message,
  )?.[1];
  return httpStatus === undefined
    ? SAFE_MODEL_FAILURE_MESSAGES.get(message)
    : `DeepSeek code-edit request failed (HTTP ${httpStatus}).`;
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

export async function runDeepSeekCodeEditFromFile(
  filePath: string,
  instruction: string,
  apiKey: string,
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

  return runDeepSeekCodeEditTask(instruction, sourceText, apiKey);
}

export function runDeepSeekCodeEditTask(
  instruction: string,
  sourceText: string,
  apiKey: string,
): Promise<CodeEditProposalResult> {
  const modelPort = createDeepSeekModelPort({
    apiKey,
    model: "deepseek-flash",
    timeoutMs: CODE_EDIT_TIMEOUT_MS,
  });
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
