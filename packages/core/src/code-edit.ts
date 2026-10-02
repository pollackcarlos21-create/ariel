import { type ModelPort, requestModelText } from "./model";

export interface CodeEditTask {
  readonly instruction: string;
  readonly sourceText: string;
}

export interface CodeEditProposal {
  readonly oldText: string;
  readonly newText: string;
}

export interface CodeEditError {
  readonly kind: "invalid-task" | "model-failure" | "invalid-proposal";
  readonly message: string;
}

export type CodeEditProposalResult =
  | {
      readonly status: "completed";
      readonly proposal: CodeEditProposal;
    }
  | {
      readonly status: "failed";
      readonly error: CodeEditError;
    };

const CODE_EDIT_SYSTEM_TEXT =
  "Propose exactly one code edit for the sourceText and instruction in the user's JSON input. " +
  "Return only one JSON object with exactly two string fields: oldText and newText. " +
  "Do not return Markdown code fences, explanation, or any additional fields. " +
  "oldText must be non-empty and occur at exactly one start position in the original sourceText, including overlapping matches. " +
  "Preserve the original characters and whitespace when choosing oldText. " +
  "newText may be empty to delete oldText, but must differ from oldText.";

function failure(
  kind: CodeEditError["kind"],
  message: string,
): CodeEditProposalResult {
  return { status: "failed", error: { kind, message } };
}

function invalidProposal(): CodeEditProposalResult {
  return failure(
    "invalid-proposal",
    "The model returned an invalid code edit proposal.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function proposeCodeEdit(
  task: CodeEditTask,
  modelPort: ModelPort,
): Promise<CodeEditProposalResult> {
  const { instruction, sourceText } = task;
  if (typeof instruction !== "string" || instruction.trim().length === 0) {
    return failure("invalid-task", "instruction must be a non-empty string.");
  }
  if (typeof sourceText !== "string" || sourceText.length === 0) {
    return failure("invalid-task", "sourceText must be a non-empty string.");
  }

  const result = await requestModelText(
    {
      userText: JSON.stringify({ instruction, sourceText }),
      systemText: CODE_EDIT_SYSTEM_TEXT,
    },
    modelPort,
  );
  if (result.status === "failed") {
    return failure(
      "model-failure",
      "The model did not return a completed code edit proposal.",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(result.text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return invalidProposal();
    }
    throw error;
  }

  if (!isRecord(decoded)) {
    return invalidProposal();
  }
  const keys = Object.keys(decoded);
  if (
    keys.length !== 2 ||
    !keys.includes("oldText") ||
    !keys.includes("newText")
  ) {
    return invalidProposal();
  }
  const { oldText, newText } = decoded;
  if (
    typeof oldText !== "string" ||
    typeof newText !== "string" ||
    oldText.length === 0 ||
    oldText === newText
  ) {
    return invalidProposal();
  }
  const firstStart = sourceText.indexOf(oldText);
  if (firstStart === -1 || sourceText.indexOf(oldText, firstStart + 1) !== -1) {
    return invalidProposal();
  }

  return { status: "completed", proposal: { oldText, newText } };
}
