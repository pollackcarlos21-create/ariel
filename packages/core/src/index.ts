export {
  type CodeEditError,
  type CodeEditProposal,
  type CodeEditProposalResult,
  type CodeEditTask,
  proposeCodeEdit,
} from "./code-edit";

export {
  type ModelError,
  type ModelPort,
  type ModelRequest,
  type ModelResult,
  requestModelText,
} from "./model";

export interface ApplicationStatus {
  readonly agentExecution: "single-source-code-edit-proposal";
}

export function getApplicationStatus(): ApplicationStatus {
  return { agentExecution: "single-source-code-edit-proposal" };
}
