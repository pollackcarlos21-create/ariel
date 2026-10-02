import {
  openProjectFiles,
  type ProjectDirectoryEntry,
  type ProjectFiles,
  type ProjectFilesErrorKind,
  type ProjectFileSnapshot,
  type ProjectUndoRecord,
  runDeepSeekCodeEditTask,
} from "@ariel/local-host";

type ProposalResult = Awaited<ReturnType<typeof runDeepSeekCodeEditTask>>;
type CodeEditProposal = Extract<
  ProposalResult,
  { status: "completed" }
>["proposal"];

export type TuiFocus = "tree" | "code" | "task";
export type TuiModal =
  | "privacy"
  | "apply"
  | "open-project"
  | "help"
  | "error"
  | null;
export type TuiStatus =
  | "idle"
  | "reading-file"
  | "requesting-model"
  | "proposal-ready"
  | "applying"
  | "applied"
  | "undo-complete"
  | "error";

export interface TuiTreeEntry extends ProjectDirectoryEntry {
  readonly depth: number;
  readonly expanded: boolean;
}

export interface TuiProposal {
  readonly snapshot: ProjectFileSnapshot;
  readonly proposal: CodeEditProposal;
}

export interface TuiState {
  readonly projectRoot: string | null;
  readonly tree: readonly TuiTreeEntry[];
  readonly selectedTreeIndex: number;
  readonly file: ProjectFileSnapshot | null;
  readonly proposal: TuiProposal | null;
  readonly latestUndo: { readonly relativePath: string } | null;
  readonly instruction: string;
  readonly focus: TuiFocus;
  readonly busy: boolean;
  readonly status: TuiStatus;
  readonly error: string | null;
  readonly modal: TuiModal;
  readonly privacyConfirmed: boolean;
  readonly providerConfigured: boolean;
}

export interface TuiControllerConfig {
  readonly initialProjectPath: string;
  readonly apiKey?: string;
  // Offline presentation/controller tests can substitute the model composition.
  readonly propose?: (
    instruction: string,
    sourceText: string,
  ) => Promise<ProposalResult>;
}

export interface TuiController {
  getState(): TuiState;
  redactCredentialForDisplay(text: string): string;
  subscribe(listener: () => void): () => void;
  dispose(): void;
  start(): Promise<void>;
  openProject(path: string): Promise<void>;
  selectTreeEntry(index: number): void;
  moveTreeSelection(delta: number): void;
  activateSelected(): Promise<void>;
  expandSelected(): Promise<void>;
  collapseSelected(): void;
  selectFile(relativePath: string): Promise<void>;
  setInstruction(instruction: string): void;
  generateProposal(): Promise<void>;
  confirmPrivacy(): Promise<void>;
  requestApply(): void;
  confirmApply(): Promise<void>;
  rejectProposal(): void;
  undoApply(): Promise<void>;
  setFocus(focus: TuiFocus): void;
  cycleFocus(): void;
  openProjectModal(): void;
  showHelp(): void;
  cancelModal(): void;
}

const FILE_MESSAGES: Record<ProjectFilesErrorKind, string> = {
  "invalid-project": "无法安全打开项目目录，请检查路径和权限。",
  "invalid-path": "该路径不属于允许的项目文件范围。",
  "directory-read-failure": "无法读取项目目录，请检查路径和权限。",
  "file-read-failure": "仅支持可安全读取的 UTF-8 普通文本文件（最多 5 MiB）。",
  "invalid-proposal": "修改建议未通过文件替换验证。",
  "stale-proposal": "文件已在生成建议后变化，请重新生成。",
  "file-write-failure": "无法安全写入文件，操作未完成。",
  "stale-undo": "文件已在 Apply 后变化，不能覆盖当前修改。",
};

const TASK_MESSAGES = {
  "invalid-task": "源码文件不能为空，修改要求必须包含非空白字符。",
  "model-failure": "DeepSeek 请求失败，请检查配置或稍后再试。",
  "invalid-proposal": "模型返回的修改建议未通过 Ariel validation。",
};

