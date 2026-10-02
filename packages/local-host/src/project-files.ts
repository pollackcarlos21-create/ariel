import { createHash, randomUUID } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import {
  copyFile,
  lstat,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { CodeEditProposal } from "@ariel/core";

export interface ProjectDirectoryEntry {
  readonly name: string;
  readonly relativePath: string;
  readonly type: "file" | "directory";
}

export interface ProjectFileSnapshot {
  readonly relativePath: string;
  readonly sourceText: string;
  readonly hash: string;
}

export interface ProjectUndoRecord {
  readonly relativePath: string;
  readonly beforeText: string;
  readonly afterText: string;
  readonly afterHash: string;
}

export interface ProjectAppliedEdit {
  readonly snapshot: ProjectFileSnapshot;
  readonly undo: ProjectUndoRecord;
}

export type ProjectFilesErrorKind =
  | "invalid-project"
  | "invalid-path"
  | "directory-read-failure"
  | "file-read-failure"
  | "invalid-proposal"
  | "stale-proposal"
  | "file-write-failure"
  | "stale-undo";

export type ProjectFilesResult<T> =
  | { readonly status: "completed"; readonly value: T }
  | {
      readonly status: "failed";
      readonly error: {
        readonly kind: ProjectFilesErrorKind;
        readonly message: string;
      };
    };

export interface ProjectFiles {
  readonly rootPath: string;
  listDirectory(
    relativePath?: string,
  ): Promise<ProjectFilesResult<ProjectDirectoryEntry[]>>;
  readFile(
    relativePath: string,
  ): Promise<ProjectFilesResult<ProjectFileSnapshot>>;
  applyProposal(
    snapshot: ProjectFileSnapshot,
    proposal: CodeEditProposal,
  ): Promise<ProjectFilesResult<ProjectAppliedEdit>>;
  undoApply(
    record: ProjectUndoRecord,
  ): Promise<ProjectFilesResult<ProjectFileSnapshot>>;
}

const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  ".ssh",
  ".aws",
  ".gnupg",
  ".npmrc",
  ".pypirc",
  ".envrc",
  "id_rsa",
  "id_ed25519",
]);
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const EXPECTED_IO_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "EISDIR",
  "ENOTDIR",
  "EINVAL",
  "ENAMETOOLONG",
  "ELOOP",
  "EIO",
  "EMFILE",
  "ENFILE",
  "EBADF",
  "EBUSY",
  "ENOMEM",
  "EFBIG",
  "ENOSPC",
  "EDQUOT",
  "EROFS",
  "EXDEV",
  "EEXIST",
  "ENOTEMPTY",
  "EOPNOTSUPP",
  "ENOTSUP",
]);
const MESSAGES: Record<ProjectFilesErrorKind, string> = {
  "invalid-project": "The project directory could not be opened safely.",
  "invalid-path":
    "The requested path is outside the supported project boundary.",
  "directory-read-failure": "The project directory could not be listed safely.",
  "file-read-failure":
    "The file is not a supported readable UTF-8 regular file.",
  "invalid-proposal": "The proposal is not a valid unique text replacement.",
  "stale-proposal":
    "File changed since the proposal was generated. Generate again.",
  "file-write-failure": "The file operation could not be completed safely.",
  "stale-undo": "File changed since Apply. Undo was refused.",
};

class ProjectBoundaryFailure extends Error {
  constructor(readonly kind: ProjectFilesErrorKind) {
    super(MESSAGES[kind]);
  }
}

function expectedIO(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    EXPECTED_IO_CODES.has(error.code)
  );
}

async function operation<T>(
  failureKind: ProjectFilesErrorKind,
  action: () => Promise<T>,
): Promise<ProjectFilesResult<T>> {
  try {
    return { status: "completed", value: await action() };
  } catch (error) {
    const kind =
      error instanceof ProjectBoundaryFailure
        ? error.kind
        : expectedIO(error)
          ? failureKind
          : undefined;
    if (kind === undefined) throw error;
    return { status: "failed", error: { kind, message: MESSAGES[kind] } };
  }
}

function ignored(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    IGNORED_NAMES.has(lower) ||
    lower === ".env" ||
    lower.startsWith(".env.") ||
    /\.(?:pem|key|p12|pfx)$/i.test(name) ||
    /^\.ariel-.*\.tmp$/.test(name)
  );
}

