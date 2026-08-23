import { describe, expect, it, vi } from "vitest";

import { parseSstInvocation, runSst } from "./run-sst.mjs";

describe("parseSstInvocation", () => {
  it.each([
    [["install", "--stage", "dev-plan"], "install", "dev-plan"],
    [["diff", "--json", "--stage=pr-42"], "diff", "pr-42"],
    [["deploy", "--stage", "dev-plan"], "deploy", "dev-plan"],
    [["dev", "--stage", "dev-noam"], "dev", "dev-noam"],
  ] as const)("accepts an allowlisted command", (argv, command, stage) => {
    expect(parseSstInvocation([...argv])).toMatchObject({
      command,
      stage: { name: stage },
    });
  });

  const unsafeInvocations: string[][] = [
    [],
    ["remove", "--stage", "dev-plan"],
    ["diff"],
    ["diff", "--stage", "dev-one", "--stage=dev-two"],
    ["diff", "--stage", "main"],
    ["dev", "--stage", "production"],
    ["deploy", "--stage", "production"],
  ];

  it.each(unsafeInvocations.map((argv) => [argv] as const))(
    "rejects unsafe invocation %j",
    (argv) => {
      expect(() => parseSstInvocation(argv)).toThrow();
    },
  );
});

describe("runSst", () => {
  it("does not spawn SST when validation fails", () => {
    const spawn = vi.fn();

    expect(() => runSst(["remove", "--stage", "dev-plan"], spawn)).toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns the pinned local CLI without a shell and preserves arguments", () => {
    const spawn = vi.fn((...parameters: [string, string[], object]) => {
      expect(parameters).toHaveLength(3);
      return { status: 0 };
    });

    expect(runSst(["diff", "--json", "--stage", "dev-plan"], spawn)).toBe(0);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["diff", "--json", "--stage", "dev-plan"]),
    );
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({ shell: false, stdio: "inherit" });
  });
});
