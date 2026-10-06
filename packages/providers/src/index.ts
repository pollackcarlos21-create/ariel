import type { ModelPort } from "@ariel/core";

export {
  createDeepSeekModelPort,
  type DeepSeekModelPortConfig,
} from "./deepseek";
export {
  createOpenAICompatibleModelPort,
  type OpenAICompatibleModelPortConfig,
} from "./openai-compatible";

export function createInMemoryModelPort(): ModelPort {
  return {
    async generateText(request) {
      return { status: "completed", text: `Echo: ${request.userText}` };
    },
  };
}
