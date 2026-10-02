import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const launcher = join(root, "ariel.ts");
const appModule = join(root, "apps/tui/src/App.tsx");
const SOURCE = "function loadData() { return 1; }\n";
const AFTER = "async function loadData() { return 1; }\n";
const paths: string[] = [];
const children: Array<{ kill(): void; terminal: Bun.Terminal }> = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
    child.terminal.close();
  }
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`PTY fixture timed out: ${label}`);
    await Bun.sleep(10);
  }
}

async function fixture(
  mode: "normal" | "render-error" | "apply" | "undo" | "write-error",
) {
  const directory = await mkdtemp(join(tmpdir(), "ariel-tui-lifecycle-"));
  paths.push(directory);
  const project = join(directory, "project");
  await Bun.write(join(project, "source.ts"), SOURCE);
  const release = join(directory, "release-write");
  const preload = join(directory, "preload.ts");
  const writes = mode === "apply" || mode === "undo" || mode === "write-error";
  const script = `
import { mock, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
const originalExit = process.exit.bind(process);
process.exit = (code) => {
  process.stdout.write("FIXTURE_INPUT_RESTORED=" + !process.stdin.isRaw + "\\n");
  originalExit(code);
};
let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("data:") || url.startsWith("file:")) return originalFetch(input, init);
  if (url !== "https://api.deepseek.com/chat/completions") throw new Error("Unexpected network in offline PTY fixture");
  fetchCalls += 1;
  process.stdout.write("FIXTURE_FETCH_CALLS=" + fetchCalls + "\\n");
  return new Response(JSON.stringify({
    id:"offline-fixture",object:"chat.completion",created:0,model:"offline-fixture-model",system_fingerprint:"offline-fixture",
    choices:[{index:0,logprobs:null,finish_reason:"stop",message:{role:"assistant",content:JSON.stringify({oldText:${JSON.stringify(SOURCE)},newText:${JSON.stringify(AFTER)}})}}]
  }));
};
${mode === "render-error" ? `mock.module(${JSON.stringify(appModule)}, () => ({ App() { throw new Error("FAKE_PRIVATE_RENDER_STACK_BODY"); } }));` : ""}
${
  writes
    ? `
const originalRename = fs.rename;
let renameCalls = 0;
spyOn(fs, "rename").mockImplementation(async (from, to) => {
  renameCalls += 1;
  if (renameCalls === ${mode === "undo" ? 2 : 1}) {
    process.stdout.write("FIXTURE_RENAME_STARTED\\n");
    const deadline = Date.now() + 10000;
    while (true) {
      try { await fs.access(${JSON.stringify(release)}); break; }
      catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      }
      if (Date.now() > deadline) throw new Error("Fixture write release not received");
      await Bun.sleep(10);
    }
    ${mode === "write-error" ? `throw new Error("FAKE_PRIVATE_WRITE_STACK_BODY");` : ""}
  }
  await originalRename(from, to);
});
`
    : ""
}
`;
  await writeFile(preload, script);
  let output = "";
  const decoder = new TextDecoder();
  const terminal = new Bun.Terminal({
    cols: 100,
    rows: 24,
    name: "xterm-256color",
    data(_terminal, chunk) {
      output += decoder.decode(chunk, { stream: true });
    },
  });
  const child = Bun.spawn(
    [process.execPath, "--preload", preload, launcher, project],
    {
      cwd: root,
      env: {
        TERM: "xterm-256color",
        NO_COLOR: "1",
        ...(writes
          ? { DEEPSEEK_API_KEY: "offline-lifecycle-placeholder" }
          : {}),
      },
      terminal,
    },
  );
  children.push({ kill: () => child.kill(), terminal });
  let exited = false;
  const completion = child.exited.then((code) => {
    exited = true;
    return code;
  });
  const contains = (text: string) => output.includes(text);
  async function wait(text: string): Promise<void> {
    try {
      await waitFor(() => contains(text), text);
    } catch {
      throw new Error(`PTY fixture missing ${text}: ${output.slice(-2000)}`);
    }
  }
  async function exit(): Promise<number> {
    await waitFor(() => exited, "process exited");
    return completion;
  }
  function resize(cols: number, rows: number): void {
    terminal.resize(cols, rows);
    child.kill("SIGWINCH");
  }
  return {
    project,
    release,
    terminal,
    resize,
    wait,
    exit,
    contains,
    output: () => output,
    exited: () => exited,
  };
}

