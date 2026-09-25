import { expect, test } from "bun:test";
import { type ApplicationStatus, getApplicationStatus } from "@ariel/core";

test("public core application query reports agent execution status without setup", () => {
  const status: ApplicationStatus = getApplicationStatus();

  expect(status).toEqual({ agentExecution: "not-implemented" });
});
