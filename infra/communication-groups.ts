import { COMMUNICATION_GROUP_REFRESH_SCHEDULE } from "./config/communication.js";

export function createCommunicationGroupResources(options: {
  communicationTable: sst.aws.Dynamo;
  production: boolean;
  region: string;
}) {
  const refresher = new sst.aws.Cron("CommunicationGroupDirectoryRefresh", {
    schedule: COMMUNICATION_GROUP_REFRESH_SCHEDULE,
    function: {
      handler: "packages/backend/src/functions/communication/refresh-group-directory.handler",
      runtime: "nodejs24.x",
      link: [options.communicationTable],
      permissions: [
        {
          actions: ["dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem"],
          resources: [options.communicationTable.arn],
        },
        {
          actions: ["ssm:GetParameter"],
          resources: [
            `arn:aws:ssm:${options.region}:*:parameter/utility-services/${$app.stage}/communication/*`,
          ],
        },
      ],
      transform: { function: { tracingConfig: { mode: "Active" } } },
    },
  });
  return { refresher };
}
