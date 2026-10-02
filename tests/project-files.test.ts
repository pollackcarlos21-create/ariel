import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import * as fs from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  openProjectFiles,
  type ProjectFiles,
  type ProjectFilesErrorKind,
  type ProjectFilesResult,
  runDeepSeekCodeEditTask,
} from "@ariel/local-host";

const SOURCE = "\uFEFFfunction loadData() {\r\n  return 1;\r\n}\r\n";
const PROPOSAL = {
  oldText: "function loadData() {",
  newText: "async function loadData() {",
};
const FAKE_KEY = "fixture-only-not-a-real-api-key";
const PRIVATE_MARKER = "fixture-private-filesystem-detail";

function completed<T>(result: ProjectFilesResult<T>): T {
  expect(result.status).toBe("completed");
  if (result.status !== "completed")
    throw new Error("Fixture expected a completed project operation.");
  return result.value;
}

function failed<T>(
  result: ProjectFilesResult<T>,
  kind: ProjectFilesErrorKind,
): void {
  expect(result.status).toBe("failed");
  if (result.status !== "failed")
    throw new Error("Fixture expected a failed project operation.");
  expect(result.error.kind).toBe(kind);
  expect(result.error.message.length).toBeGreaterThan(0);
  expect(JSON.stringify(result)).not.toContain(PRIVATE_MARKER);
  expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  expect(result.error.message).not.toContain("Error:");
}

