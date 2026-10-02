import { Box, Text as InkText, useInput, usePaste, useWindowSize } from "ink";
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import type { TuiController } from "./controller";
import {
  createTheme,
  terminalLabel,
  terminalText,
  type ArielTheme,
} from "./theme";

const MIN_COLUMNS = 60;
const MIN_ROWS = 20;

function Text({
  color,
  ...props
}: Omit<ComponentProps<typeof InkText>, "color"> & {
  readonly color?: string | undefined;
}) {
  return <InkText {...props} {...(color === undefined ? {} : { color })} />;
}

function removeLastCharacter(text: string): string {
  const characters = Array.from(text);
  characters.pop();
  return characters.join("");
}

function visibleLine(text: string): string {
  return terminalText(text).replaceAll("\t", "    ");
}

function clippedLine(text: string, columns: number): string {
  let prefix = text.slice(0, columns * 2);
  const last = prefix.charCodeAt(prefix.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) prefix = prefix.slice(0, -1);
  return visibleLine(prefix);
}

function Panel({
  title,
  focused,
  width,
  height,
  theme,
  children,
}: {
  readonly title: string;
  readonly focused: boolean;
  readonly width: number;
  readonly height: number;
  readonly theme: ArielTheme;
  readonly children: React.ReactNode;
}) {
  return (
    <Box
      width={width}
      height={height}
      flexDirection="column"
      borderStyle={focused ? "double" : "round"}
      borderColor={focused ? theme.borderStrong : theme.border}
      paddingX={1}
      overflow="hidden"
    >
      <Text color={focused ? theme.accent : theme.muted} bold={theme.bold}>
        {title}
      </Text>
      {children}
    </Box>
  );
}

