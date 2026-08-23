export const DYNAMO_LINK_BASELINE_ACTIONS = ["dynamodb:Query"] as const;

let dynamoLinkConfigured = false;

export function configureLeastPrivilegeDynamoLink(): void {
  if (dynamoLinkConfigured) return;
  sst.Linkable.wrap(sst.aws.Dynamo, (table) => ({
    properties: { name: table.name },
    include: [
      sst.aws.permission({
        actions: [...DYNAMO_LINK_BASELINE_ACTIONS],
        resources: [table.arn, $interpolate`${table.arn}/index/*`],
      }),
    ],
  }));
  dynamoLinkConfigured = true;
}