function partsFor(path: string, allowRoot: boolean): string[] {
  if (allowRoot && path === "") return [];
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    /^[a-z]:/i.test(path)
  ) {
    throw new ProjectBoundaryFailure("invalid-path");
  }
  const parts = path.split("/");
  if (
    parts.some(
      (part) => part === "" || part === "." || part === ".." || ignored(part),
    )
  ) {
    throw new ProjectBoundaryFailure("invalid-path");
  }
  return parts;
}

function contains(root: string, path: string): boolean {
  const remainder = relative(root, path);
  return (
    remainder === "" ||
    (!isAbsolute(remainder) &&
      remainder !== ".." &&
      !remainder.startsWith("../") &&
      !remainder.startsWith("..\\"))
  );
}

function sameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function sameVersion(a: BigIntStats, b: BigIntStats): boolean {
  return (
    sameIdentity(a, b) &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.mode === b.mode &&
    a.uid === b.uid &&
    a.gid === b.gid &&
    a.nlink === b.nlink
  );
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decode(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (error) {
    if (error instanceof TypeError)
      throw new ProjectBoundaryFailure("file-read-failure");
    throw error;
  }
  if (text.includes("\0"))
    throw new ProjectBoundaryFailure("file-read-failure");
  return text;
}

interface CheckedPath {
  absolutePath: string;
  relativePath: string;
  stats: BigIntStats;
  parents: { path: string; stats: BigIntStats }[];
}

interface ReadSnapshot extends CheckedPath {
  snapshot: ProjectFileSnapshot;
  bytes: Uint8Array;
}

export async function openProjectFiles(
  rootPath: string,
): Promise<ProjectFilesResult<ProjectFiles>> {
  return operation("invalid-project", async () => {
    if (
      typeof rootPath !== "string" ||
      rootPath.length === 0 ||
      rootPath.includes("\0")
    ) {
      throw new ProjectBoundaryFailure("invalid-project");
    }
    if (
      typeof constants.O_NOFOLLOW !== "number" ||
      constants.O_NOFOLLOW === 0
    ) {
      throw new ProjectBoundaryFailure("invalid-project");
    }
    const root = await realpath(resolve(rootPath));
    const rootStats = await lstat(root, { bigint: true });
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new ProjectBoundaryFailure("invalid-project");
    }

    async function rootCheck(): Promise<void> {
      const current = await lstat(root, { bigint: true });
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        !sameIdentity(current, rootStats) ||
        (await realpath(root)) !== root
      ) {
        throw new ProjectBoundaryFailure("invalid-project");
      }
    }

    async function checked(
      path: string,
      allowRoot = false,
    ): Promise<CheckedPath> {
      const parts = partsFor(path, allowRoot);
      await rootCheck();
      const parents = [{ path: root, stats: rootStats }];
      let absolutePath = root;
      let stats = rootStats;
      for (const [index, part] of parts.entries()) {
        absolutePath = join(absolutePath, part);
        stats = await lstat(absolutePath, { bigint: true });
        if (
          stats.isSymbolicLink() ||
          !contains(root, absolutePath) ||
          (await realpath(absolutePath)) !== absolutePath
        ) {
          throw new ProjectBoundaryFailure("invalid-path");
        }
        if (index < parts.length - 1) {
          if (!stats.isDirectory())
            throw new ProjectBoundaryFailure("invalid-path");
          parents.push({ path: absolutePath, stats });
        }
      }
      return { absolutePath, relativePath: parts.join("/"), stats, parents };
    }

    async function checkParents(path: CheckedPath): Promise<void> {
      await rootCheck();
      for (const parent of path.parents) {
        const current = await lstat(parent.path, { bigint: true });
        if (
          !current.isDirectory() ||
          current.isSymbolicLink() ||
          !sameIdentity(current, parent.stats) ||
          !contains(root, parent.path) ||
          (await realpath(parent.path)) !== parent.path
        ) {
          throw new ProjectBoundaryFailure("invalid-path");
        }
      }
    }

    async function read(path: string): Promise<ReadSnapshot> {
      const item = await checked(path);
      if (
        !item.stats.isFile() ||
        item.stats.nlink !== 1n ||
        item.stats.size > BigInt(MAX_TEXT_BYTES)
      ) {
        throw new ProjectBoundaryFailure("file-read-failure");
      }
      const file = await open(
        item.absolutePath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await file.stat({ bigint: true });
        if (
          !before.isFile() ||
          before.nlink !== 1n ||
          !sameVersion(before, item.stats)
        ) {
          throw new ProjectBoundaryFailure("file-read-failure");
        }
        const buffer = new Uint8Array(Number(before.size) + 1);
        let length = 0;
        while (length < buffer.length) {
          const chunk = await file.read(
            buffer,
            length,
            buffer.length - length,
            length,
          );
          if (chunk.bytesRead === 0) break;
          length += chunk.bytesRead;
        }
        if (length !== Number(before.size))
          throw new ProjectBoundaryFailure("file-read-failure");
        const bytes = buffer.slice(0, length);
        const after = await file.stat({ bigint: true });
        await checkParents(item);
        const current = await lstat(item.absolutePath, { bigint: true });
        if (
          current.isSymbolicLink() ||
          !sameVersion(before, after) ||
          !sameVersion(before, current)
        ) {
          throw new ProjectBoundaryFailure("file-read-failure");
        }
        return {
          ...item,
          stats: after,
          bytes,
          snapshot: {
            relativePath: item.relativePath,
            sourceText: decode(bytes),
            hash: hash(bytes),
          },
        };
      } finally {
        await file.close();
      }
    }

    async function cleanup(
      tempPath: string,
      expected: BigIntStats | undefined,
      original: ReadSnapshot,
    ): Promise<void> {
      if (expected === undefined) return;
      try {
        await checkParents(original);
        const current = await lstat(tempPath, { bigint: true });
        if (
          current.isFile() &&
          !current.isSymbolicLink() &&
          sameIdentity(current, expected)
        ) {
          await unlink(tempPath);
        }
      } catch (error) {
        // A changed parent must never redirect cleanup to an unrelated path.
        if (error instanceof ProjectBoundaryFailure || expectedIO(error))
          return;
        throw error;
      }
    }

    async function replace(
      original: ReadSnapshot,
      nextText: string,
      staleKind: "stale-proposal" | "stale-undo",
    ): Promise<ProjectFileSnapshot> {
      if (nextText.includes("\0"))
        throw new ProjectBoundaryFailure("invalid-proposal");
      const bytes = new TextEncoder().encode(nextText);
      if (bytes.length > MAX_TEXT_BYTES || decode(bytes) !== nextText)
        throw new ProjectBoundaryFailure("invalid-proposal");
      if ((original.stats.mode & 0o7000n) !== 0n)
        throw new ProjectBoundaryFailure("file-write-failure");
      const tempPath = join(
        dirname(original.absolutePath),
        `.ariel-${randomUUID()}.tmp`,
      );
      let tempStats: BigIntStats | undefined;
      let committed = false;
      try {
        await checkParents(original);
        // copyFile preserves the existing mode despite process umask; no chmod API is used.
        await copyFile(
          original.absolutePath,
          tempPath,
          constants.COPYFILE_EXCL,
        );
        tempStats = await lstat(tempPath, { bigint: true });
        if (
          !tempStats.isFile() ||
          tempStats.nlink !== 1n ||
          tempStats.mode !== original.stats.mode ||
          tempStats.uid !== original.stats.uid ||
          tempStats.gid !== original.stats.gid
        ) {
          throw new ProjectBoundaryFailure("file-write-failure");
        }
        await checkParents(original);
        const temporary = await open(
          tempPath,
          constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          if (!sameVersion(await temporary.stat({ bigint: true }), tempStats)) {
            throw new ProjectBoundaryFailure("file-write-failure");
          }
          await temporary.truncate(0);
          await temporary.writeFile(bytes);
          await temporary.sync();
          const written = await temporary.stat({ bigint: true });
          if (
            !sameIdentity(written, tempStats) ||
            written.nlink !== 1n ||
            written.size !== BigInt(bytes.length) ||
            written.mode !== original.stats.mode ||
            written.uid !== original.stats.uid ||
            written.gid !== original.stats.gid
          ) {
            throw new ProjectBoundaryFailure("file-write-failure");
          }
          tempStats = written;
        } finally {
          await temporary.close();
        }
        const latest = await read(original.relativePath);
        if (
          !sameVersion(latest.stats, original.stats) ||
          latest.snapshot.hash !== original.snapshot.hash
        ) {
          throw new ProjectBoundaryFailure(staleKind);
        }
        await checkParents(original);
        const currentTemp = await lstat(tempPath, { bigint: true });
        if (
          !sameVersion(currentTemp, tempStats) ||
          currentTemp.isSymbolicLink()
        ) {
          throw new ProjectBoundaryFailure("file-write-failure");
        }
        await rename(tempPath, original.absolutePath);
        committed = true;
        return {
          relativePath: original.relativePath,
          sourceText: nextText,
          hash: hash(bytes),
        };
      } finally {
        if (!committed) await cleanup(tempPath, tempStats, original);
      }
    }

    let writes: Promise<void> = Promise.resolve();
    function writeOperation<T>(
      action: () => Promise<ProjectFilesResult<T>>,
    ): Promise<ProjectFilesResult<T>> {
      const result = writes.then(action);
      writes = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }

    return {
      rootPath: root,
      listDirectory(path = "") {
        return operation("directory-read-failure", async () => {
          const directory = await checked(path, true);
          if (!directory.stats.isDirectory())
            throw new ProjectBoundaryFailure("directory-read-failure");
          const entries: ProjectDirectoryEntry[] = [];
          for (const entry of await readdir(directory.absolutePath, {
            withFileTypes: true,
          })) {
            if (
              ignored(entry.name) ||
              entry.isSymbolicLink() ||
              (!entry.isDirectory() && !entry.isFile())
            )
              continue;
            const childPath =
              path === "" ? entry.name : `${path}/${entry.name}`;
            const child = await checked(childPath);
            if (child.stats.isDirectory())
              entries.push({
                name: entry.name,
                relativePath: childPath,
                type: "directory",
              });
            else if (child.stats.isFile() && child.stats.nlink === 1n)
              entries.push({
                name: entry.name,
                relativePath: childPath,
                type: "file",
              });
          }
          await checkParents(directory);
          const latest = await lstat(directory.absolutePath, { bigint: true });
          if (
            !latest.isDirectory() ||
            !sameIdentity(latest, directory.stats) ||
            latest.isSymbolicLink()
          ) {
            throw new ProjectBoundaryFailure("invalid-path");
          }
          return entries.sort((a, b) =>
            a.type !== b.type
              ? a.type === "directory"
                ? -1
                : 1
              : a.name < b.name
                ? -1
                : a.name > b.name
                  ? 1
                  : 0,
          );
        });
      },
      readFile(path) {
        return operation(
          "file-read-failure",
          async () => (await read(path)).snapshot,
        );
      },
      applyProposal(snapshot, proposal) {
        return writeOperation(() =>
          operation("file-write-failure", async () => {
            const current = await read(snapshot.relativePath);
            if (
              current.snapshot.hash !== snapshot.hash ||
              current.snapshot.sourceText !== snapshot.sourceText
            ) {
              throw new ProjectBoundaryFailure("stale-proposal");
            }
            if (
              typeof proposal.oldText !== "string" ||
              typeof proposal.newText !== "string" ||
              proposal.oldText.length === 0 ||
              proposal.oldText === proposal.newText
            ) {
              throw new ProjectBoundaryFailure("invalid-proposal");
            }
            const start = current.snapshot.sourceText.indexOf(proposal.oldText);
            if (
              start === -1 ||
              current.snapshot.sourceText.indexOf(
                proposal.oldText,
                start + 1,
              ) !== -1
            ) {
              throw new ProjectBoundaryFailure("invalid-proposal");
            }
            const nextText =
              current.snapshot.sourceText.slice(0, start) +
              proposal.newText +
              current.snapshot.sourceText.slice(
                start + proposal.oldText.length,
              );
            const after = await replace(current, nextText, "stale-proposal");
            return {
              snapshot: after,
              undo: {
                relativePath: current.relativePath,
                beforeText: current.snapshot.sourceText,
                afterText: after.sourceText,
                afterHash: after.hash,
              },
            };
          }),
        );
      },
      undoApply(record) {
        return writeOperation(() =>
          operation("file-write-failure", async () => {
            const current = await read(record.relativePath);
            if (
              current.snapshot.hash !== record.afterHash ||
              current.snapshot.sourceText !== record.afterText
            ) {
              throw new ProjectBoundaryFailure("stale-undo");
            }
            return replace(current, record.beforeText, "stale-undo");
          }),
        );
      },
    };
  });
}
