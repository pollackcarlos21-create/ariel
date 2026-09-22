import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dir, "..");
const workspaces: Record<string, { directory: string; allowed: string[] }> = {
  "@ariel/core": { directory: "packages/core", allowed: [] },
  "@ariel/providers": {
    directory: "packages/providers",
    allowed: ["@ariel/core"],
  },
  "@ariel/local-host": {
    directory: "packages/local-host",
    allowed: ["@ariel/core", "@ariel/providers"],
  },
  "@ariel/cli": {
    directory: "apps/cli",
    allowed: ["@ariel/core", "@ariel/local-host"],
  },
};

interface Manifest {
  name: string;
  type: string;
  exports: Record<string, string>;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function readManifest(directory: string): Manifest {
  return JSON.parse(
    readFileSync(resolve(root, directory, "package.json"), "utf8"),
  );
}

function dependencyIssues(
  name: string,
  dependencies: Record<string, string>,
): string[] {
  const workspace = workspaces[name];
  if (!workspace) throw new Error(`Unknown workspace: ${name}`);
  const issues: string[] = [];
  for (const [dependency, version] of Object.entries(dependencies)) {
    if (dependency.startsWith("@ariel/")) {
      if (!workspace.allowed.includes(dependency))
        issues.push(`Forbidden dependency: ${name} -> ${dependency}`);
      if (version !== "workspace:*")
        issues.push(`Internal dependency must use workspace:*: ${dependency}`);
    } else if (name === "@ariel/core") {
      issues.push(
        `Core must remain dependency-free in this milestone: ${dependency}`,
      );
    }
  }
  return issues;
}

function hasCycle(graph: Record<string, string[]>): boolean {
  const active = new Set<string>();
  const done = new Set<string>();
  function visit(name: string): boolean {
    if (active.has(name)) return true;
    if (done.has(name)) return false;
    active.add(name);
    for (const dependency of graph[name] ?? []) {
      if (visit(dependency)) return true;
    }
    active.delete(name);
    done.add(name);
    return false;
  }
  return Object.keys(graph).some(visit);
}

function sourceIssues(
  name: string,
  file: string,
  text: string,
  dependencies: Record<string, string>,
): string[] {
  const workspace = workspaces[name];
  if (!workspace) throw new Error(`Unknown workspace: ${name}`);
  const issues: string[] = [];
  const sourceRoot = resolve(root, workspace.directory, "src");
  const allowed = workspace.allowed;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  function checkImport(specifier: string): void {
    if (specifier.startsWith(".")) {
      const path = relative(sourceRoot, resolve(dirname(file), specifier));
      if (path === ".." || path.startsWith("../") || isAbsolute(path)) {
        issues.push(
          `Import leaves workspace src; use a public package export: ${specifier}`,
        );
      }
      return;
    }
    if (specifier.startsWith("@ariel/")) {
      if (!allowed.includes(specifier))
        issues.push(`Forbidden workspace import or deep import: ${specifier}`);
      if (!(specifier in dependencies))
        issues.push(`Undeclared workspace import: ${specifier}`);
      return;
    }
    if (name === "@ariel/core") {
      issues.push(
        `Core cannot import runtime modules or external implementations: ${specifier}`,
      );
      return;
    }
    if (
      isBuiltin(specifier) ||
      specifier === "bun" ||
      specifier.startsWith("bun:")
    )
      return;
    const packageName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    if (!packageName || !(packageName in dependencies))
      issues.push(`Undeclared or unsupported import: ${specifier}`);
  }

  function visit(node: ts.Node): void {
    if (
      name === "@ariel/core" &&
      ts.isIdentifier(node) &&
      node.text === "Bun"
    ) {
      issues.push("Core cannot reference the Bun runtime");
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkImport(node.moduleSpecifier.text);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      checkImport(node.argument.literal.text);
    }
    if (ts.isImportEqualsDeclaration(node)) issues.push("Use ESM imports");
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      )
        issues.push("Use ESM imports");
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (
          argument &&
          (ts.isStringLiteral(argument) ||
            ts.isNoSubstitutionTemplateLiteral(argument))
        )
          checkImport(argument.text);
        else
          issues.push(
            "Dynamic imports must have a literal specifier for boundary checking",
          );
      }
    }
    ts.forEachChild(node, visit);
  }
  if (
    source.referencedFiles.length ||
    source.typeReferenceDirectives.length ||
    source.libReferenceDirectives.length
  ) {
    issues.push(
      "Do not bypass package or ambient-type boundaries with triple-slash references",
    );
  }
  visit(source);
  return issues;
}