function expectRestoration(output: string): void {
  expect(output).toContain("\x1b[?1049h");
  expect(output).toContain("\x1b[?1049l");
  expect(output).toContain("\x1b[?25h");
  expect(output).toContain("FIXTURE_INPUT_RESTORED=true");
  expect(output).not.toContain("offline-lifecycle-placeholder");
  expect(output).not.toContain("FAKE_PRIVATE");
  expect(output).not.toMatch(/\n\s+at\s|\.tsx?:\d/);
}

async function generate(
  ui: Awaited<ReturnType<typeof fixture>>,
): Promise<void> {
  await ui.wait("source.ts");
  ui.terminal.write("\r");
  await ui.wait("function loadData()");
  ui.terminal.write("make this async");
  await ui.wait("make this async");
  ui.terminal.write("\r");
  await ui.wait("PRIVACY CONFIRMATION");
  expect(ui.contains("FIXTURE_FETCH_CALLS=")).toBe(false);
  ui.terminal.write("\r");
  await ui.wait("PROPOSAL VALIDATED");
  expect(ui.contains("FIXTURE_FETCH_CALLS=1")).toBe(true);
  expect(ui.contains("FIXTURE_FETCH_CALLS=2")).toBe(false);
}

describe("real PTY terminal lifecycle", () => {
  test.each(["\x03", ":q\r"])(
    "normal quit %j restores alternate screen, cursor and input",
    async (quit) => {
      const ui = await fixture("normal");
      await ui.wait("PROJECT FILES");
      expect(ui.contains("DEEPSEEK ○ NOT CONFIGURED")).toBe(true);
      ui.resize(40, 12);
      await ui.wait("Terminal is too small.");
      ui.resize(100, 24);
      await waitFor(
        () =>
          ui.output().lastIndexOf("PROJECT FILES") >
          ui.output().lastIndexOf("Terminal is too small."),
        "resized layout",
      );
      ui.terminal.write(quit);
      expect(await ui.exit()).toBe(0);
      expectRestoration(ui.output());
      expect(ui.contains("FIXTURE_FETCH_CALLS=")).toBe(false);
    },
    30_000,
  );

  test("unexpected renderer error has only a generic error and restores terminal", async () => {
    const ui = await fixture("render-error");
    expect(await ui.exit()).toBe(1);
    expect(ui.output()).toContain("错误：Ariel 遇到意外错误。");
    expectRestoration(ui.output());
  }, 30_000);

  test.each(["apply", "undo", "write-error"] as const)(
    "quit during confirmed %s restores screen immediately and drains the authorized write",
    async (mode) => {
      const ui = await fixture(mode);
      await generate(ui);
      ui.terminal.write("a");
      await ui.wait("APPLY THIS EDIT?");
      ui.terminal.write("\r");
      if (mode === "undo") {
        await ui.wait("◆ APPLIED");
        ui.terminal.write("u");
      }
      await ui.wait("FIXTURE_RENAME_STARTED");
      ui.terminal.write("\x03");
      await ui.wait("\x1b[?1049l");
      expect(ui.exited()).toBe(false);
      expect(await readFile(join(ui.project, "source.ts"), "utf8")).toBe(
        mode === "undo" ? AFTER : SOURCE,
      );
      await writeFile(ui.release, "release");
      expect(await ui.exit()).toBe(mode === "write-error" ? 1 : 0);
      expect(await readFile(join(ui.project, "source.ts"), "utf8")).toBe(
        mode === "apply" ? AFTER : SOURCE,
      );
      expect(await readdir(ui.project)).toEqual(["source.ts"]);
      expectRestoration(ui.output());
      if (mode === "write-error")
        expect(ui.output()).toContain("错误：Ariel 遇到意外错误。");
    },
    30_000,
  );
});
