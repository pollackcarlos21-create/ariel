export interface ApplicationStatus {
  readonly agentExecution: "not-implemented";
}

export function getApplicationStatus(): ApplicationStatus {
  return { agentExecution: "not-implemented" };
}