function modelFailureMessage(message: string): string {
  switch (message) {
    case "DeepSeek code-edit request timed out.":
      return "DeepSeek 请求超时（120 秒），请稍后再试。";
    case "DeepSeek code-edit network request failed.":
      return "DeepSeek 网络请求失败，请检查网络或代理配置。";
    case "DeepSeek code-edit response body could not be read.":
      return "DeepSeek 响应正文读取失败，请检查网络后再试。";
    case "DeepSeek code-edit response was not valid JSON.":
      return "DeepSeek 响应不是有效 JSON，当前无法处理该响应。";
    case "DeepSeek code-edit response was unsupported.":
      return "DeepSeek 响应格式不兼容，当前无法处理该响应。";
  }
  const match = /^DeepSeek code-edit request failed \(HTTP ([1-5][0-9]{2})\)\.$/.exec(message);
  // `$` may match before a final newline; equality keeps the allowlist exact.
  const status = match?.[1];
  if (match?.[0] !== message || status === undefined)
    return TASK_MESSAGES["model-failure"];
  switch (status) {
    case "401":
      return "DeepSeek 认证失败（HTTP 401），请检查 DeepSeek 官方 API key。";
    case "402":
      return "DeepSeek 余额不足（HTTP 402），请检查账户余额。";
    case "429":
      return "DeepSeek 请求限流（HTTP 429），请稍后再试。";
    case "400":
    case "422":
      return `DeepSeek 拒绝了请求（HTTP ${status}）。`;
    default:
      return status.startsWith("5")
        ? `DeepSeek 服务故障（HTTP ${status}），请稍后再试。`
        : `DeepSeek 请求失败（HTTP ${status}），请检查服务配置。`;
  }
}

class TuiUserFailure extends Error {}

