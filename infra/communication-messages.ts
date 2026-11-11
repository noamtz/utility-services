import { configureLeastPrivilegeDynamoLink } from "./dynamo-link.js";
import {
  COMMUNICATION_INGRESS_DLQ_COMPONENT_NAME,
  COMMUNICATION_INGRESS_QUEUE_COMPONENT_NAME,
  COMMUNICATION_MESSAGE_TABLE_COMPONENT_NAME,
  COMMUNICATION_MESSAGE_TABLE_POLICY,
} from "./config/communication-messages.js";
export function createCommunicationMessageResources(options: { production: boolean }) {
  configureLeastPrivilegeDynamoLink();
  const table = new sst.aws.Dynamo(COMMUNICATION_MESSAGE_TABLE_COMPONENT_NAME, {
    ...COMMUNICATION_MESSAGE_TABLE_POLICY,
    deletionProtection: options.production,
  });
  const deadLetterQueue = new sst.aws.Queue(COMMUNICATION_INGRESS_DLQ_COMPONENT_NAME, {
    transform: {
      queue(args) {
        args.messageRetentionSeconds = 1_209_600;
        args.sqsManagedSseEnabled = true;
      },
    },
  });
  const queue = new sst.aws.Queue(COMMUNICATION_INGRESS_QUEUE_COMPONENT_NAME, {
    visibilityTimeout: "120 seconds",
    dlq: { queue: deadLetterQueue.arn, retry: 2 },
    transform: {
      queue(args) {
        args.sqsManagedSseEnabled = true;
      },
    },
  });
  const worker = new sst.aws.Function("CommunicationIncomingTextProcessor", {
    handler: "packages/backend/src/functions/communication/process-incoming-text.handler",
    runtime: "nodejs24.x",
    link: [table],
    permissions: [{ actions: ["dynamodb:TransactWriteItems"], resources: [table.arn] }],
    transform: { function: { tracingConfig: { mode: "Active" } } },
  });
  const subscription = queue.subscribe(worker.arn, { batch: { size: 1, partialResponses: true } });
  return { table, queue, deadLetterQueue, worker, subscription };
}