test("exactly four workspaces with explicit source entry points and an acyclic dependency graph", () => {
  expect(readManifest(".").workspaces?.sort()).toEqual(
    Object.values(workspaces)
      .map((workspace) => workspace.directory)
      .sort(),
  );
  const graph: Record<string, string[]> = {};
  for (const [name, workspace] of Object.entries(workspaces)) {
    const manifest = readManifest(workspace.directory);
    expect(manifest.name).toBe(name);
    expect(manifest.type).toBe("module");
    expect(manifest.exports).toEqual({ ".": "./src/index.ts" });
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    };
    for (const group of [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ]) {
      expect(dependencyIssues(name, group ?? {})).toEqual([]);
    }
    graph[name] = Object.keys(dependencies).filter((dependency) =>
      dependency.startsWith("@ariel/"),
    );
  }
  expect(hasCycle(graph)).toBe(false);
});

for (const [name, workspace] of Object.entries(workspaces)) {
  test(`${name} source respects package boundaries`, async () => {
    const manifest = readManifest(workspace.directory);
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    };
    const sourceRoot = resolve(root, workspace.directory, "src");
    const violations: string[] = [];
    let fileCount = 0;
    for await (const file of new Bun.Glob(
      "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
    ).scan({ cwd: sourceRoot, absolute: true })) {
      fileCount++;
      violations.push(
        ...sourceIssues(
          name,
          file,
          readFileSync(file, "utf8"),
          dependencies,
        ).map((issue) => `${relative(root, file)}: ${issue}`),
      );
    }
    expect(fileCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
}

describe("architecture guard regression cases", () => {
  test.each([
    ["@ariel/core", 'import "@ariel/providers";'],
    ["@ariel/core", 'export * from "@ariel/local-host";'],
    ["@ariel/core", 'type CLI = import("@ariel/cli");'],
    ["@ariel/core", 'import "bun:sqlite";'],
    ["@ariel/core", 'import "bun";'],
    ["@ariel/core", 'import "node:fs";'],
    ["@ariel/core", 'import "fs/promises";'],
    ["@ariel/core", 'Bun.file("file.txt");'],
    ["@ariel/core", 'globalThis.Bun.spawn(["sh"]);'],
    ["@ariel/core", 'import "some-provider-sdk";'],
    ["@ariel/providers", 'import "@ariel/local-host";'],
    ["@ariel/providers", "await import(`@ariel/cli`);"],
    ["@ariel/local-host", 'import "@ariel/cli";'],
    ["@ariel/cli", 'import "@ariel/providers";'],
    ["@ariel/cli", 'import "@ariel/core/src/index.ts";'],
    ["@ariel/providers", 'import "../../core/src/index.ts";'],
    ["@ariel/providers", 'const core = require("@ariel/core");'],
    ["@ariel/providers", 'import core = require("@ariel/core");'],
    ["@ariel/providers", "await import(target);"],
    ["@ariel/core", '/// <reference types="bun" />\nexport {};'],
  ])("rejects forbidden source in %s: %s", (name, source) => {
    const workspace = workspaces[name];
    if (!workspace) throw new Error(`Unknown workspace: ${name}`);
    const file = resolve(root, workspace.directory, "src/probe.ts");
    const dependencies = Object.fromEntries(
      workspace.allowed.map((dependency) => [dependency, "workspace:*"]),
    );
    expect(
      sourceIssues(name, file, source, dependencies).length,
    ).toBeGreaterThan(0);
  });

  test("rejects forbidden manifests and non-workspace versions", () => {
    expect(
      dependencyIssues("@ariel/core", { "@ariel/providers": "workspace:*" }),
    ).not.toEqual([]);
    expect(
      dependencyIssues("@ariel/providers", { "@ariel/core": "0.0.0" }),
    ).not.toEqual([]);
    expect(
      dependencyIssues("@ariel/core", { "provider-sdk": "1.0.0" }),
    ).not.toEqual([]);
  });

  test("detects indirect cycles and self-dependencies", () => {
    expect(hasCycle({ a: ["b"], b: ["c"], c: ["a"] })).toBe(true);
    expect(hasCycle({ a: ["a"] })).toBe(true);
    expect(hasCycle({ a: ["b", "c"], b: ["c"], c: [] })).toBe(false);
  });
});
