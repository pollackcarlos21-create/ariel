export {
  type ModelError,
  type ModelPort,
  type ModelRequest,
  type ModelResult,
  requestModelText,
} from "./model";

export interface ApplicationStatus {
  readonly agentExecution: "not-implemented";
}

export function getApplicationStatus(): ApplicationStatus {
  return { agentExecution: "not-implemented" };
}
