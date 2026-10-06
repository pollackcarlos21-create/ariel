# Ariel

English | [简体中文](README.zh-CN.md)

Ariel is an open-source coding agent project built from first principles. Its v0.2.1 terminal-native interface lets you open a project, browse source files, describe a change, review a single-file proposal, and explicitly Apply or Reject it. After Apply, you can Undo within the current process. Model requests use DeepSeek by default or an explicitly configured OpenAI-compatible Chat Completions endpoint.

Generating a proposal never modifies your files. The TUI writes only after explicit Apply confirmation or an explicit Undo action. The non-interactive `ariel edit` command remains proposal-only. Ariel does not execute shell commands or autonomously modify your repository.

## Prerequisites

Use Bun 1.4.2 and Git. Run the following commands from the Ariel repository root after cloning. No global installation, npm publishing, Electron, or Tauri is required.

## Install

```sh
bun install --frozen-lockfile
```

## Configure

DeepSeek remains the default when `ARIEL_PROVIDER` is unset. Set your own API key; the value below is a placeholder, not a usable credential:

```sh
export DEEPSEEK_API_KEY="your-own-deepseek-api-key"
```

You may explicitly select the same provider with `export ARIEL_PROVIDER="deepseek"`. This path uses `deepseek-flash` with thinking disabled.

To use an OpenAI-compatible provider, supply its API base URL and exact model identifier:

```sh
export ARIEL_PROVIDER="openai-compatible"
export OPENAI_COMPATIBLE_BASE_URL="https://api.example.com/v1"
export OPENAI_COMPATIBLE_MODEL="example-model"
export OPENAI_COMPATIBLE_API_KEY="your-own-compatible-api-key"

bun run ariel
```

These endpoint, model, and key values are placeholders; replace them with your provider's values. The API key is optional for compatible endpoints that do not require authentication. In that case, omit or unset `OPENAI_COMPATIBLE_API_KEY`; Ariel sends no `Authorization` header for an absent, empty, or whitespace-only compatible key.

`OPENAI_COMPATIBLE_BASE_URL` must include the API prefix required by the provider. For example, `https://api.example.com/v1` is called at `https://api.example.com/v1/chat/completions`. Trailing slashes are removed; Ariel does not guess `/v1`, discard your path, or try another endpoint. HTTPS is required except for local HTTP at `localhost`, `127.0.0.1`, or `[::1]`. URLs containing embedded credentials, a query, or a fragment are rejected. Ariel does not verify that arbitrary providers are fully OpenAI-compatible: the endpoint must support non-streaming, text-only Chat Completions responses.

Never put a real key in Git, source code, test fixtures, or logs. Ariel uses the launching process's environment, does not automatically load `.env`, and does not offer an `--api-key` argument or persist credentials. Unknown provider names and incomplete or invalid configuration fail safely; there is no silent fallback. CLI edit exits with code 1. The TUI still opens and lets you browse files; Generate explains the configuration error without making a network request. Change the environment and restart Ariel to switch providers.

## Ariel Interactive TUI

Install, configure, build, and start:

```sh
bun install --frozen-lockfile
export DEEPSEEK_API_KEY="your-own-deepseek-api-key"
bun run build
bun run ariel
```

This opens a full-screen terminal interface using the current working directory as the project. To select a different project:

```sh
bun run ariel .
bun run ariel /path/to/project
```

An interactive terminal is required, with a minimum size of `60 × 20`. Wide terminals show file-tree and code panes side by side; below 90 columns, the interface switches to a single pane selected by focus. Smaller terminals show a resize notice. Restrained Unicode borders and ornaments provide a retro terminal layout. `NO_COLOR` disables color; text and `-`/`+` markers remain readable.