export function createTuiController(
  config: TuiControllerConfig,
): TuiController {
  const key = config.apiKey;
  const providerConfigured = typeof key === "string" && key.trim().length > 0;
  const containsCredential = (text: string): boolean =>
    providerConfigured && key !== undefined && text.includes(key.trim());
  const generate =
    config.propose ??
    ((instruction: string, sourceText: string) =>
      runDeepSeekCodeEditTask(instruction, sourceText, key ?? ""));
  let project: ProjectFiles | undefined;
  let pending: TuiProposal | undefined;
  let undo: ProjectUndoRecord | undefined;
  let directories = new Map<string, readonly ProjectDirectoryEntry[]>();
  let expanded = new Set<string>([""]);
  const listeners = new Set<() => void>();
  let disposed = false;
  let state: TuiState = Object.freeze({
    projectRoot: null,
    tree: Object.freeze([]),
    selectedTreeIndex: -1,
    file: null,
    proposal: null,
    latestUndo: null,
    instruction: "",
    focus: "tree",
    busy: false,
    status: "idle",
    error: null,
    modal: null,
    privacyConfirmed: false,
    providerConfigured,
  });

  function update(change: Partial<TuiState>): void {
    if (disposed) return;
    state = Object.freeze({ ...state, ...change });
    for (const listener of listeners) listener();
  }

  function failure(message: string): void {
    update({ error: message, modal: "error", status: "error" });
  }

  async function operation(
    status: TuiStatus,
    action: () => Promise<void>,
  ): Promise<void> {
    if (state.busy || disposed) return;
    update({ busy: true, status, error: null, modal: null });
    try {
      await action();
    } catch (error) {
      if (error instanceof TuiUserFailure) failure(error.message);
      else throw error;
    } finally {
      update({ busy: false });
    }
  }

  function checkCredentialText(text: string): void {
    if (containsCredential(text))
      throw new TuiUserFailure(
        "输入包含本次 credential，不能显示或发送给模型。",
      );
  }

  function checkEntries(entries: readonly ProjectDirectoryEntry[]): void {
    for (const entry of entries) {
      checkCredentialText(entry.name);
      checkCredentialText(entry.relativePath);
    }
  }

  function treeSnapshot(): readonly TuiTreeEntry[] {
    const entries: TuiTreeEntry[] = [];
    function visit(path: string, depth: number): void {
      for (const entry of directories.get(path) ?? []) {
        const opened =
          entry.type === "directory" && expanded.has(entry.relativePath);
        entries.push(Object.freeze({ ...entry, depth, expanded: opened }));
        if (opened) visit(entry.relativePath, depth + 1);
      }
    }
    visit("", 0);
    return Object.freeze(entries);
  }

  function rebuildTree(selectedPath?: string): void {
    const tree = treeSnapshot();
    const selected =
      selectedPath === undefined
        ? state.selectedTreeIndex
        : tree.findIndex((entry) => entry.relativePath === selectedPath);
    update({
      tree,
      selectedTreeIndex:
        tree.length === 0
          ? -1
          : Math.max(0, Math.min(selected, tree.length - 1)),
    });
  }

  function idleStatus(): TuiStatus {
    return pending === undefined ? "idle" : "proposal-ready";
  }

  async function openProject(path: string): Promise<void> {
    await operation("reading-file", async () => {
      checkCredentialText(path);
      const opened = await openProjectFiles(path);
      if (opened.status === "failed")
        throw new TuiUserFailure(FILE_MESSAGES[opened.error.kind]);
      checkCredentialText(opened.value.rootPath);
      const listed = await opened.value.listDirectory();
      if (listed.status === "failed")
        throw new TuiUserFailure(FILE_MESSAGES[listed.error.kind]);
      checkEntries(listed.value);
      project = opened.value;
      pending = undefined;
      undo = undefined;
      directories = new Map([["", listed.value]]);
      expanded = new Set([""]);
      update({
        projectRoot: project.rootPath,
        selectedTreeIndex: 0,
        file: null,
        proposal: null,
        latestUndo: null,
        instruction: "",
        focus: "tree",
        status: "idle",
      });
      rebuildTree();
    });
  }

  function selectedEntry(): TuiTreeEntry | undefined {
    return state.tree[state.selectedTreeIndex];
  }

  function selectTreeEntry(index: number): void {
    if (
      state.busy ||
      state.modal !== null ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= state.tree.length
    )
      return;
    update({ selectedTreeIndex: index });
  }

  async function expandSelected(): Promise<void> {
    if (state.busy || state.modal !== null) return;
    const entry = selectedEntry();
    if (
      !project ||
      entry?.type !== "directory" ||
      expanded.has(entry.relativePath)
    )
      return;
    const files = project;
    await operation("reading-file", async () => {
      if (!directories.has(entry.relativePath)) {
        const listed = await files.listDirectory(entry.relativePath);
        if (listed.status === "failed")
          throw new TuiUserFailure(FILE_MESSAGES[listed.error.kind]);
        checkEntries(listed.value);
        directories.set(entry.relativePath, listed.value);
      }
      expanded.add(entry.relativePath);
      rebuildTree(entry.relativePath);
      update({ status: idleStatus() });
    });
  }

  function collapseSelected(): void {
    if (state.busy || state.modal !== null) return;
    const entry = selectedEntry();
    if (!entry) return;
    if (entry.type === "directory" && expanded.has(entry.relativePath)) {
      expanded.delete(entry.relativePath);
      rebuildTree(entry.relativePath);
    } else {
      const separator = entry.relativePath.lastIndexOf("/");
      if (separator >= 0) {
        const index = state.tree.findIndex(
          (item) =>
            item.relativePath === entry.relativePath.slice(0, separator),
        );
        selectTreeEntry(index);
      }
    }
  }

  async function selectFile(relativePath: string): Promise<void> {
    if (state.busy || state.modal !== null || !project) return;
    const files = project;
    await operation("reading-file", async () => {
      const read = await files.readFile(relativePath);
      if (read.status === "failed")
        throw new TuiUserFailure(FILE_MESSAGES[read.error.kind]);
      checkCredentialText(read.value.relativePath);
      checkCredentialText(read.value.sourceText);
      pending = undefined;
      update({
        file: Object.freeze(read.value),
        proposal: null,
        instruction: "",
        focus: "task",
        status: "idle",
      });
    });
  }

  async function generateProposal(): Promise<void> {
    if (state.busy || state.modal !== null) return;
    if (!project || !state.file) {
      failure("请选择一个源码文件。");
      return;
    }
    if (state.instruction.trim().length === 0) {
      failure("请输入包含非空白字符的修改要求。");
      return;
    }
    if (!providerConfigured) {
      failure(
        "DeepSeek API key 未配置。请设置 DEEPSEEK_API_KEY 后重新启动 Ariel。",
      );
      return;
    }
    if (!state.privacyConfirmed) {
      update({ modal: "privacy" });
      return;
    }
    const files = project;
    const path = state.file.relativePath;
    const instruction = state.instruction;
    await operation("reading-file", async () => {
      pending = undefined;
      update({ proposal: null });
      const read = await files.readFile(path);
      if (read.status === "failed")
        throw new TuiUserFailure(FILE_MESSAGES[read.error.kind]);
      checkCredentialText(read.value.relativePath);
      checkCredentialText(read.value.sourceText);
      checkCredentialText(instruction);
      if (read.value.sourceText.length === 0)
        throw new TuiUserFailure(TASK_MESSAGES["invalid-task"]);
      if (disposed) return;
      const snapshot = Object.freeze(read.value);
      update({ file: snapshot, status: "requesting-model" });
      if (disposed) return;
      const result = await generate(instruction, snapshot.sourceText);
      if (disposed) return;
      if (result.status === "failed")
        throw new TuiUserFailure(
          result.error.kind === "model-failure"
            ? modelFailureMessage(result.error.message)
            : TASK_MESSAGES[result.error.kind],
        );
      checkCredentialText(result.proposal.oldText);
      checkCredentialText(result.proposal.newText);
      pending = Object.freeze({
        snapshot,
        proposal: Object.freeze({ ...result.proposal }),
      });
      update({ proposal: pending, status: "proposal-ready", focus: "code" });
    });
  }

  function requestApply(): void {
    if (!state.busy && state.modal === null && pending)
      update({ modal: "apply" });
  }

  async function confirmApply(): Promise<void> {
    if (state.busy || state.modal !== "apply" || !project || !pending) return;
    const files = project;
    const proposal = pending;
    await operation("applying", async () => {
      const applied = await files.applyProposal(
        proposal.snapshot,
        proposal.proposal,
      );
      if (applied.status === "failed")
        throw new TuiUserFailure(FILE_MESSAGES[applied.error.kind]);
      undo = Object.freeze(applied.value.undo);
      pending = undefined;
      update({
        file: Object.freeze(applied.value.snapshot),
        proposal: null,
        latestUndo: Object.freeze({ relativePath: undo.relativePath }),
        status: "applied",
        focus: "code",
      });
    });
  }

  async function undoApply(): Promise<void> {
    if (state.busy || state.modal !== null || !project || !undo) return;
    const files = project;
    const record = undo;
    await operation("applying", async () => {
      const restored = await files.undoApply(record);
      if (restored.status === "failed")
        throw new TuiUserFailure(FILE_MESSAGES[restored.error.kind]);
      undo = undefined;
      pending = undefined;
      update({
        file: Object.freeze(restored.value),
        proposal: null,
        latestUndo: null,
        instruction: "",
        status: "undo-complete",
        focus: "code",
      });
    });
  }

  return {
    getState: () => state,
    redactCredentialForDisplay(text) {
      return providerConfigured && key !== undefined
        ? text.replaceAll(key.trim(), "[credential hidden]")
        : text;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
    start: () => openProject(config.initialProjectPath),
    openProject,
    selectTreeEntry,
    moveTreeSelection(delta) {
      if (Number.isInteger(delta))
        selectTreeEntry(
          Math.max(
            0,
            Math.min(state.selectedTreeIndex + delta, state.tree.length - 1),
          ),
        );
    },
    async activateSelected() {
      const entry = selectedEntry();
      if (entry?.type === "directory") {
        if (entry.expanded) collapseSelected();
        else await expandSelected();
      } else if (entry?.type === "file") await selectFile(entry.relativePath);
    },
    expandSelected,
    collapseSelected,
    selectFile,
    setInstruction(instruction) {
      if (state.busy || state.modal !== null) return;
      if (containsCredential(instruction)) {
        update({ instruction: "" });
        failure("修改要求包含本次 credential，不能显示或发送给模型。");
        return;
      }
      update({ instruction });
    },
    generateProposal,
    async confirmPrivacy() {
      if (state.busy || state.modal !== "privacy") return;
      update({ privacyConfirmed: true, modal: null });
      await generateProposal();
    },
    requestApply,
    confirmApply,
    rejectProposal() {
      if (state.busy || state.modal !== null) return;
      pending = undefined;
      update({ proposal: null, status: "idle", error: null, focus: "code" });
    },
    undoApply,
    setFocus(focus) {
      if (!state.busy && state.modal === null) update({ focus });
    },
    cycleFocus() {
      if (state.busy || state.modal !== null) return;
      const focus: TuiFocus[] = ["tree", "code", "task"];
      update({
        focus: focus[(focus.indexOf(state.focus) + 1) % focus.length] ?? "tree",
      });
    },
    openProjectModal() {
      if (!state.busy && state.modal === null)
        update({ modal: "open-project" });
    },
    showHelp() {
      if (!state.busy && state.modal === null) update({ modal: "help" });
    },
    cancelModal() {
      if (!state.busy) update({ modal: null });
    },
  };
}
