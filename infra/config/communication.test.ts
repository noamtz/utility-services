import { describe, expect, it } from "vitest";
import { COMMUNICATION_CONNECTION_TABLE_POLICY, COMMUNICATION_CONTROL_ROUTES } from "./communication.js";

describe("communication infrastructure policy", () => {
  it("uses an independent on-demand table and narrow owner-control actions", () => {
    expect(COMMUNICATION_CONNECTION_TABLE_POLICY.primaryIndex).toEqual({ hashKey: "pk", rangeKey: "sk" });
    expect(COMMUNICATION_CONTROL_ROUTES).toHaveLength(4);
    expect(COMMUNICATION_CONTROL_ROUTES[0]?.connectionTableActions).toEqual(["dynamodb:TransactWriteItems"]);
    expect(COMMUNICATION_CONTROL_ROUTES[0]?.parameterActions).toEqual(["ssm:PutParameter", "ssm:DeleteParameter"]);
    expect(JSON.stringify(COMMUNICATION_CONTROL_ROUTES)).not.toContain("*");
  });
});
