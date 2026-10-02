import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render } from "ink-testing-library";
import { App } from "../apps/tui/src/App";
import {
  createTuiController,
  type TuiController,
} from "../apps/tui/src/controller";
import { createTheme, terminalText } from "../apps/tui/src/theme";

const temporary: string[] = [];
const controllers: TuiController[] = [];
afterEach(async () => {
  cleanup();
  for (const controller of controllers.splice(0)) controller.dispose();
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(
  options: {
    readonly key?: string;
    readonly source?: string;
    readonly filename?: string;
    readonly failure?: "model-failure" | "invalid-proposal";
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "ariel-tui-render-"));
  temporary.push(root);
  const source =
    options.source ?? "function loadData() {\n\treturn '源码';\n}\n";
  await writeFile(join(root, options.filename ?? "example.ts"), source);
  let calls = 0;
  const controller = createTuiController({
    initialProjectPath: root,
    ...(options.key === undefined ? {} : { apiKey: options.key }),
    propose: async () => {
      calls += 1;
      return options.failure === undefined
        ? {
            status: "completed",
            proposal: {
              oldText: source,
              newText: "async function loadData() {\n\treturn '源码';\n}\n",
            },
          }
        : {
            status: "failed",
            error: { kind: options.failure, message: "unsafe provider body" },
          };
    },
  });
  controllers.push(controller);
  await controller.start();
  let quits = 0;
  let fatals = 0;
  const view = render(
    <App
      controller={controller}
      noColor
      onQuit={() => {
        quits += 1;
      }}
      onFatal={() => {
        fatals += 1;
      }}
    />,
  );
  await Bun.sleep(35);
  async function press(input: string): Promise<void> {
    view.stdin.write(input);
    await Bun.sleep(40);
  }
  return {
    root,
    source,
    controller,
    view,
    press,
    calls: () => calls,
    quits: () => quits,
    fatals: () => fatals,
  };
}

describe("terminal TUI presentation and keyboard interaction", () => {
  test("startup shows project, safe provider status, tree and contextual bindings", async () => {
    const ui = await fixture();
    const frame = ui.view.lastFrame() ?? "";
    expect(frame).toContain("ARIEL");
    expect(frame).toContain(ui.root.split("/").at(-1) ?? "");
    expect(frame).toContain("DEEPSEEK ○ NOT CONFIGURED");
    expect(frame).toContain("example.ts");
    expect(frame).toContain("Ctrl+O");
    expect(frame).not.toContain("http://");
  });

  test("Enter opens exact source with line numbers, Unicode and visible tabs", async () => {
    const ui = await fixture();
    await ui.press("\r");
    expect(ui.controller.getState().file?.sourceText).toBe(ui.source);
    const frame = ui.view.lastFrame() ?? "";
    expect(frame).toContain("1 │ function loadData()");
    expect(frame).toContain("    return '源码'");
    expect(ui.controller.getState().focus).toBe("task");
  });

  test("newline/tab filenames stay on one display row without changing the host path", async () => {
    const filename = "line\n\tname.ts";
    const ui = await fixture({ filename });
    expect(ui.view.lastFrame()).toContain("line\\n\\tname.ts");
    expect(ui.view.lastFrame()).not.toContain("line\n\tname.ts");
    await ui.press("\r");
    expect(ui.controller.getState().file?.relativePath).toBe(filename);
    expect(ui.controller.getState().file?.sourceText).toBe(ui.source);
    expect(ui.view.lastFrame()).toContain("line\\n\\tname.ts");
  });

  test("task input, Ctrl+J multiline, Unicode cursor and backspace are preserved", async () => {
    const ui = await fixture();
    await ui.press("\r");
    await ui.press("改成 async🙂");
    await ui.press("\x7f");
    await ui.press("\n");
    await ui.press("保留源码");
    expect(ui.controller.getState().instruction).toBe("改成 async\n保留源码");
    expect(ui.view.lastFrame()).toContain("保留源码");
  });

  test("missing key shows safe error and does not attempt a model operation", async () => {
    const ui = await fixture();
    await ui.press("\r");
    await ui.press("make async");
    await ui.press("\r");
    expect(ui.controller.getState().modal).toBe("error");
    expect(ui.view.lastFrame()).toContain("ARIEL ERROR");
    expect(ui.view.lastFrame()).toContain("DEEPSEEK_API_KEY");
    expect(ui.calls()).toBe(0);
  });

  test("privacy modal precedes the only attempt; validated diff does not apply until Enter confirms", async () => {
    const ui = await fixture({ key: "offline-placeholder" });
    await ui.press("\r");
    await ui.press("make async");
    await ui.press("\r");
    expect(ui.view.lastFrame()).toContain("PRIVACY CONFIRMATION");
    expect(ui.calls()).toBe(0);
    await ui.press("\r");
    expect(ui.calls()).toBe(1);
    expect(ui.view.lastFrame()).toContain("PROPOSAL VALIDATED");
    expect(ui.view.lastFrame()).toContain("- function loadData()");
    expect(ui.view.lastFrame()).toContain("+ async function loadData()");
    expect(await readFile(join(ui.root, "example.ts"), "utf8")).toBe(ui.source);
    await ui.press("a");
    expect(ui.view.lastFrame()).toContain("APPLY THIS EDIT?");
    expect(await readFile(join(ui.root, "example.ts"), "utf8")).toBe(ui.source);
    await ui.press("\r");
    expect(ui.controller.getState().status).toBe("applied");
    expect(await readFile(join(ui.root, "example.ts"), "utf8")).toStartWith(
      "async function",
    );
    await ui.press("u");
    expect(ui.controller.getState().status).toBe("undo-complete");
    expect(await readFile(join(ui.root, "example.ts"), "utf8")).toBe(ui.source);
  });

  test("Reject discards the current proposal without writing", async () => {
    const ui = await fixture({ key: "offline-placeholder" });
    await ui.press("\r");
    await ui.press("make async");
    await ui.press("\r");
    await ui.press("\r");
    await ui.press("r");
    expect(ui.controller.getState().proposal).toBeNull();
    expect(ui.view.lastFrame()).toContain("CODE · READ ONLY");
    expect(await readFile(join(ui.root, "example.ts"), "utf8")).toBe(ui.source);
  });

  for (const failure of ["model-failure", "invalid-proposal"] as const) {
    test(`${failure} is presented without raw provider text`, async () => {
      const ui = await fixture({ key: "offline-placeholder", failure });
      await ui.press("\r");
      await ui.press("make async");
      await ui.press("\r");
      await ui.press("\r");
      expect(ui.view.lastFrame()).toContain("ARIEL ERROR");
      expect(ui.view.lastFrame()).not.toContain("unsafe provider body");
      expect(ui.calls()).toBe(1);
    });
  }

  test("Help, Esc and Tab maintain focus and show the keyboard reference", async () => {
    const ui = await fixture();
    await ui.press("?");
    expect(ui.view.lastFrame()).toContain("Ariel Keyboard Reference");
    await ui.press("\x1b");
    expect(ui.controller.getState().modal).toBeNull();
    await ui.press("\t");
    expect(ui.controller.getState().focus).toBe("code");
    await ui.press("g");
    expect(ui.controller.getState().focus).toBe("task");
  });

  test("Ctrl+O opens project input; Esc cancels without changing project", async () => {
    const ui = await fixture();
    await ui.press("\x0f");
    expect(ui.view.lastFrame()).toContain("OPEN PROJECT");
    await ui.press("\x15");
    expect(ui.view.lastFrame()).toContain("║  ▌");
    await ui.press("\x1b");
    expect(ui.controller.getState().projectRoot).toBe(await realpath(ui.root));
  });

  test("project path draft hides the configured credential before Enter without changing the original input", async () => {
    const key = "FAKE_MODAL_CREDENTIAL";
    const ui = await fixture({ key });
    await ui.press("\x0f");
    await ui.press("\x15");
    await ui.press(`${key}/folder/${key}`);
    expect(ui.view.lastFrame()).toContain(
      "[credential hidden]/folder/[credential hidden]",
    );
    expect(ui.view.lastFrame()).not.toContain(key);
    expect(ui.calls()).toBe(0);
    await ui.press("\r");
    expect(ui.controller.getState().modal).toBe("error");
    expect(ui.controller.getState().error).toContain("credential");
    expect(ui.controller.getState().projectRoot).toBe(await realpath(ui.root));
    expect(ui.view.lastFrame()).not.toContain(key);
    expect(ui.calls()).toBe(0);
  });

  test("resize renders narrow single pane and a safe minimum-size notice", async () => {
    const ui = await fixture();
    Object.defineProperty(ui.view.stdout, "columns", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(ui.view.stdout, "rows", {
      configurable: true,
      value: 24,
    });
    ui.view.stdout.emit("resize");
    await Bun.sleep(40);
    expect(ui.view.lastFrame()).toContain("PROJECT FILES");
    expect(ui.view.lastFrame()).not.toContain("CODE · READ ONLY");
    await ui.press("\t");
    expect(ui.view.lastFrame()).toContain("CODE · READ ONLY");
    Object.defineProperty(ui.view.stdout, "columns", {
      configurable: true,
      value: 60,
    });
    Object.defineProperty(ui.view.stdout, "rows", {
      configurable: true,
      value: 20,
    });
    ui.view.stdout.emit("resize");
    await Bun.sleep(40);
    await ui.press("?");
    expect(ui.view.lastFrame()).toContain("Ariel Keyboard Reference");
    expect(ui.view.lastFrame()).toContain("General ? Help");
    expect(ui.view.lastFrame()).toContain("Esc Cancel / Close");
    await ui.press("\x1b");
    Object.defineProperty(ui.view.stdout, "columns", {
      configurable: true,
      value: 40,
    });
    Object.defineProperty(ui.view.stdout, "rows", {
      configurable: true,
      value: 12,
    });
    ui.view.stdout.emit("resize");
    await Bun.sleep(40);
    expect(ui.view.lastFrame()).toContain("Terminal is too small.");
    expect(ui.view.lastFrame()).toContain("60 × 20");
  });

  test("code viewer windows a large file and End/Home scroll without rendering all rows", async () => {
    const source = Array.from(
      { length: 1000 },
      (_, index) => `source line ${index + 1}`,
    ).join("\n");
    const ui = await fixture({ source });
    await ui.press("\r");
    expect(ui.view.lastFrame()).toContain("1 │ source line 1");
    expect(ui.view.lastFrame()).not.toContain("1000 │ source line 1000");
    expect((ui.view.lastFrame() ?? "").split("\n").length).toBeLessThanOrEqual(
      25,
    );
    await ui.press("\x1b");
    await ui.press("\t");
    await ui.press("\x1b[F");
    expect(ui.view.lastFrame()).toContain("1000 │ source line 1000");
    expect(ui.view.lastFrame()).not.toContain("1 │ source line 1");
    await ui.press("\x1b[H");
    expect(ui.view.lastFrame()).toContain("1 │ source line 1");
    expect(ui.controller.getState().file?.sourceText).toBe(source);
  });

  test("Ctrl+C and :q delegate quit while normal instruction punctuation remains input", async () => {
    const ui = await fixture();
    await ui.press(":");
    await ui.press("q");
    await ui.press("\r");
    expect(ui.quits()).toBe(1);
    await ui.press("\x03");
    expect(ui.quits()).toBe(2);
    await ui.press(":q");
    await ui.press("\r");
    expect(ui.quits()).toBe(3);
    expect(ui.fatals()).toBe(0);
  });

  test("NO_COLOR removes color tokens and control bytes are safely displayed", async () => {
    const ui = await fixture({ source: "\x1b[31mhidden\x1b[0m\n" });
    await ui.press("\r");
    const frame = ui.view.lastFrame() ?? "";
    expect(frame).not.toContain("\x1b[");
    expect(frame).toContain("\\u001b[31mhidden");
    expect(createTheme(true).accent).toBeUndefined();
    expect(terminalText("plain\x1b\x07\u202e")).toBe(
      "plain\\u001b\\u0007\\u202e",
    );
  });
});
