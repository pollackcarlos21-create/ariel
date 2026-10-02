import process from "node:process";
import { render } from "ink";
import { Component, createElement, type ReactNode } from "react";
import { App } from "./App";
import { createTuiController } from "./controller";

export interface TuiLaunchOptions {
  readonly projectPath: string;
  readonly apiKey?: string;
  readonly noColor?: boolean;
}

class TerminalErrorBoundary extends Component<
  { readonly children?: ReactNode; readonly onFatal: () => void },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onFatal();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Process presentation boundary; credentials are supplied by the executable. */
export async function launchTui(options: TuiLaunchOptions): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      "错误：Ariel 交互界面需要 terminal TTY。非交互调用请使用 --help、--version 或 edit。\n",
    );
    return 1;
  }

  const controller = createTuiController({
    initialProjectPath: options.projectPath,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
  });
  const originalRawMode = process.stdin.isRaw;
  let renderer: ReturnType<typeof render> | undefined;
  let exitCode = 0;
  let finished = false;
  let writeDrain: Promise<void> | undefined;
  let resolveWriteDrain: (() => void) | undefined;

  function finish(code: number): void {
    if (finished) {
      if (code !== 0) exitCode = code;
      return;
    }
    // A confirmed write must finish its staging/cleanup before executable
    // shutdown. Network operations have no equivalent filesystem commit.
    const state = controller.getState();
    if (state.busy && state.status === "applying") {
      writeDrain = new Promise<void>((resolve) => {
        resolveWriteDrain = resolve;
      });
    } else {
      controller.dispose();
    }
    finished = true;
    exitCode = code;
    renderer?.unmount();
  }

  const quit = (): void => finish(0);
  const fatal = (): void => finish(1);
  const unsubscribe = controller.subscribe(() => {
    if (resolveWriteDrain !== undefined && !controller.getState().busy) {
      resolveWriteDrain();
      resolveWriteDrain = undefined;
    }
  });
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  process.on("uncaughtException", fatal);
  process.on("unhandledRejection", fatal);

  try {
    renderer = render(
      createElement(
        TerminalErrorBoundary,
        { onFatal: fatal },
        createElement(App, {
          controller,
          noColor: options.noColor ?? false,
          onQuit: quit,
          onFatal: fatal,
        }),
      ),
      {
        alternateScreen: true,
        interactive: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    if (finished) renderer.unmount();
    else void controller.start().catch(fatal);
    await renderer.waitUntilExit();
  } catch {
    exitCode = 1;
  } finally {
    // Restore the screen immediately on quit; a write already explicitly
    // confirmed by the user drains before the executable terminates.
    renderer?.cleanup();
    if (writeDrain !== undefined) {
      await writeDrain;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    controller.dispose();
    unsubscribe();
    process.removeListener("SIGINT", quit);
    process.removeListener("SIGTERM", quit);
    process.removeListener("uncaughtException", fatal);
    process.removeListener("unhandledRejection", fatal);
    // Ink restores alternate-screen, cursor and paste modes. Restore the
    // original input mode too, including setup failures before a full mount.
    process.stdin.setRawMode(originalRawMode);
    process.stdin.pause();
  }
  if (exitCode !== 0) process.stderr.write("错误：Ariel 遇到意外错误。\n");
  return exitCode;
}
