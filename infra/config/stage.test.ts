import { describe, expect, it } from "vitest";

import { StageValidationError, classifyStage } from "./stage.js";

describe("classifyStage", () => {
  it.each([
    ["production", "production", false],
    ["pr-1", "pull-request", true],
    ["pr-2048", "pull-request", true],
    ["dev-plan", "development", true],
    ["dev-noam-2", "development", true],
  ] as const)("classifies %s", (name, kind, ephemeral) => {
    expect(classifyStage(name)).toEqual({ name, kind, ephemeral });
  });

  it.each([
    undefined,
    null,
    "",
    "Production",
    "prod",
    "main",
    "pr-0",
    "pr-01",
    "dev-Upper",
    "dev-with_underscore",
    `dev-${"a".repeat(60)}`,
  ])("rejects invalid stage %s", (stage) => {
    expect(() => classifyStage(stage)).toThrow(StageValidationError);
  });
});