```text
╔══════════════════════════════════════════════════════╗
║  ✦ ARIEL ✦  project         DEEPSEEK ● CONFIGURED    ║
╠═══════════════╦══════════════════════════════════════╣
║ FILE TREE     ║ CODE / DIFF                          ║
║ ▾ src         ║   1 function loadData() {            ║
║   example.ts  ║   2   return data;                   ║
╠═══════════════╩══════════════════════════════════════╣
║ IDLE       Tab focus · G task · ? help · Ctrl+C quit ║
║ ❯ Make this function async                          ║
╚══════════════════════════════════════════════════════╝
```

This is a layout illustration; actual content and dimensions depend on the terminal, project, and current operation.

1. The default project is the current working directory. Press Ctrl+O to enter another local project directory.
2. Navigate the file tree with arrow keys, expand or collapse directories, and press Enter to open a UTF-8 source file. Directories load lazily; generated directories such as `.git`, `node_modules`, `dist`, `build`, `coverage`, and `.cache` are ignored.
3. Press G to focus the task input, enter an instruction, and press Enter to Generate. Before the first Generate, confirm that the selected source will be sent to the configured model provider. The confirmation names the provider and occurs once per process.
4. Review Before/After and `PROPOSAL VALIDATED`. Press R to Reject and return to the source without modifying it.
5. Press A to open the Apply confirmation. Enter confirms the write; Esc cancels. If the file has changed since Generate, Ariel refuses the stale proposal and requires a new Generate.
6. Press U to Undo. If another process has changed the file after Apply, Ariel refuses to overwrite that content.

| Key | Action |
| --- | --- |
| ↑ / ↓, ← / → | Navigate, collapse, or expand the file tree |
| Enter / Esc | Open or confirm / go back or cancel |
| Tab | Switch focus |
| Ctrl+O | Open a project |
| G | Focus task / Generate |
| A / R / U | Confirm Apply / Reject / guarded Undo |
| ? | Open the keyboard reference |
| Ctrl+C / `:q` | Quit and restore the terminal |

Use Ctrl+J for a newline in task input and Enter to Generate; Ariel does not depend on terminals distinguishing Shift+Enter. Letter shortcuts apply in navigation focus, so typing an instruction does not accidentally trigger Apply or Reject. Contextual shortcuts remain visible.

The complete selected source and your instruction are sent to the configured endpoint. Choose only text you are willing to share with that provider. The executable reads configuration from its startup environment; do not enter or store a key in the TUI. The header identifies `DEEPSEEK` or `OPENAI-COMPAT` and its local configuration state; it never displays credentials. DeepSeek uses `deepseek-flash`; the compatible path uses `OPENAI_COMPATIBLE_MODEL`. Both code-edit workflows have an explicit host timeout of `120 seconds`.

`CONFIGURED` means the local configuration is valid; it does not verify authentication, account balance, connectivity, or provider compatibility. On failure, the TUI displays a safe HTTP status or a fixed network, timeout, or response-format explanation. It never displays the provider response body or retries automatically. Close an error with Enter or Esc, then enter another task. After reviewing a proposal, Reject with R and use G to enter the next task; Apply, Undo, and closing Help also leave the interface available for further interaction.

Each task makes one model attempt, with no retry, repair, or fallback. Proposals and Undo records live only in the current TUI process; quitting or switching projects does not persist history. The read-only code viewer shows line numbers and clips or scrolls its viewport. Tabs are displayed as four spaces without rewriting the source or the applied text.

Quitting immediately restores the terminal. If an explicitly confirmed Apply or Undo is already running, Ariel waits for that write and its cleanup to finish before the process exits.

The project workflow supports single-link regular UTF-8 text files of at most `5 MiB` inside the selected root. It rejects traversal, absolute file-path escapes, project symlinks, hardlinks, and NUL/binary content. It does not run user code, tests, shell commands, or Git operations. Apply and Undo use hash checks and atomic replacement; they do not provide cross-process locking against hostile processes with the same permissions, crash recovery, or preservation of ACLs and extended attributes. Use this workflow only on local projects you intend to edit.

## CLI Mode

Specify an existing source file and a natural-language instruction:

```sh
bun run ariel edit src/example.ts "Make this function async"
```

