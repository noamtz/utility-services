import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { createProjectRateLimitWindow } from "./model.js";
import { createDynamoProjectRateLimitRepository } from "./repository.js";

const window = createProjectRateLimitWindow(
  "11111111-1111-4111-8111-111111111111",
  new Date("2026-08-25T10:00:00.000Z"),
);

describe("Dynamo project rate-limit repository", () => {
  it("admits with one conditional atomic increment", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = createDynamoProjectRateLimitRepository({
      client: { send },
      tableName: "Control",
    });
    await expect(repository.admit(window)).resolves.toBe("admitted");
    const command = send.mock.calls[0]?.[0] as UpdateCommand;
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input).toMatchObject({
      TableName: "Control",
      Key: { pk: window.pk, sk: window.sk },
      ExpressionAttributeValues: { ":limit": 60, ":one": 1, ":zero": 0 },
    });
    expect(command.input.UpdateExpression).toContain("if_not_exists(requestCount, :zero) + :one");
  });

  it("maps only conditional denial to limited", async () => {
    const conditional = Object.assign(new Error("private"), {
      name: "ConditionalCheckFailedException",
    });
    const limited = createDynamoProjectRateLimitRepository({
      client: { send: vi.fn().mockRejectedValue(conditional) },
      tableName: "Control",
    });
    await expect(limited.admit(window)).resolves.toBe("limited");

    const failed = createDynamoProjectRateLimitRepository({
      client: { send: vi.fn().mockRejectedValue(new Error("unavailable")) },
      tableName: "Control",
    });
    await expect(failed.admit(window)).rejects.toThrow("unavailable");
  });
});
