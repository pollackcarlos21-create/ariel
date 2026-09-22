import { expect, test } from "bun:test";
import * as cli from "@ariel/cli";
import * as core from "@ariel/core";
import * as localHost from "@ariel/local-host";
import * as providers from "@ariel/providers";

test("all four public workspace entries resolve and load", () => {
  for (const workspace of [core, providers, localHost, cli]) {
    expect(typeof workspace).toBe("object");
  }
});

test.each([
  "@ariel/core",
  "@ariel/providers",
  "@ariel/local-host",
  "@ariel/cli",
])("%s does not export internal source paths", (name) => {
  expect(() =>
    Bun.resolveSync(`${name}/src/index.ts`, import.meta.dir),
  ).toThrow();
});
