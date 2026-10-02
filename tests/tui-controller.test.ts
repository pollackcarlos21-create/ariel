import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { realpathSync } from "node:fs";
import * as fs from "node:fs/promises";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ModelPort,
  type ModelRequest,
  type ModelResult,
  proposeCodeEdit,
} from "@ariel/core";
import {
  createTuiController,
  type TuiController,
} from "../apps/tui/src/controller";

const FAKE_KEY = "fixture-only-tui-not-a-real-api-key";
const SOURCE = "\uFEFF// 中文\r\nfunction loadData() {\r\n\treturn 1;\r\n}\r\n";
const EDIT = {
  oldText: "function loadData()",
  newText: "async function loadData()",
};
const INSTRUCTION = " \t把这个函数改成 async\n ";
const expectedCompletion = (): ModelResult => ({
  status: "completed",
  text: JSON.stringify(EDIT),
});

describe.serial(
  "TUI controller: temporary project, real core policy, offline model",
  () => {
    let projectPath: string;
    let controllers: TuiController[];

    beforeEach(async () => {
      projectPath = await mkdtemp(join(tmpdir(), "ariel-tui-controller-"));
      controllers = [];
      await mkdir(join(projectPath, "src"));
      await writeFile(join(projectPath, "src", "example.ts"), SOURCE);
      await writeFile(join(projectPath, "readme.txt"), "hello\n");
    });

    afterEach(async () => {
      for (const controller of controllers) controller.dispose();
      await rm(projectPath, { recursive: true, force: true });
    });

    function controllerWith(
      model: ModelPort["generateText"] = async () => expectedCompletion(),
      apiKey: string | undefined | null = FAKE_KEY,
    ) {
      const requests: ModelRequest[] = [];
      const controller = createTuiController({
        initialProjectPath: projectPath,
        ...(typeof apiKey === "string" ? { apiKey } : {}),
        propose(instruction, sourceText) {
          return proposeCodeEdit(
            { instruction, sourceText },
            {
              generateText(request) {
                requests.push(request);
                return model(request);
              },
            },
          );
        },
      });
      controllers.push(controller);
      return { controller, requests };
    }

    async function ready(controller: TuiController) {
      await controller.start();
      await controller.selectFile("src/example.ts");
      controller.setInstruction(INSTRUCTION);
    }

    async function proposal(controller: TuiController) {
      await ready(controller);
      await controller.generateProposal();
      expect(controller.getState().modal).toBe("privacy");
      await controller.confirmPrivacy();
      expect(controller.getState().status).toBe("proposal-ready");
    }

    test("startup loads canonical project and only root tree entries", async () => {
      const { controller, requests } = controllerWith();
      expect(controller.getState()).toMatchObject({
        projectRoot: null,
        file: null,
        busy: false,
        providerConfigured: true,
        privacyConfirmed: false,
      });
      await controller.start();
      expect(controller.getState()).toMatchObject({
        projectRoot: realpathSync(projectPath),
        status: "idle",
        focus: "tree",
        selectedTreeIndex: 0,
      });
      expect(controller.getState().tree).toEqual([
        {
          name: "src",
          relativePath: "src",
          type: "directory",
          depth: 0,
          expanded: false,
        },
        {
          name: "readme.txt",
          relativePath: "readme.txt",
          type: "file",
          depth: 0,
          expanded: false,
        },
      ]);
      expect(requests).toHaveLength(0);
    });

    test("lazy tree expands once, navigates children and collapses without repository reread", async () => {
      const { controller } = controllerWith();
      await controller.start();
      await controller.expandSelected();
      expect(controller.getState().tree[1]).toMatchObject({
        relativePath: "src/example.ts",
        depth: 1,
      });
      controller.moveTreeSelection(1);
      expect(controller.getState().selectedTreeIndex).toBe(1);
      controller.collapseSelected();
      expect(controller.getState().selectedTreeIndex).toBe(0);
      controller.collapseSelected();
      expect(controller.getState().tree).toHaveLength(2);
      await writeFile(join(projectPath, "src", "added-later.ts"), "later\n");
      await controller.expandSelected();
      expect(controller.getState().tree).toHaveLength(3);
      controller.moveTreeSelection(100);
      expect(controller.getState().selectedTreeIndex).toBe(2);
      controller.moveTreeSelection(-100);
      expect(controller.getState().selectedTreeIndex).toBe(0);
      controller.selectTreeEntry(-1);
      controller.selectTreeEntry(1.5);
      expect(controller.getState().selectedTreeIndex).toBe(0);
    });

    test("activation toggles directory, opens file and preserves BOM CRLF tabs and Unicode", async () => {
      const { controller, requests } = controllerWith();
      await controller.start();
      await controller.activateSelected();
      controller.moveTreeSelection(1);
      await controller.activateSelected();
      expect(controller.getState()).toMatchObject({
        file: { relativePath: "src/example.ts", sourceText: SOURCE },
        focus: "task",
        proposal: null,
      });
      controller.setInstruction(INSTRUCTION);
      expect(controller.getState().instruction).toBe(INSTRUCTION);
      expect(requests).toHaveLength(0);
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE);
    });

    test("tree ignores generated directories and credential filenames inherited from host", async () => {
      for (const name of [
        ".git",
        "node_modules",
        "dist",
        "build",
        "coverage",
        ".cache",
      ])
        await mkdir(join(projectPath, name));
      await writeFile(join(projectPath, ".env"), "fixture-unused-secret\n");
      const { controller } = controllerWith();
      await controller.start();
      expect(controller.getState().tree.map((entry) => entry.name)).toEqual([
        "src",
        "readme.txt",
      ]);
    });

    test("first Generate requires process-local privacy consent and makes zero calls until confirmed", async () => {
      const { controller, requests } = controllerWith();
      await ready(controller);
      await controller.generateProposal();
      expect(controller.getState()).toMatchObject({
        modal: "privacy",
        privacyConfirmed: false,
        proposal: null,
        busy: false,
      });
      expect(requests).toHaveLength(0);
      await controller.generateProposal();
      expect(requests).toHaveLength(0);
      controller.cancelModal();
      expect(controller.getState()).toMatchObject({
        modal: null,
        privacyConfirmed: false,
      });
      await controller.generateProposal();
      await controller.confirmPrivacy();
      expect(requests).toHaveLength(1);
      expect(JSON.parse(requests[0]?.userText ?? "")).toEqual({
        instruction: INSTRUCTION,
        sourceText: SOURCE,
      });
      expect(requests[0]?.systemText).toContain("oldText");
      expect(controller.getState()).toMatchObject({
        privacyConfirmed: true,
        modal: null,
        status: "proposal-ready",
        focus: "code",
        proposal: { proposal: EDIT, snapshot: { sourceText: SOURCE } },
      });
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE);
    });

    test("privacy is asked only once per controller even after another project is opened", async () => {
      const { controller, requests } = controllerWith();
      await proposal(controller);
      await controller.openProject(projectPath);
      await controller.selectFile("src/example.ts");
      controller.setInstruction(INSTRUCTION);
      await controller.generateProposal();
      expect(controller.getState().modal).toBeNull();
      expect(requests).toHaveLength(2);
      expect(controller.getState().privacyConfirmed).toBe(true);
    });

    test("Generate rereads the selected file before core validation and snapshots the exact fresh source", async () => {
      const { controller, requests } = controllerWith();
      await ready(controller);
      const changed = `${SOURCE}// external change\r\n`;
      await writeFile(join(projectPath, "src", "example.ts"), changed);
      await controller.generateProposal();
      await controller.confirmPrivacy();
      expect(JSON.parse(requests[0]?.userText ?? "").sourceText).toBe(changed);
      expect(controller.getState().proposal?.snapshot.sourceText).toBe(changed);
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(changed);
    });

    test.each([undefined, "", " \t\n "])(
      "missing or blank key %p fails safely with no model call",
      async (key) => {
        const { controller, requests } = controllerWith(undefined, key ?? null);
        await ready(controller);
        await controller.generateProposal();
        expect(controller.getState()).toMatchObject({
          providerConfigured: false,
          modal: "error",
          status: "error",
          privacyConfirmed: false,
        });
        expect(controller.getState().error).toContain("DEEPSEEK_API_KEY");
        expect(requests).toHaveLength(0);
      },
    );

    test("missing file selection and blank instruction are local failures with no consent or model call", async () => {
      const { controller, requests } = controllerWith();
      await controller.start();
      await controller.generateProposal();
      expect(controller.getState().error).toBe("请选择一个源码文件。");
      controller.cancelModal();
      await controller.selectFile("src/example.ts");
      controller.setInstruction(" \t\n ");
      await controller.generateProposal();
      expect(controller.getState().error).toBe(
        "请输入包含非空白字符的修改要求。",
      );
      expect(requests).toHaveLength(0);
    });

    test("empty file is rejected before model while whitespace-only file is passed to real core", async () => {
      await writeFile(join(projectPath, "empty.ts"), "");
      const { controller, requests } = controllerWith();
      await controller.start();
      await controller.selectFile("empty.ts");
      controller.setInstruction("replace");
      await controller.generateProposal();
      await controller.confirmPrivacy();
      expect(controller.getState().error).toBe(
        "源码文件不能为空，修改要求必须包含非空白字符。",
      );
      expect(requests).toHaveLength(0);
      controller.cancelModal();
      const whitespace = " \t\r\n ";
      await writeFile(join(projectPath, "space.ts"), whitespace);
      const second = controllerWith(async () => ({
        status: "completed",
        text: JSON.stringify({
          oldText: whitespace,
          newText: "let value = 1;\n",
        }),
      }));
      await second.controller.start();
      await second.controller.selectFile("space.ts");
      second.controller.setInstruction("Add a declaration.");
      await second.controller.generateProposal();
      await second.controller.confirmPrivacy();
      expect(second.controller.getState().status).toBe("proposal-ready");
      expect(JSON.parse(second.requests[0]?.userText ?? "").sourceText).toBe(
        whitespace,
      );
    });

    test.each([
      {
        name: "provider failure",
        result: {
          status: "failed",
          error: {
            kind: "provider-failure",
            message: `raw provider body ${FAKE_KEY}`,
          },
        } as ModelResult,
        message: "DeepSeek 请求失败，请检查配置或稍后再试。",
      },
      {
        name: "invalid proposal",
        result: {
          status: "completed",
          text: "```json\n{}\n```",
        } as ModelResult,
        message: "模型返回的修改建议未通过 Ariel validation。",
      },
    ])(
      "$name produces a safe modal, one attempt and no writes",
      async ({ result, message }) => {
        const { controller, requests } = controllerWith(async () => result);
        await ready(controller);
        await controller.generateProposal();
        await controller.confirmPrivacy();
        expect(controller.getState()).toMatchObject({
          status: "error",
          modal: "error",
          proposal: null,
          error: message,
          busy: false,
        });
        expect(requests).toHaveLength(1);
        expect(JSON.stringify(controller.getState())).not.toContain(FAKE_KEY);
        expect(
          await readFile(join(projectPath, "src", "example.ts"), "utf8"),
        ).toBe(SOURCE);
      },
    );

    test("busy state locks tree task Apply Undo and parallel Generate while one attempt is pending", async () => {
      let resolve: (value: ModelResult) => void = () => {
        throw new Error("No pending model attempt.");
      };
      const waiting = new Promise<ModelResult>((done) => {
        resolve = done;
      });
      let markStarted: () => void = () => {
        throw new Error("The test did not create its start signal.");
      };
      const started = new Promise<void>((done) => {
        markStarted = done;
      });
      const { controller, requests } = controllerWith(() => {
        markStarted();
        return waiting;
      });
      await ready(controller);
      await controller.generateProposal();
      const inFlight = controller.confirmPrivacy();
      await started;
      expect(controller.getState()).toMatchObject({
        status: "requesting-model",
        busy: true,
      });
      const before = controller.getState();
      controller.moveTreeSelection(1);
      controller.setInstruction("another task");
      controller.requestApply();
      controller.openProjectModal();
      controller.showHelp();
      controller.cycleFocus();
      await controller.generateProposal();
      await controller.confirmApply();
      await controller.undoApply();
      expect(controller.getState()).toBe(before);
      expect(requests).toHaveLength(1);
      resolve(expectedCompletion());
      await inFlight;
      expect(controller.getState()).toMatchObject({
        status: "proposal-ready",
        busy: false,
      });
    });

    test("Reject removes proposal and cannot mutate files", async () => {
      const { controller, requests } = controllerWith();
      await proposal(controller);
      controller.rejectProposal();
      expect(controller.getState()).toMatchObject({
        proposal: null,
        status: "idle",
        latestUndo: null,
        focus: "code",
      });
      controller.requestApply();
      await controller.confirmApply();
      expect(controller.getState().modal).toBeNull();
      expect(requests).toHaveLength(1);
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE);
    });

    test("Apply requires independent request plus confirmation and Undo restores exact original bytes", async () => {
      const { controller, requests } = controllerWith();
      await proposal(controller);
      await controller.confirmApply();
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE);
      controller.requestApply();
      expect(controller.getState().modal).toBe("apply");
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE);
      controller.cancelModal();
      await controller.confirmApply();
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE);
      controller.requestApply();
      await controller.confirmApply();
      const after = SOURCE.replace(EDIT.oldText, EDIT.newText);
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(after);
      expect(controller.getState()).toMatchObject({
        status: "applied",
        proposal: null,
        latestUndo: { relativePath: "src/example.ts" },
        file: { sourceText: after },
      });
      await controller.undoApply();
      expect(await readFile(join(projectPath, "src", "example.ts"))).toEqual(
        Buffer.from(SOURCE),
      );
      expect(controller.getState()).toMatchObject({
        status: "undo-complete",
        latestUndo: null,
        proposal: null,
        instruction: "",
      });
      await controller.undoApply();
      expect(requests).toHaveLength(1);
      expect(await readdir(join(projectPath, "src"))).toEqual(["example.ts"]);
    });

    test("stale proposal is refused without overwriting external source changes", async () => {
      const { controller } = controllerWith();
      await proposal(controller);
      const external = `${SOURCE}// changed after generation\r\n`;
      await writeFile(join(projectPath, "src", "example.ts"), external);
      controller.requestApply();
      await controller.confirmApply();
      expect(controller.getState()).toMatchObject({
        status: "error",
        modal: "error",
        error: "文件已在生成建议后变化，请重新生成。",
        latestUndo: null,
      });
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(external);
    });

    test("guarded Undo refuses later external modification", async () => {
      const { controller } = controllerWith();
      await proposal(controller);
      controller.requestApply();
      await controller.confirmApply();
      const external = "// user changed this after Apply\n";
      await writeFile(join(projectPath, "src", "example.ts"), external);
      await controller.undoApply();
      expect(controller.getState()).toMatchObject({
        status: "error",
        modal: "error",
        error: "文件已在 Apply 后变化，不能覆盖当前修改。",
        latestUndo: { relativePath: "src/example.ts" },
      });
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(external);
    });

    test("opening a project clears proposal Undo file instruction but retains privacy consent", async () => {
      const { controller } = controllerWith();
      await proposal(controller);
      controller.requestApply();
      await controller.confirmApply();
      await controller.openProject(projectPath);
      expect(controller.getState()).toMatchObject({
        file: null,
        instruction: "",
        proposal: null,
        latestUndo: null,
        privacyConfirmed: true,
        focus: "tree",
      });
      await controller.undoApply();
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE.replace(EDIT.oldText, EDIT.newText));
    });

    test("opening another file discards pending proposal and preserves the most recent Undo", async () => {
      const { controller } = controllerWith();
      await proposal(controller);
      controller.requestApply();
      await controller.confirmApply();
      await controller.selectFile("readme.txt");
      expect(controller.getState()).toMatchObject({
        file: { relativePath: "readme.txt" },
        proposal: null,
        latestUndo: { relativePath: "src/example.ts" },
      });
      await controller.undoApply();
      expect(controller.getState().file?.relativePath).toBe("src/example.ts");
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE);
    });

    test("missing project file and traversal failures are safe, with no model attempt", async () => {
      const { controller, requests } = controllerWith();
      await controller.start();
      await controller.selectFile("missing.ts");
      expect(controller.getState()).toMatchObject({
        status: "error",
        modal: "error",
        file: null,
      });
      expect(controller.getState().error).not.toContain(projectPath);
      controller.cancelModal();
      await controller.selectFile("../outside.ts");
      expect(controller.getState().error).toBe(
        "该路径不属于允许的项目文件范围。",
      );
      expect(requests).toHaveLength(0);
    });

    test("failed project open keeps previously opened safe project usable", async () => {
      const { controller } = controllerWith();
      await controller.start();
      const original = controller.getState().projectRoot;
      await controller.openProject(join(projectPath, "missing-project"));
      expect(controller.getState()).toMatchObject({
        projectRoot: original,
        status: "error",
        modal: "error",
      });
      controller.cancelModal();
      await controller.selectFile("src/example.ts");
      expect(controller.getState().file?.sourceText).toBe(SOURCE);
    });

    test("focus cycle and Help/Open Project overlays do not mutate project state", async () => {
      const { controller, requests } = controllerWith();
      await controller.start();
      controller.cycleFocus();
      expect(controller.getState().focus).toBe("code");
      controller.cycleFocus();
      expect(controller.getState().focus).toBe("task");
      controller.cycleFocus();
      expect(controller.getState().focus).toBe("tree");
      controller.showHelp();
      expect(controller.getState().modal).toBe("help");
      controller.cycleFocus();
      expect(controller.getState().focus).toBe("tree");
      controller.cancelModal();
      controller.openProjectModal();
      expect(controller.getState().modal).toBe("open-project");
      controller.cancelModal();
      expect(controller.getState().modal).toBeNull();
      expect(requests).toHaveLength(0);
    });

    test("credential is neither retained in UI state nor accepted as instruction/source/proposal", async () => {
      const { controller, requests } = controllerWith();
      await ready(controller);
      expect(JSON.stringify(controller.getState())).not.toContain(FAKE_KEY);
      controller.setInstruction(`Please repeat ${FAKE_KEY}`);
      expect(controller.getState()).toMatchObject({
        instruction: "",
        modal: "error",
      });
      expect(JSON.stringify(controller.getState())).not.toContain(FAKE_KEY);
      expect(requests).toHaveLength(0);
      controller.cancelModal();
      await writeFile(
        join(projectPath, "credential.ts"),
        `const fixture = "${FAKE_KEY}";\n`,
      );
      await controller.selectFile("credential.ts");
      expect(controller.getState().modal).toBe("error");
      expect(JSON.stringify(controller.getState())).not.toContain(FAKE_KEY);
      expect(requests).toHaveLength(0);
      controller.cancelModal();
      const second = controllerWith(async () => ({
        status: "completed",
        text: JSON.stringify({ oldText: EDIT.oldText, newText: FAKE_KEY }),
      }));
      await ready(second.controller);
      await second.controller.generateProposal();
      await second.controller.confirmPrivacy();
      expect(second.controller.getState()).toMatchObject({
        modal: "error",
        proposal: null,
      });
      expect(JSON.stringify(second.controller.getState())).not.toContain(
        FAKE_KEY,
      );
    });

    test("snapshots exposed to the view are frozen and cannot rewrite trusted Apply state", async () => {
      const { controller } = controllerWith();
      await proposal(controller);
      const state = controller.getState();
      expect(Object.isFrozen(state)).toBe(true);
      expect(Object.isFrozen(state.file)).toBe(true);
      expect(Object.isFrozen(state.proposal)).toBe(true);
      expect(Object.isFrozen(state.proposal?.proposal)).toBe(true);
      expect(Object.isFrozen(state.tree)).toBe(true);
      expect(state.tree.every((entry) => Object.isFrozen(entry))).toBe(true);
    });

    test.each(["sync", "reject"] as const)(
      "unexpected %s error identity propagates to terminal boundary without retry",
      async (mode) => {
        const unexpected = new Error(
          "fixture-only-unexpected-programming-error",
        );
        const { controller, requests } = controllerWith(
          mode === "sync"
            ? () => {
                throw unexpected;
              }
            : () => Promise.reject(unexpected),
        );
        await ready(controller);
        await controller.generateProposal();
        const caught = await controller.confirmPrivacy().then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(caught).toBe(unexpected);
        expect(requests).toHaveLength(1);
        expect(controller.getState()).toMatchObject({
          busy: false,
          modal: null,
          proposal: null,
        });
        expect(controller.getState().error).toBeNull();
        expect(
          await readFile(join(projectPath, "src", "example.ts"), "utf8"),
        ).toBe(SOURCE);
      },
    );

    test("dispose prevents further model/file operations and unsubscribes listeners", async () => {
      const { controller, requests } = controllerWith();
      await ready(controller);
      let events = 0;
      const unsubscribe = controller.subscribe(() => {
        events++;
      });
      controller.setFocus("code");
      expect(events).toBe(1);
      unsubscribe();
      controller.setFocus("task");
      expect(events).toBe(1);
      controller.dispose();
      const before = controller.getState();
      await controller.generateProposal();
      await controller.confirmPrivacy();
      await controller.openProject(projectPath);
      controller.setInstruction("later");
      expect(controller.getState()).toBe(before);
      expect(requests).toHaveLength(0);
    });

    test("deletion proposal can be applied then undone without changing other bytes", async () => {
      const { controller, requests } = controllerWith(async () => ({
        status: "completed",
        text: JSON.stringify({ oldText: "\treturn 1;\r\n", newText: "" }),
      }));
      await proposal(controller);
      controller.requestApply();
      await controller.confirmApply();
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE.replace("\treturn 1;\r\n", ""));
      await controller.undoApply();
      expect(await readFile(join(projectPath, "src", "example.ts"))).toEqual(
        Buffer.from(SOURCE),
      );
      expect(requests).toHaveLength(1);
    });

    test("exit while reading a fresh Generate snapshot does not start a later model attempt", async () => {
      const { controller, requests } = controllerWith();
      await ready(controller);
      await controller.generateProposal();
      controller.subscribe(() => {
        if (
          controller.getState().status === "reading-file" &&
          controller.getState().busy
        )
          controller.dispose();
      });
      await controller.confirmPrivacy();
      expect(requests).toHaveLength(0);
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE);
    });

    test("disposing presentation during confirmed Apply allows its atomic operation and cleanup to settle", async () => {
      const { controller, requests } = controllerWith();
      await proposal(controller);
      controller.subscribe(() => {
        if (
          controller.getState().status === "applying" &&
          controller.getState().busy
        )
          controller.dispose();
      });
      controller.requestApply();
      await controller.confirmApply();
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE.replace(EDIT.oldText, EDIT.newText));
      expect(await readdir(join(projectPath, "src"))).toEqual(["example.ts"]);
      expect(requests).toHaveLength(1);
      // Disposal prevents later writes; it does not interrupt an authorized rename.
      await controller.undoApply();
      expect(
        await readFile(join(projectPath, "src", "example.ts"), "utf8"),
      ).toBe(SOURCE.replace(EDIT.oldText, EDIT.newText));
    });

    test.each(["apply", "undo"] as const)(
      "confirmed %s stays busy until delayed atomic rename and cleanup settle",
      async (mode) => {
        const { controller } = controllerWith();
        await proposal(controller);
        if (mode === "undo") {
          controller.requestApply();
          await controller.confirmApply();
        }
        const originalRename = fs.rename;
        let release: () => void = () => {
          throw new Error("No delayed write fixture.");
        };
        let markStarted: () => void = () => {
          throw new Error("No fixture start signal.");
        };
        const delay = new Promise<void>((done) => {
          release = done;
        });
        const started = new Promise<void>((done) => {
          markStarted = done;
        });
        const rename = spyOn(fs, "rename").mockImplementation(
          async (from, to) => {
            markStarted();
            await delay;
            await originalRename(from, to);
          },
        );
        try {
          if (mode === "apply") controller.requestApply();
          const attempt =
            mode === "apply"
              ? controller.confirmApply()
              : controller.undoApply();
          await started;
          expect(controller.getState()).toMatchObject({
            busy: true,
            status: "applying",
          });
          let announcedIdle = false;
          const unsubscribe = controller.subscribe(() => {
            if (!controller.getState().busy) announcedIdle = true;
          });
          expect(announcedIdle).toBe(false);
          release();
          await attempt;
          expect(announcedIdle).toBe(true);
          unsubscribe();
          expect(
            await readFile(join(projectPath, "src", "example.ts"), "utf8"),
          ).toBe(
            mode === "apply"
              ? SOURCE.replace(EDIT.oldText, EDIT.newText)
              : SOURCE,
          );
          expect(await readdir(join(projectPath, "src"))).toEqual([
            "example.ts",
          ]);
        } finally {
          release();
          rename.mockRestore();
        }
      },
    );

    test.each(["apply", "undo"] as const)(
      "unexpected %s filesystem error preserves identity and cleans its staging file",
      async (mode) => {
        const { controller } = controllerWith();
        await proposal(controller);
        if (mode === "undo") {
          controller.requestApply();
          await controller.confirmApply();
        }
        const before = await readFile(join(projectPath, "src", "example.ts"));
        const unexpected = new Error(
          "fixture-only-unexpected-filesystem-programming-error",
        );
        const rename = spyOn(fs, "rename").mockRejectedValue(unexpected);
        try {
          if (mode === "apply") controller.requestApply();
          const attempt =
            mode === "apply"
              ? controller.confirmApply()
              : controller.undoApply();
          const caught = await attempt.then(
            () => undefined,
            (error: unknown) => error,
          );
          expect(caught).toBe(unexpected);
          expect(controller.getState()).toMatchObject({
            busy: false,
            modal: null,
            error: null,
          });
          expect(
            await readFile(join(projectPath, "src", "example.ts")),
          ).toEqual(before);
          expect(await readdir(join(projectPath, "src"))).toEqual([
            "example.ts",
          ]);
        } finally {
          rename.mockRestore();
        }
      },
    );

    test("production composition uses real adapter with offline fetch fixture and explicit wire config", async () => {
      const transport = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "fixture-tui-code-edit",
            object: "chat.completion",
            created: 0,
            model: "fixture-reported-model",
            system_fingerprint: "fixture",
            choices: [
              {
                index: 0,
                logprobs: null,
                finish_reason: "stop",
                message: { role: "assistant", content: JSON.stringify(EDIT) },
              },
            ],
          }),
        ),
      );
      try {
        const controller = createTuiController({
          initialProjectPath: projectPath,
          apiKey: FAKE_KEY,
        });
        controllers.push(controller);
        await proposal(controller);
        expect(transport).toHaveBeenCalledTimes(1);
        const [url, options] = transport.mock.calls[0] ?? [];
        expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
        expect(options?.method).toBe("POST");
        expect(options?.redirect).toBe("error");
        expect(new Headers(options?.headers).get("Authorization")).toBe(
          `Bearer ${FAKE_KEY}`,
        );
        const body = JSON.parse(String(options?.body));
        expect(body.model).toBe("deepseek-flash");
        expect(body.stream).toBe(false);
        expect(body.thinking).toEqual({ type: "disabled" });
        expect(JSON.parse(body.messages[1].content)).toEqual({
          instruction: INSTRUCTION,
          sourceText: SOURCE,
        });
        expect(JSON.stringify(controller.getState())).not.toContain(FAKE_KEY);
        expect(
          await readFile(join(projectPath, "src", "example.ts"), "utf8"),
        ).toBe(SOURCE);
      } finally {
        transport.mockRestore();
      }
    });
  },
);
