import type { ModelPort } from "@ariel/core";

export function createInMemoryModelPort(): ModelPort {
  return {
    async generateText(request) {
      return { status: "completed", text: `Echo: ${request.userText}` };
    },
  };
}
