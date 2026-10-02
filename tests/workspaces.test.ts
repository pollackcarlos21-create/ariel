import { expect, test } from "bun:test";
import * as cli from "@ariel/cli";
import * as core from "@ariel/core";
import * as localHost from "@ariel/local-host";
import * as providers from "@ariel/providers";
import * as tui from "@ariel/tui";

test("all five public workspace entries resolve and load without starting terminal UI", () => {
  for (const workspace of [core, providers, localHost, cli, tui]) {
    expect(typeof workspace).toBe("object");
  }
  expect(typeof tui.launchTui).toBe("function");
});

test.each([
  "@ariel/core",
  "@ariel/providers",
  "@ariel/local-host",
  "@ariel/cli",
  "@ariel/tui",
])("%s does not export internal source paths", (name) => {
  expect(() =>
    Bun.resolveSync(`${name}/src/index.ts`, import.meta.dir),
  ).toThrow();
});
