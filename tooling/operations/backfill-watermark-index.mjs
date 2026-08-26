// @ts-nocheck -- operator inputs are runtime-validated and behavior is covered by focused tests.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Resource } from "sst";
import { z } from "zod";

const StageSchema = z.string().regex(/^(?:dev|pr)-[a-z0-9][a-z0-9-]*$|^production$/u);
const WatermarkSchema = z.object({
  pk: z.string().startsWith("PROJECT#"),
  sk: z.string().startsWith("WATERMARK#"),
  itemType: z.literal("usage-watermark"),
  internalProjectId: z.uuid(),
  sourceKind: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
  lastMeteredAt: z.iso.datetime({ offset: true }),
  gsi1pk: z.string().optional(),
  gsi1sk: z.string().optional(),
});

function readFlags(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      flags.set(argument, true);
      continue;
    }
    if (!argument?.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`Invalid operator argument "${argument ?? ""}".`);
    }
    if (flags.has(argument)) throw new Error(`Duplicate operator argument "${argument}".`);
    flags.set(argument, argv[index + 1]);
    index += 1;
  }
  return flags;
}

export function parseBackfillArguments(argv) {
  const flags = readFlags(argv);
  for (const key of flags.keys()) {
    if (!["--stage-name", "--apply", "--confirm"].includes(key)) {
      throw new Error(`Unknown option "${key}".`);
    }
  }
  const stage = StageSchema.parse(flags.get("--stage-name"));
  const apply = flags.get("--apply") === true;
  const expectedConfirmation = `APPLY:${stage}:watermark-index`;
  if (apply && flags.get("--confirm") !== expectedConfirmation) {
    throw new Error(`Mutation requires --confirm ${expectedConfirmation}.`);
  }
  if (!apply && flags.has("--confirm")) throw new Error("--confirm is valid only with --apply.");
  return Object.freeze({ stage, apply });
}

function indexKeys(item) {
  return {
    gsi1pk: `WATERMARK#${item.sourceKind}`,
    gsi1sk: `${item.lastMeteredAt}#${item.internalProjectId}`,
  };
}

export async function executeWatermarkBackfill(
  argv,
  operations,
  write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
) {
  const input = parseBackfillArguments(argv);
  const counts = new Map();
  let examined = 0;
  let pending = 0;
  let applied = 0;
  let cursor;
  do {
    const page = await operations.listWatermarks(cursor);
    cursor = page.cursor;
    for (const itemInput of page.items) {
      const item = WatermarkSchema.parse(itemInput);
      examined += 1;
      counts.set(item.sourceKind, (counts.get(item.sourceKind) ?? 0) + 1);
      const expected = indexKeys(item);
      if (item.gsi1pk === expected.gsi1pk && item.gsi1sk === expected.gsi1sk) continue;
      pending += 1;
      if (input.apply) {
        await operations.updateWatermark(item, expected);
        applied += 1;
      }
    }
  } while (cursor);
  const result = Object.freeze({
    stage: input.stage,
    mode: input.apply ? "apply" : "dry-run",
    examined,
    pending,
    applied,
    sourceCounts: Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
  });
  write(result);
  return result;
}

function createOperations(tableName) {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return {
    async listWatermarks(cursor) {
      const output = await client.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: "itemType = :type",
          ProjectionExpression:
            "pk, sk, itemType, internalProjectId, sourceKind, lastMeteredAt, gsi1pk, gsi1sk",
          ExpressionAttributeValues: { ":type": "usage-watermark" },
          ...(cursor ? { ExclusiveStartKey: cursor } : {}),
        }),
      );
      return {
        items: output.Items ?? [],
        ...(output.LastEvaluatedKey ? { cursor: output.LastEvaluatedKey } : {}),
      };
    },
    async updateWatermark(item, keys) {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: item.pk, sk: item.sk },
          UpdateExpression: "SET gsi1pk = :gsi1pk, gsi1sk = :gsi1sk",
          ConditionExpression:
            "itemType = :type AND internalProjectId = :internal AND sourceKind = :source AND lastMeteredAt = :metered",
          ExpressionAttributeValues: {
            ":type": "usage-watermark",
            ":internal": item.internalProjectId,
            ":source": item.sourceKind,
            ":metered": item.lastMeteredAt,
            ":gsi1pk": keys.gsi1pk,
            ":gsi1sk": keys.gsi1sk,
          },
        }),
      );
    },
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  executeWatermarkBackfill(
    process.argv.slice(2),
    createOperations(Resource.UsagePricingTable.name),
  ).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Watermark backfill failed."}\n`,
    );
    process.exitCode = 1;
  });
}
