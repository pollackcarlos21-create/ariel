import { expect, test } from "bun:test";
import { resolve } from "node:path";
import ts from "typescript";

test("core's own tsconfig rejects Bun, Node and DOM ambient globals", () => {
  const directory = resolve(import.meta.dir, "../packages/core");
  const config = ts.readConfigFile(
    resolve(directory, "tsconfig.json"),
    ts.sys.readFile,
  );
  expect(config.error).toBeUndefined();
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    directory,
  );
  expect(parsed.errors).toEqual([]);
  const entry = resolve(directory, "src/index.ts");
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  // Substitute only in memory: exercise the real core configuration without editing source.
  host.getSourceFile = (
    file,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) =>
    file === entry
      ? ts.createSourceFile(
          file,
          "export type HostGlobals = [typeof Bun, typeof process, typeof document];",
          ts.ScriptTarget.Latest,
          true,
        )
      : getSourceFile(
          file,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  const messages = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
  for (const name of ["Bun", "process", "document"]) {
    expect(
      messages.some((message) =>
        message.includes(`Cannot find name '${name}'`),
      ),
    ).toBe(true);
  }
});