Replace `src/example.ts` with your own file path. For example, a file that exists in this repository can be used as follows:

```sh
bun run ariel edit packages/core/src/index.ts "Add a short comment above getApplicationStatus"
```

`edit` accepts exactly two positional arguments: file and instruction. Absolute paths are supported; relative paths resolve against the current working directory. Input must be a non-empty regular file containing valid UTF-8; whitespace-only text is accepted. Ariel reads only this file and does not search the repository, recurse into directories, or run user code or tests.

The command uses the same startup `ARIEL_PROVIDER` configuration as the TUI. With no provider selection it continues to use `deepseek-flash`, thinking disabled; with `openai-compatible` it uses the configured endpoint and model. Both paths use non-streaming output. Local-host explicitly supplies a `120000ms` total HTTP timeout; neither provider has a hidden default timeout. There is no automatic retry, repair, or fallback. The complete file and instruction are sent to the configured endpoint.

A successful command exits with code 0 and displays a patch-like preview:

```text
Ariel Code Edit Proposal

File: src/example.ts

--- before
+++ after
@@ proposal @@
- function loadData() {
+ async function loadData() {

Proposal validated.
No files were modified.
```

Validation checks that the model returned a JSON proposal with exactly `oldText` and `newText`, that `oldText` has one exact-match position in the original source, and that the replacement changes the text. Empty `newText` means deletion. Validation does not guarantee that the instruction was understood correctly, the code is semantically or syntactically correct, a bug is fixed, or tests pass. The CLI does not apply the change.

The preview preserves proposal newlines and tabs, escapes other `Cc` control characters, escapes newlines and tabs in file labels, and hides text matching the current credential. It is not a directly applicable unified patch. Review the proposal before deciding how to edit your file.

Argument, configuration, file-read, task, model, and proposal failures exit with code 1 and a short, safe error. Unexpected errors are handled by the executable boundary without exposing a stack trace.

## Other CLI Paths

```sh
bun run ariel --help
bun run ariel --version
bun run ariel
bun run ariel model-demo "hello"
```

- `--help` displays usage, commands, and options.
- `--version` prints the version from the CLI package manifest.
- No arguments or one project path opens the TUI; non-interactive terminals fail safely without starting a background process.
- `model-demo "<text>"` is an offline in-memory simulation. It accepts exactly one non-whitespace text argument and uses neither a real model nor an API key.
- Unknown arguments print an error and a help hint to stderr, then exit with code 1.

`bun run ariel` uses the root launcher and is the current TUI entrypoint. `./node_modules/.bin/ariel` still points to the legacy CLI `src/bin.ts`, supporting non-interactive status, help, version, edit, and model-demo; its no-argument invocation does not open the TUI. All workspaces remain private. Global installation and npm packaging are not provided yet.

## Architecture and Development

Core owns `proposeCodeEdit(task, modelPort)`, task policy, and proposal acceptance. Local-host owns file access, the project-root boundary, configured provider composition, and explicit Apply/Undo. CLI and TUI own presentation; providers own wire-protocol mapping. Core has no knowledge of paths, filesystem, environment variables, credentials, terminals, or concrete providers. `getApplicationStatus()` returns `{ agentExecution: "single-source-code-edit-proposal" }`.

Automatic file mutation, autonomous multi-file tasks, autonomous repository exploration, shell execution, automatic tests or Git operations, Tools, AgentRuntime, Sessions, streaming, retry/fallback, MCP/LSP, IDE integration, remote servers, accounts, cloud sync, telemetry, and desktop wrappers are not implemented.

The engineering documents below are currently maintained in Chinese:

- [Development and validation](docs/DEVELOPMENT.md)
- [Architecture and boundaries](docs/ARCHITECTURE.md)
- [Roadmap and acceptance goals](docs/ROADMAP.md)
- [Architecture decision index](docs/DECISIONS.md)
- [Repository instructions](AGENTS.md)

The license decision is pending Chief Architect approval; this repository does not contain a LICENSE file.
