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

export {
  type FileCodeEditResult,
  runConfiguredCodeEditTask,
  runConfiguredCodeEditFromFile,
  runDeepSeekCodeEditTask,
  runDeepSeekCodeEditFromFile,
} from "./code-edit-file";

export {
  type ArielModelProvider,
  type ArielModelConfigResult,
  createConfiguredModelPort,
  parseArielModelConfig,
} from "./model-config";

export {
  openProjectFiles,
  type ProjectAppliedEdit,
  type ProjectDirectoryEntry,
  type ProjectFiles,
  type ProjectFilesErrorKind,
  type ProjectFilesResult,
  type ProjectFileSnapshot,
  type ProjectUndoRecord,
} from "./project-files";

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