describe.serial("project-scoped files, explicit Apply and guarded Undo", () => {
  let base: string;
  let project: string;
  let outside: string;
  let files: ProjectFiles;
  let fetchSpy: Mock<
    (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
  >;

  beforeEach(async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Offline fixture forbids network."),
    );
    base = await mkdtemp(join(tmpdir(), "ariel-project-files-"));
    project = join(base, "project");
    outside = join(base, "outside");
    await mkdir(join(project, "src"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(project, "src/example.ts"), SOURCE);
    await writeFile(join(outside, "private.ts"), PRIVATE_MARKER);
    files = completed(await openProjectFiles(project));
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await rm(base, { recursive: true, force: true });
  });

  test("a local Unix socket is skipped during listing and rejected safely when selected", async () => {
    // Test-only local inode fixture; there is no HTTP server or network request.
    const socket = createServer();
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.listen(join(project, "s"), resolve);
    });
    try {
      expect((await fs.lstat(join(project, "s"))).isSocket()).toBe(true);
      expect(completed(await files.listDirectory())).toEqual([
        { name: "src", relativePath: "src", type: "directory" },
      ]);
      failed(await files.readFile("s"), "file-read-failure");
      expect(completed(await files.readFile("src/example.ts")).sourceText).toBe(
        SOURCE,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        socket.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  test.each(["EOPNOTSUPP", "ENOTSUP"])(
    "unsupported filesystem operation %s is a safe expected read failure",
    async (code) => {
      const error = Object.assign(new Error(PRIVATE_MARKER), { code });
      const canonicalize = spyOn(fs, "realpath").mockRejectedValue(error);
      try {
        failed(await files.readFile("src/example.ts"), "file-read-failure");
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        canonicalize.mockRestore();
      }
    },
  );

  test("opens the canonical selected project and performs no automatic file mutation", async () => {
    expect(files.rootPath).toBe(await fs.realpath(project));
    const before = await readFile(join(project, "src/example.ts"));
    completed(await files.listDirectory());
    completed(await files.readFile("src/example.ts"));
    expect(await readFile(join(project, "src/example.ts"))).toEqual(before);
    expect(await readdir(join(project, "src"))).toEqual(["example.ts"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("rejects missing project and a regular file as project root safely", async () => {
    failed(
      await openProjectFiles(join(base, PRIVATE_MARKER)),
      "invalid-project",
    );
    failed(
      await openProjectFiles(join(project, "src/example.ts")),
      "invalid-project",
    );
  });

  test("lists only one requested directory lazily with deterministic relative paths", async () => {
    await writeFile(join(project, "README.md"), "readme");
    expect(completed(await files.listDirectory())).toEqual([
      { name: "src", relativePath: "src", type: "directory" },
      { name: "README.md", relativePath: "README.md", type: "file" },
    ]);
    expect(completed(await files.listDirectory("src"))).toEqual([
      { name: "example.ts", relativePath: "src/example.ts", type: "file" },
    ]);
  });

  test("uses the same ignore rule for listing, reading and writing environment/generated paths", async () => {
    const ignored = [
      ".git",
      "node_modules",
      "dist",
      "build",
      "coverage",
      ".cache",
      ".next",
      ".turbo",
    ];
    for (const name of ignored) {
      await mkdir(join(project, name));
      await writeFile(join(project, name, "private.ts"), PRIVATE_MARKER);
    }
    for (const name of [
      ".env",
      ".env.local",
      ".ENV.production",
      "private.pem",
    ]) {
      await writeFile(join(project, name), PRIVATE_MARKER);
    }
    expect(completed(await files.listDirectory())).toEqual([
      { name: "src", relativePath: "src", type: "directory" },
    ]);
    for (const path of [
      ...ignored.map((name) => `${name}/private.ts`),
      ".env",
      ".env.local",
      ".ENV.production",
      "private.pem",
    ]) {
      failed(await files.readFile(path), "invalid-path");
      failed(
        await files.applyProposal(
          { relativePath: path, sourceText: PRIVATE_MARKER, hash: "ignored" },
          { oldText: PRIVATE_MARKER, newText: "replacement" },
        ),
        "invalid-path",
      );
    }
  });

  test.each([
    "../outside/private.ts",
    "src/../../outside/private.ts",
    "src/./example.ts",
    "src//example.ts",
    "src\\example.ts",
    "C:\\private.ts",
    "",
    "bad\0path",
  ])("rejects unsafe relative path %j for reads and writes", async (path) => {
    failed(await files.readFile(path), "invalid-path");
    failed(
      await files.applyProposal(
        { relativePath: path, sourceText: SOURCE, hash: "invalid" },
        PROPOSAL,
      ),
      "invalid-path",
    );
    expect(await readFile(join(outside, "private.ts"), "utf8")).toBe(
      PRIVATE_MARKER,
    );
  });

  test("rejects an absolute path to a file outside the project", async () => {
    const absolute = join(outside, "private.ts");
    failed(await files.readFile(absolute), "invalid-path");
    failed(await files.listDirectory(outside), "invalid-path");
  });

  test("rejects outside and inside symlinks, including parent directory symlinks", async () => {
    await symlink(
      join(outside, "private.ts"),
      join(project, "outside-link.ts"),
    );
    await symlink(
      join(project, "src/example.ts"),
      join(project, "inside-link.ts"),
    );
    await symlink(outside, join(project, "outside-directory"));
    failed(await files.readFile("outside-link.ts"), "invalid-path");
    failed(await files.readFile("inside-link.ts"), "invalid-path");
    failed(
      await files.readFile("outside-directory/private.ts"),
      "invalid-path",
    );
    failed(await files.listDirectory("outside-directory"), "invalid-path");
    expect(
      completed(await files.listDirectory()).map((entry) => entry.name),
    ).toEqual(["src"]);
  });

  test("rejects hardlinked files rather than reading or mutating shared inode aliases", async () => {
    await link(join(outside, "private.ts"), join(project, "hardlink.ts"));
    failed(await files.readFile("hardlink.ts"), "file-read-failure");
    failed(
      await files.applyProposal(
        {
          relativePath: "hardlink.ts",
          sourceText: PRIVATE_MARKER,
          hash: "not-used",
        },
        { oldText: PRIVATE_MARKER, newText: "replacement" },
      ),
      "file-read-failure",
    );
    expect(
      completed(await files.listDirectory()).map((entry) => entry.name),
    ).toEqual(["src"]);
    expect(await readFile(join(outside, "private.ts"), "utf8")).toBe(
      PRIVATE_MARKER,
    );
  });

  test("preserves exact UTF-8, BOM and CRLF and hashes the original bytes", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    expect(snapshot.sourceText).toBe(SOURCE);
    expect(snapshot.relativePath).toBe("src/example.ts");
    expect(snapshot.hash).toBe(
      createHash("sha256")
        .update(await readFile(join(project, "src/example.ts")))
        .digest("hex"),
    );
  });

  test.each([
    { name: "malformed UTF-8", bytes: new Uint8Array([0xc3, 0x28]) },
    {
      name: "NUL-containing binary",
      bytes: new Uint8Array([0x41, 0x00, 0x42]),
    },
  ])("rejects $name without rewriting bytes", async ({ bytes }) => {
    const path = join(project, "src/binary.ts");
    await writeFile(path, bytes);
    failed(await files.readFile("src/binary.ts"), "file-read-failure");
    expect(new Uint8Array(await readFile(path))).toEqual(bytes);
  });

  test("rejects files above 5MiB and accepts the inclusive 5MiB boundary", async () => {
    const path = join(project, "src/large.ts");
    await writeFile(path, new Uint8Array(5 * 1024 * 1024 + 1).fill(0x61));
    failed(await files.readFile("src/large.ts"), "file-read-failure");
    await writeFile(path, new Uint8Array(5 * 1024 * 1024).fill(0x61));
    expect(
      completed(await files.readFile("src/large.ts")).sourceText.length,
    ).toBe(5 * 1024 * 1024);
  });

  test("applies only on explicit invocation, uses atomic replace, and supports exact-byte Undo", async () => {
    const path = join(project, "src/example.ts");
    const before = await readFile(path);
    const beforeStat = await stat(path);
    const snapshot = completed(await files.readFile("src/example.ts"));
    expect(await readFile(path)).toEqual(before);
    const applied = completed(await files.applyProposal(snapshot, PROPOSAL));
    expect(await readFile(path, "utf8")).toBe(
      SOURCE.replace(PROPOSAL.oldText, PROPOSAL.newText),
    );
    expect(applied.snapshot.hash).not.toBe(snapshot.hash);
    expect(applied.undo).toEqual({
      relativePath: snapshot.relativePath,
      beforeText: SOURCE,
      afterText: applied.snapshot.sourceText,
      afterHash: applied.snapshot.hash,
    });
    const afterStat = await stat(path);
    expect(afterStat.ino).not.toBe(beforeStat.ino);
    expect(afterStat.mode).toBe(beforeStat.mode);
    expect(await readdir(join(project, "src"))).toEqual(["example.ts"]);
    expect(completed(await files.undoApply(applied.undo)).hash).toBe(
      snapshot.hash,
    );
    expect(await readFile(path)).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("copy staging preserves group-write mode regardless of process umask without chmod", async () => {
    const path = join(project, "src/mode.ts");
    const originalMask = process.umask();
    try {
      process.umask(0);
      await writeFile(path, "const value = 1;\n", { mode: 0o664 });
    } finally {
      process.umask(originalMask);
    }
    const before = await stat(path);
    expect(before.mode & 0o777).toBe(0o664);
    const snapshot = completed(await files.readFile("src/mode.ts"));
    const applied = completed(
      await files.applyProposal(snapshot, { oldText: "1", newText: "2" }),
    );
    expect((await stat(path)).mode).toBe(before.mode);
    completed(await files.undoApply(applied.undo));
    expect((await stat(path)).mode).toBe(before.mode);
  });

  test("allows whole-file deletion and Undo back to the original BOM and newline bytes", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const applied = completed(
      await files.applyProposal(snapshot, { oldText: SOURCE, newText: "" }),
    );
    expect((await readFile(join(project, "src/example.ts"))).length).toBe(0);
    completed(await files.undoApply(applied.undo));
    expect(await readFile(join(project, "src/example.ts"), "utf8")).toBe(
      SOURCE,
    );
  });

  test("rejects a stale proposal and preserves the user's intervening text", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const changed = `${SOURCE}// external edit\n`;
    await writeFile(join(project, "src/example.ts"), changed);
    failed(await files.applyProposal(snapshot, PROPOSAL), "stale-proposal");
    expect(await readFile(join(project, "src/example.ts"), "utf8")).toBe(
      changed,
    );
  });

  test.each([
    { name: "empty anchor", source: "aaa", oldText: "", newText: "b" },
    { name: "missing anchor", source: "aaa", oldText: "z", newText: "b" },
    { name: "duplicate anchor", source: "a a", oldText: "a", newText: "b" },
    { name: "overlapping anchor", source: "aaa", oldText: "aa", newText: "bb" },
    { name: "no-op", source: "aaa", oldText: "aaa", newText: "aaa" },
    { name: "NUL replacement", source: "aaa", oldText: "aaa", newText: "\0" },
    {
      name: "non-roundtrip surrogate",
      source: "aaa",
      oldText: "aaa",
      newText: "\ud800",
    },
  ])(
    "rejects $name during Apply without writing a replacement",
    async ({ source, oldText, newText }) => {
      const path = join(project, "src/example.ts");
      await writeFile(path, source);
      const snapshot = completed(await files.readFile("src/example.ts"));
      failed(
        await files.applyProposal(snapshot, { oldText, newText }),
        "invalid-proposal",
      );
      expect(await readFile(path, "utf8")).toBe(source);
      expect(await readdir(join(project, "src"))).toEqual(["example.ts"]);
    },
  );

  test("refuses stale Undo without overwriting an external edit", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const applied = completed(await files.applyProposal(snapshot, PROPOSAL));
    await writeFile(join(project, "src/example.ts"), "external update\n");
    failed(await files.undoApply(applied.undo), "stale-undo");
    expect(await readFile(join(project, "src/example.ts"), "utf8")).toBe(
      "external update\n",
    );
  });

  test("serializes concurrent Apply so a second stale snapshot cannot overwrite the first", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const [first, second] = await Promise.all([
      files.applyProposal(snapshot, PROPOSAL),
      files.applyProposal(snapshot, { ...PROPOSAL, newText: "different" }),
    ]);
    completed(first);
    failed(second, "stale-proposal");
    expect(await readFile(join(project, "src/example.ts"), "utf8")).toBe(
      SOURCE.replace(PROPOSAL.oldText, PROPOSAL.newText),
    );
  });

  test("cleans its own temporary file after a safe atomic rename failure", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const error = Object.assign(new Error(`${PRIVATE_MARKER} ${FAKE_KEY}`), {
      code: "EACCES",
    });
    const renameSpy = spyOn(fs, "rename").mockRejectedValue(error);
    try {
      failed(
        await files.applyProposal(snapshot, PROPOSAL),
        "file-write-failure",
      );
      expect(await readFile(join(project, "src/example.ts"), "utf8")).toBe(
        SOURCE,
      );
      expect(await readdir(join(project, "src"))).toEqual(["example.ts"]);
    } finally {
      renameSpy.mockRestore();
    }
  });

  test("detects a content change during staging before the atomic commit", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const originalCopy = fs.copyFile;
    const copySpy = spyOn(fs, "copyFile").mockImplementation(
      async (...args) => {
        await originalCopy(...args);
        await writeFile(
          join(project, "src/example.ts"),
          "external staging edit\n",
        );
      },
    );
    try {
      failed(await files.applyProposal(snapshot, PROPOSAL), "stale-proposal");
      expect(await readFile(join(project, "src/example.ts"), "utf8")).toBe(
        "external staging edit\n",
      );
      expect(await readdir(join(project, "src"))).toEqual(["example.ts"]);
    } finally {
      copySpy.mockRestore();
    }
  });

  test("reports stale Undo when the file changes during its staging operation", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const applied = completed(await files.applyProposal(snapshot, PROPOSAL));
    const originalCopy = fs.copyFile;
    const copySpy = spyOn(fs, "copyFile").mockImplementation(
      async (...args) => {
        await originalCopy(...args);
        await writeFile(
          join(project, "src/example.ts"),
          "external Undo staging edit\n",
        );
      },
    );
    try {
      failed(await files.undoApply(applied.undo), "stale-undo");
      expect(await readFile(join(project, "src/example.ts"), "utf8")).toBe(
        "external Undo staging edit\n",
      );
      expect(await readdir(join(project, "src"))).toEqual(["example.ts"]);
    } finally {
      copySpy.mockRestore();
    }
  });

  test.each(["EACCES", "EPERM", "EIO"])(
    "returns safe expected %s read failures without leaking filesystem details",
    async (code) => {
      const openSpy = spyOn(fs, "open").mockRejectedValue(
        Object.assign(new Error(`${PRIVATE_MARKER} ${FAKE_KEY}`), { code }),
      );
      try {
        failed(await files.readFile("src/example.ts"), "file-read-failure");
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        openSpy.mockRestore();
      }
    },
  );

  test.each(["EACCES", "ENOSPC"])(
    "returns safe %s staging failure and preserves the original file",
    async (code) => {
      const snapshot = completed(await files.readFile("src/example.ts"));
      const copySpy = spyOn(fs, "copyFile").mockRejectedValue(
        Object.assign(new Error(`${PRIVATE_MARKER} ${FAKE_KEY}`), { code }),
      );
      try {
        failed(
          await files.applyProposal(snapshot, PROPOSAL),
          "file-write-failure",
        );
        expect(await readFile(join(project, "src/example.ts"), "utf8")).toBe(
          SOURCE,
        );
        expect(await readdir(join(project, "src"))).toEqual(["example.ts"]);
      } finally {
        copySpy.mockRestore();
      }
    },
  );

  test("rejects a temporary hardlink introduced before the writable handle check", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const originalOpen = fs.open;
    const alias = join(outside, "temporary-alias.ts");
    const openSpy = spyOn(fs, "open").mockImplementation(async (...args) => {
      const file = await originalOpen(...args);
      if (basename(String(args[0])).startsWith(".ariel-"))
        await link(String(args[0]), alias);
      return file;
    });
    try {
      failed(
        await files.applyProposal(snapshot, PROPOSAL),
        "file-write-failure",
      );
      expect(await readFile(alias, "utf8")).toBe(SOURCE);
      expect(await readFile(join(project, "src/example.ts"), "utf8")).toBe(
        SOURCE,
      );
      expect(await readdir(join(project, "src"))).toEqual(["example.ts"]);
    } finally {
      openSpy.mockRestore();
    }
  });

  test("refuses a staged temporary file version changed before commit", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const originalOpen = fs.open;
    let temporaryPath: string | undefined;
    const openSpy = spyOn(fs, "open").mockImplementation(async (...args) => {
      const path = String(args[0]);
      if (basename(path).startsWith(".ariel-")) temporaryPath = path;
      else if (temporaryPath !== undefined)
        await writeFile(temporaryPath, "external temporary edit\n");
      return originalOpen(...args);
    });
    try {
      failed(
        await files.applyProposal(snapshot, PROPOSAL),
        "file-write-failure",
      );
      expect(await readFile(join(project, "src/example.ts"), "utf8")).toBe(
        SOURCE,
      );
      expect(await readdir(join(project, "src"))).toEqual(["example.ts"]);
    } finally {
      openSpy.mockRestore();
    }
  });

  test("rejects a parent symlink swap and never cleans an unrelated outside file", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const originalCopy = fs.copyFile;
    let outsideTemp = "";
    const copySpy = spyOn(fs, "copyFile").mockImplementation(
      async (...args) => {
        await originalCopy(...args);
        await rename(join(project, "src"), join(project, "original-src"));
        await symlink(outside, join(project, "src"));
        outsideTemp = join(outside, basename(String(args[1])));
        await writeFile(outsideTemp, "unrelated outside file");
      },
    );
    try {
      failed(await files.applyProposal(snapshot, PROPOSAL), "invalid-path");
      expect(await readFile(outsideTemp, "utf8")).toBe(
        "unrelated outside file",
      );
      expect(await readFile(join(outside, "private.ts"), "utf8")).toBe(
        PRIVATE_MARKER,
      );
      expect(
        await readFile(join(project, "original-src/example.ts"), "utf8"),
      ).toBe(SOURCE);
    } finally {
      copySpy.mockRestore();
    }
  });

  test("rejects a final-file symlink swap before commit without touching its destination", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const originalCopy = fs.copyFile;
    const copySpy = spyOn(fs, "copyFile").mockImplementation(
      async (...args) => {
        await originalCopy(...args);
        await unlink(join(project, "src/example.ts"));
        await symlink(
          join(outside, "private.ts"),
          join(project, "src/example.ts"),
        );
      },
    );
    try {
      failed(await files.applyProposal(snapshot, PROPOSAL), "invalid-path");
      expect(await readFile(join(outside, "private.ts"), "utf8")).toBe(
        PRIVATE_MARKER,
      );
      expect(
        (await readdir(join(project, "src"))).filter((name) =>
          name.startsWith(".ariel-"),
        ),
      ).toEqual([]);
    } finally {
      copySpy.mockRestore();
    }
  });

  test("propagates an unexpected write failure unchanged and cleans staged data", async () => {
    const snapshot = completed(await files.readFile("src/example.ts"));
    const error = new Error("Unexpected atomic commit fixture failure.");
    const renameSpy = spyOn(fs, "rename").mockRejectedValue(error);
    try {
      await expect(files.applyProposal(snapshot, PROPOSAL)).rejects.toBe(error);
      expect(await readFile(join(project, "src/example.ts"), "utf8")).toBe(
        SOURCE,
      );
      expect(await readdir(join(project, "src"))).toEqual(["example.ts"]);
    } finally {
      renameSpy.mockRestore();
    }
  });

  test("composes a text-only application task with explicit fixed DeepSeek configuration", async () => {
    fetchSpy.mockResolvedValue(
      Response.json({
        id: "fixture",
        object: "chat.completion",
        created: 0,
        model: "fixture",
        system_fingerprint: "fixture",
        choices: [
          {
            index: 0,
            logprobs: null,
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(PROPOSAL) },
          },
        ],
      }),
    );
    const timerSpy = spyOn(globalThis, "setTimeout");
    try {
      expect(
        await runDeepSeekCodeEditTask("make async", SOURCE, FAKE_KEY),
      ).toEqual({ status: "completed", proposal: PROPOSAL });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(timerSpy.mock.calls[0]?.[1]).toBe(120_000);
      const [url, options] = fetchSpy.mock.calls[0] ?? [];
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect(
        new Headers(options?.headers).get("Authorization") ===
          `Bearer ${FAKE_KEY}`,
      ).toBe(true);
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe("deepseek-flash");
      expect(JSON.parse(body.messages[1].content)).toEqual({
        instruction: "make async",
        sourceText: SOURCE,
      });
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.stream).toBe(false);
    } finally {
      timerSpy.mockRestore();
    }
  });
});
