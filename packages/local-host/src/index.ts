import {
  type ModelRequest,
  type ModelResult,
  requestModelText,
} from "@ariel/core";
import {
  createDeepSeekModelPort,
  createInMemoryModelPort,
  type DeepSeekModelPortConfig,
} from "@ariel/providers";

export function runInMemoryModelDemo(userText: string): Promise<ModelResult> {
  const modelPort = createInMemoryModelPort();
  return requestModelText({ userText }, modelPort);
}

export function runDeepSeekModelRequest(
  request: ModelRequest,
  config: DeepSeekModelPortConfig,
): Promise<ModelResult> {
  const modelPort = createDeepSeekModelPort(config);
  return requestModelText(request, modelPort);
}