export function App({
  controller,
  noColor,
  onQuit,
  onFatal,
}: {
  readonly controller: TuiController;
  readonly noColor: boolean;
  readonly onQuit: () => void;
  readonly onFatal: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const { columns, rows } = useWindowSize();
  const theme = useMemo(() => createTheme(noColor), [noColor]);
  const [projectInput, setProjectInput] = useState("");
  const [scroll, setScroll] = useState(0);
  const [taskCursor, setTaskCursor] = useState(0);
  const [command, setCommand] = useState<string | null>(null);
  const narrow = columns < 90;
  const bodyHeight = Math.max(4, rows - 11);
  const treeWidth = narrow ? columns : Math.max(22, Math.floor(columns * 0.25));
  const showTree = !narrow || state.focus === "tree";
  const codeWidth = narrow ? columns : columns - treeWidth;
  const contentHeight = Math.max(1, bodyHeight - 3);

  const displayLines = useMemo(() => {
    if (state.proposal !== null) {
      return [
        { id: "legend", text: "--- before / +++ after", kind: "context" },
        ...state.proposal.proposal.oldText.split("\n").map((text, index) => ({
          id: `before:${index}`,
          text: `- ${text}`,
          kind: "removed",
        })),
        ...state.proposal.proposal.newText.split("\n").map((text, index) => ({
          id: `after:${index}`,
          text: `+ ${text}`,
          kind: "added",
        })),
        ...(state.proposal.proposal.newText === ""
          ? [
              {
                id: "deletion",
                text: "newText is empty: delete oldText",
                kind: "context",
              },
            ]
          : []),
      ];
    }
    return (
      state.file?.sourceText.split("\n").map((text, index) => ({
        id: `source:${index}`,
        text: `${String(index + 1).padStart(5)} │ ${text}`,
        kind: "context",
      })) ?? []
    );
  }, [state.file, state.proposal]);
  const safeScroll = Math.max(
    0,
    Math.min(scroll, Math.max(0, displayLines.length - contentHeight)),
  );
  const selectedTreeStart = Math.max(
    0,
    state.selectedTreeIndex - contentHeight + 1,
  );

  function run(operation: Promise<void>): void {
    void operation.catch(onFatal);
  }

  function openProjectInput(): void {
    if (state.busy) return;
    setProjectInput(state.projectRoot ?? "");
    controller.openProjectModal();
  }

  function insertInstruction(input: string): void {
    const position = Math.min(taskCursor, state.instruction.length);
    controller.setInstruction(
      state.instruction.slice(0, position) +
        input +
        state.instruction.slice(position),
    );
    setTaskCursor(position + input.length);
  }

  usePaste((input) => {
    if (state.busy) return;
    if (state.modal === "open-project")
      setProjectInput((previous) => previous + input);
    else if (state.modal === null && state.focus === "task")
      insertInstruction(input);
  });

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onQuit();
      return;
    }
    if (command !== null) {
      if (
        (input.endsWith("\r") || input.endsWith("\n")) &&
        `${command}${input}`.trimEnd() === ":q"
      ) {
        onQuit();
        setCommand(null);
      } else if (key.escape) setCommand(null);
      else if (key.return) {
        if (command === ":q") onQuit();
        setCommand(null);
      } else if (key.backspace || key.delete)
        setCommand(removeLastCharacter(command));
      else if (!key.ctrl && !key.meta) setCommand(command + input);
      return;
    }
    if (state.modal !== null) {
      if (key.escape) {
        controller.cancelModal();
        return;
      }
      if (state.modal === "open-project") {
        if (key.ctrl && input === "u") setProjectInput("");
        else if (key.return) run(controller.openProject(projectInput));
        else if (key.backspace || key.delete)
          setProjectInput(removeLastCharacter(projectInput));
        else if (!key.ctrl && !key.meta)
          setProjectInput((previous) => previous + input);
      } else if (key.return) {
        if (state.modal === "privacy") run(controller.confirmPrivacy());
        else if (state.modal === "apply") run(controller.confirmApply());
        else controller.cancelModal();
      }
      return;
    }
    if (key.ctrl && input === "o") {
      openProjectInput();
      return;
    }
    if (state.busy) return;
    if (key.tab) {
      controller.cycleFocus();
      return;
    }
    if (key.escape) {
      controller.setFocus(state.proposal === null ? "tree" : "code");
      return;
    }
    if (state.focus === "task") {
      const position = Math.min(taskCursor, state.instruction.length);
      if (key.ctrl && input === "j") insertInstruction("\n");
      else if (key.return && key.shift) insertInstruction("\n");
      else if (key.return) {
        if (state.instruction.trim() === ":q") onQuit();
        else run(controller.generateProposal());
      } else if (key.leftArrow) {
        setTaskCursor(
          removeLastCharacter(state.instruction.slice(0, position)).length,
        );
      } else if (key.rightArrow) {
        const next = Array.from(state.instruction.slice(position))[0];
        setTaskCursor(position + (next?.length ?? 0));
      } else if (key.home || (key.ctrl && input === "a")) setTaskCursor(0);
      else if (key.end || (key.ctrl && input === "e"))
        setTaskCursor(state.instruction.length);
      else if (key.backspace) {
        const before = removeLastCharacter(
          state.instruction.slice(0, position),
        );
        controller.setInstruction(before + state.instruction.slice(position));
        setTaskCursor(before.length);
      } else if (key.delete) {
        const next = Array.from(state.instruction.slice(position))[0];
        controller.setInstruction(
          state.instruction.slice(0, position) +
            state.instruction.slice(position + (next?.length ?? 0)),
        );
      } else if (!key.ctrl && !key.meta && input !== "")
        insertInstruction(input);
      return;
    }
    if (input.startsWith(":")) {
      if (
        (input.endsWith("\r") || input.endsWith("\n")) &&
        input.trimEnd() === ":q"
      )
        onQuit();
      else setCommand(input);
      return;
    }
    const shortcut = input.toLowerCase();
    if (shortcut === "?") controller.showHelp();
    else if (shortcut === "g") {
      setTaskCursor(state.instruction.length);
      controller.setFocus("task");
    } else if (shortcut === "a") controller.requestApply();
    else if (shortcut === "r") controller.rejectProposal();
    else if (shortcut === "u") run(controller.undoApply());
    else if (state.focus === "tree") {
      if (key.upArrow) controller.moveTreeSelection(-1);
      else if (key.downArrow) controller.moveTreeSelection(1);
      else if (key.return) {
        setScroll(0);
        run(controller.activateSelected());
      } else if (key.rightArrow) run(controller.expandSelected());
      else if (key.leftArrow) controller.collapseSelected();
    } else if (state.focus === "code") {
      if (key.upArrow) setScroll(Math.max(0, safeScroll - 1));
      else if (key.downArrow)
        setScroll(Math.min(displayLines.length - 1, safeScroll + 1));
      else if (key.pageUp) setScroll(Math.max(0, safeScroll - contentHeight));
      else if (key.pageDown)
        setScroll(
          Math.min(displayLines.length - 1, safeScroll + contentHeight),
        );
      else if (key.home) setScroll(0);
      else if (key.end)
        setScroll(Math.max(0, displayLines.length - contentHeight));
    }
  });

  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return (
      <Box
        width={Math.max(1, columns)}
        height={Math.max(1, rows)}
        flexDirection="column"
      >
        <Text wrap="truncate">Terminal is too small.</Text>
        <Text wrap="truncate">
          Resize to at least {MIN_COLUMNS} × {MIN_ROWS}.
        </Text>
        <Text wrap="truncate">Ctrl+C exits Ariel.</Text>
      </Box>
    );
  }

  const taskPosition = Math.min(taskCursor, state.instruction.length);
  const inputPreview =
    terminalText(state.instruction.slice(0, taskPosition)) +
    "▌" +
    terminalText(state.instruction.slice(taskPosition));
  const taskLines = inputPreview.split("\n").slice(-2);
  const modalWidth = Math.max(40, Math.min(72, columns - 6));

  const modal =
    state.modal !== null ? (
      <Box
        width={modalWidth}
        borderStyle="double"
        borderColor={
          state.modal === "error" ? theme.danger : theme.borderStrong
        }
        paddingX={2}
        flexDirection="column"
        maxHeight={bodyHeight}
        overflow="hidden"
      >
        {state.modal === "help" ? (
          <>
            <Text bold={theme.bold} color={theme.accent}>
              Ariel Keyboard Reference
            </Text>
            <Text wrap="truncate-end">
              Navigation ↑↓ Move · ←→ Tree · Enter Open
            </Text>
            <Text wrap="truncate-end">Code ↑↓ / PgUp / PgDn / Home / End</Text>
            <Text wrap="truncate-end">
              Editing G Task · Enter Send · Ctrl+J Newline
            </Text>
            <Text wrap="truncate-end">
              Proposal A Confirm Apply · R Reject · U Undo
            </Text>
            <Text wrap="truncate-end">
              Application Tab Focus · Ctrl+O Open project
            </Text>
            <Text wrap="truncate-end">
              General ? Help · Esc Close · Ctrl+C / :q Quit
            </Text>
          </>
        ) : state.modal === "open-project" ? (
          <>
            <Text bold={theme.bold} color={theme.accent}>
              OPEN PROJECT
            </Text>
            <Text>Enter a local project directory:</Text>
            <Text wrap="truncate-start">
              {terminalLabel(
                controller.redactCredentialForDisplay(projectInput),
              )}
              ▌
            </Text>
            <Text>[Enter] Open [Ctrl+U] Clear [Esc] Cancel</Text>
          </>
        ) : state.modal === "privacy" ? (
          <>
            <Text bold={theme.bold} color={theme.warning}>
              PRIVACY CONFIRMATION
            </Text>
            <Text>
              Selected source code and instruction will be sent to DeepSeek.
            </Text>
            <Text>Confirmed once per Ariel process. No automatic apply.</Text>
            <Text>[Enter] Continue [Esc] Cancel</Text>
          </>
        ) : state.modal === "apply" ? (
          <>
            <Text bold={theme.bold} color={theme.warning}>
              APPLY THIS EDIT?
            </Text>
            <Text>This will modify:</Text>
            <Text color={theme.accent} wrap="truncate-middle">
              {terminalLabel(state.file?.relativePath ?? "")}
            </Text>
            <Text>Source hash and exact match are checked again.</Text>
            <Text>Undo refuses later external changes.</Text>
            <Text>[Enter] Apply [Esc] Cancel</Text>
          </>
        ) : (
          <>
            <Text bold={theme.bold} color={theme.danger}>
              ARIEL ERROR
            </Text>
            <Text>
              {terminalText(
                state.error ?? "Ariel could not complete this operation.",
              )}
            </Text>
            {!state.providerConfigured ? (
              <Text>
                {'Set export DEEPSEEK_API_KEY="..." then restart Ariel.'}
              </Text>
            ) : null}
            <Text>[Enter / Esc] Close</Text>
          </>
        )}
      </Box>
    ) : null;

  return (
    <Box width={columns} height={rows} flexDirection="column" overflow="hidden">
      <Box
        height={3}
        borderStyle="double"
        borderColor={theme.borderStrong}
        paddingX={1}
        justifyContent="space-between"
      >
        <Box width={13} flexShrink={0}>
          <Text wrap="truncate-end" bold={theme.bold} color={theme.accent}>
            ✦ ARIEL ✦
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0} paddingX={1}>
          <Text wrap="truncate-middle" color={theme.muted}>
            {terminalLabel(state.projectRoot ?? "Opening project…")}
          </Text>
        </Box>
        <Box width={26} flexShrink={0}>
          <Text
            wrap="truncate-end"
            color={state.providerConfigured ? theme.success : theme.warning}
          >
            {state.providerConfigured
              ? "DEEPSEEK ● CONFIGURED"
              : "DEEPSEEK ○ NOT CONFIGURED"}
          </Text>
        </Box>
      </Box>
      <Box height={bodyHeight} flexDirection="row">
        {modal === null ? (
          <>
            {showTree ? (
              <Panel
                title="◇ PROJECT FILES"
                focused={state.focus === "tree"}
                width={treeWidth}
                height={bodyHeight}
                theme={theme}
              >
                {state.tree.length === 0 ? (
                  <Text color={theme.muted}>No visible files.</Text>
                ) : (
                  state.tree
                    .slice(selectedTreeStart, selectedTreeStart + contentHeight)
                    .map((entry, index) => {
                      const selected =
                        selectedTreeStart + index === state.selectedTreeIndex;
                      return (
                        <Text
                          key={entry.relativePath}
                          wrap="truncate-end"
                          color={selected ? theme.accent : theme.text}
                          bold={selected && theme.bold}
                        >
                          {selected ? "▸ " : "  "}
                          {" ".repeat(entry.depth * 2)}
                          {entry.type === "directory"
                            ? entry.expanded
                              ? "▾ "
                              : "▸ "
                            : "  "}
                          {terminalLabel(entry.name)}
                        </Text>
                      );
                    })
                )}
              </Panel>
            ) : null}
            {!narrow || !showTree ? (
              <Panel
                title={
                  state.proposal === null
                    ? "◇ CODE · READ ONLY"
                    : "◇ DIFF · PROPOSAL VALIDATED"
                }
                focused={state.focus === "code"}
                width={codeWidth}
                height={bodyHeight}
                theme={theme}
              >
                {state.file === null ? (
                  <Box flexDirection="column" paddingY={1}>
                    <Text color={theme.accent}>
                      Choose a source file to begin.
                    </Text>
                    <Text color={theme.muted}>
                      ↑ ↓ Navigate · Enter Open · G Task
                    </Text>
                    <Text color={theme.muted}>
                      Proposal first. Apply only after confirmation.
                    </Text>
                  </Box>
                ) : (
                  displayLines
                    .slice(safeScroll, safeScroll + contentHeight)
                    .map((line) => (
                      <Text
                        key={line.id}
                        wrap="truncate-end"
                        color={
                          line.kind === "removed"
                            ? theme.danger
                            : line.kind === "added"
                              ? theme.success
                              : theme.text
                        }
                      >
                        {clippedLine(line.text, codeWidth)}
                      </Text>
                    ))
                )}
              </Panel>
            ) : null}
          </>
        ) : (
          <Box
            width={columns}
            height={bodyHeight}
            justifyContent="center"
            alignItems="center"
          >
            {modal}
          </Box>
        )}
      </Box>
      <Box height={2} paddingX={1} flexDirection="column">
        <Text
          wrap="truncate-end"
          color={
            state.status === "error"
              ? theme.danger
              : state.busy
                ? theme.warning
                : theme.success
          }
        >
          ◆{" "}
          {state.status === "requesting-model"
            ? "THINKING"
            : state.status === "reading-file"
              ? "READING"
              : state.status.toUpperCase().replaceAll("-", " ")}{" "}
          {state.file === null
            ? ""
            : `· ${terminalLabel(state.file.relativePath)}`}
        </Text>
        <Text wrap="truncate-end" color={theme.muted}>
          {state.proposal !== null
            ? "Unique exact-match proposal. Not a semantic or syntax guarantee. No files were modified."
            : state.latestUndo !== null
              ? `Undo available · ${terminalLabel(state.latestUndo.relativePath)}`
              : "One source · one instruction · one model attempt · no automatic writes"}
        </Text>
      </Box>
      <Box
        height={4}
        borderStyle={state.focus === "task" ? "double" : "round"}
        borderColor={state.focus === "task" ? theme.borderStrong : theme.border}
        paddingX={1}
        flexDirection="column"
      >
        {command !== null ? (
          <Text color={theme.accent}>{terminalText(command)}▌</Text>
        ) : (
          <>
            <Text
              wrap="truncate-end"
              color={state.focus === "task" ? theme.text : theme.muted}
            >
              ❯ {taskLines[0]}
            </Text>
            {taskLines.length > 1 ? (
              <Text
                wrap="truncate-end"
                color={state.focus === "task" ? theme.text : theme.muted}
              >
                {" "}
                {taskLines[1]}
              </Text>
            ) : null}
          </>
        )}
      </Box>
      <Text wrap="truncate-end" color={theme.muted}>
        {state.modal !== null
          ? "Esc Cancel / Close · Enter Confirm · Ctrl+C Quit"
          : state.focus === "task"
            ? "Enter Generate · Ctrl+J New line · Esc Back · Tab Focus · Ctrl+C Quit"
            : "↑↓ Navigate · Enter Open · Tab Focus · G Task · A Apply · R Reject · U Undo · ? Help · Ctrl+O Open · :q Quit"}
      </Text>
    </Box>
  );
}
