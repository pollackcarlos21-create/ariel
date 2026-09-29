import { type ModelResult, requestModelText } from "@ariel/core";
import { createInMemoryModelPort } from "@ariel/providers";

export function runInMemoryModelDemo(userText: string): Promise<ModelResult> {
  const modelPort = createInMemoryModelPort();
  return requestModelText({ userText }, modelPort);
}
