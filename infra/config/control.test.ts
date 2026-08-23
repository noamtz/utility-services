import { describe, expect, it } from "vitest";

import {
  CONTROL_ROUTES,
  CONTROL_TABLE_LINK_ACTIONS,
  CONTROL_TABLE_POLICY,
  DASHBOARD_CONTROL_POLICY,
  USER_POOL_CLIENT_POLICY,
  USER_POOL_POLICY,
  controlTableDeletionProtection,
} from "./control.js";

describe("identity/control infrastructure policy", () => {
  it("defines one admin-create-only email pool and secretless SRP client", () => {
    expect(USER_POOL_POLICY).toEqual({ usernames: ["email"], allowAdminCreateUserOnly: true });
    expect(USER_POOL_CLIENT_POLICY).toEqual({
      generateSecret: false,
      oauthEnabled: false,
      explicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
      preventUserExistenceErrors: "ENABLED",
    });
    expect(JSON.stringify({ USER_POOL_POLICY, USER_POOL_CLIENT_POLICY })).not.toMatch(
      /domain|clientSecret|temporaryPassword/i,
    );
  });

  it("defines the on-demand project table and owner query index", () => {
    expect(CONTROL_TABLE_POLICY.billingMode).toBe("PAY_PER_REQUEST");
    expect(CONTROL_TABLE_POLICY.primaryIndex).toEqual({ hashKey: "pk", rangeKey: "sk" });
    expect(CONTROL_TABLE_POLICY.globalIndexes).toEqual({
      OwnerProjects: { hashKey: "gsi1pk", rangeKey: "gsi1sk", projection: "all" },
    });
    expect(CONTROL_TABLE_LINK_ACTIONS).toEqual(["dynamodb:Query"]);
    expect(CONTROL_TABLE_LINK_ACTIONS).not.toContain("dynamodb:TransactWriteItems");
    expect(CONTROL_TABLE_LINK_ACTIONS).not.toContain("dynamodb:Scan");
  });

  it("enables table deletion protection only in production", () => {
    expect(controlTableDeletionProtection(true)).toBe(true);
    expect(controlTableDeletionProtection(false)).toBe(false);
  });

  it("defines exactly seven owner-authorized control routes", () => {
    expect(CONTROL_ROUTES.map(({ route }) => route)).toEqual([
      "POST /v1/control/projects",
      "GET /v1/control/projects",
      "GET /v1/control/projects/{projectId}",
      "POST /v1/control/projects/{projectId}/api-keys",
      "GET /v1/control/projects/{projectId}/api-keys",
      "DELETE /v1/control/projects/{projectId}/api-keys/{keyId}",
      "POST /v1/control/projects/{projectId}/api-keys/{keyId}/replace",
    ]);
    expect(
      CONTROL_ROUTES.map(({ name, additionalTableActions }) => [name, additionalTableActions]),
    ).toEqual([
      ["CreateProjectRoute", ["dynamodb:PutItem"]],
      ["ListProjectsRoute", []],
      ["InspectProjectRoute", []],
      [
        "IssueProjectApiKeyRoute",
        ["dynamodb:ConditionCheckItem", "dynamodb:GetItem", "dynamodb:PutItem"],
      ],
      ["ListProjectApiKeysRoute", ["dynamodb:GetItem"]],
      ["RevokeProjectApiKeyRoute", ["dynamodb:GetItem", "dynamodb:UpdateItem"]],
      [
        "ReplaceProjectApiKeyRoute",
        ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
      ],
    ]);
    expect(JSON.stringify(CONTROL_ROUTES)).not.toContain("dynamodb:TransactWriteItems");
    expect(JSON.stringify(CONTROL_ROUTES)).not.toContain("*");
  });

  it("forwards only the narrow no-cache control path and required request values", () => {
    expect(DASHBOARD_CONTROL_POLICY).toEqual({
      pathPattern: "v1/control/*",
      allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
      cachedMethods: ["GET", "HEAD"],
      viewerProtocolPolicy: "redirect-to-https",
      originProtocolPolicy: "https-only",
      originSslProtocols: ["TLSv1.2"],
      minTtl: 0,
      defaultTtl: 0,
      maxTtl: 0,
      headers: ["Authorization", "Content-Type"],
      queryStrings: ["limit", "cursor"],
      cookieBehavior: "none",
    });
    expect(DASHBOARD_CONTROL_POLICY.pathPattern).not.toBe("v1/*");
    expect(DASHBOARD_CONTROL_POLICY.headers).not.toContain("*");
    expect(DASHBOARD_CONTROL_POLICY.queryStrings).not.toContain("*");
    expect(CONTROL_ROUTES.some(({ route }) => /^(PUT|PATCH) /.test(route))).toBe(false);
    expect(CONTROL_ROUTES.filter(({ route }) => route.startsWith("DELETE "))).toHaveLength(1);
  });
});
