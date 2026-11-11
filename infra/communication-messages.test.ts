import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMMUNICATION_INGRESS_DLQ_COMPONENT_NAME,
  COMMUNICATION_INGRESS_QUEUE_COMPONENT_NAME,
  COMMUNICATION_MESSAGE_TABLE_COMPONENT_NAME,
} from "./config/communication-messages.js";
function output<T>(value: T): SstOutput<T> {
  return { apply: (fn) => output(fn(value)) };
}
afterEach(() => vi.unstubAllGlobals());
describe("communication message resources", () => {
  it("creates encrypted queue handoff with a bounded DLQ and least-privilege worker", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    class Dynamo {
      name = output("table");
      arn = output("table-arn");
      constructor(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
      }
    }
    class Queue {
      arn = output("queue-arn");
      url = output("queue-url");
      constructor(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
      }
      subscribe = vi.fn();
    }
    class Function {
      arn = output("worker-arn");
      constructor(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
      }
    }
    vi.stubGlobal("sst", { Linkable: { wrap: vi.fn() }, aws: { Dynamo, Queue, Function } });
    vi.resetModules();
    const { createCommunicationMessageResources } = await import("./communication-messages.js");
    const connectionTable = new Dynamo("connections", {});
    createCommunicationMessageResources({ production: true, connectionTable });
    expect(calls.map((call) => call.name)).toEqual(
      expect.arrayContaining([
        COMMUNICATION_MESSAGE_TABLE_COMPONENT_NAME,
        COMMUNICATION_INGRESS_DLQ_COMPONENT_NAME,
        COMMUNICATION_INGRESS_QUEUE_COMPONENT_NAME,
      ]),
    );
    const queue = calls.find((call) => call.name === COMMUNICATION_INGRESS_QUEUE_COMPONENT_NAME);
    expect(queue?.args).toMatchObject({ visibilityTimeout: "120 seconds", dlq: { retry: 2 } });
    const raw: Record<string, unknown> = {};
    (queue?.args["transform"] as { queue(args: Record<string, unknown>): void }).queue(raw);
    expect(raw["sqsManagedSseEnabled"]).toBe(true);
    const worker = calls.find((call) => call.name === "CommunicationIncomingTextProcessor");
    expect(worker?.args["link"]).toEqual(expect.arrayContaining([connectionTable]));
    expect(worker?.args["permissions"]).toEqual(
      expect.arrayContaining([
        { actions: ["dynamodb:TransactWriteItems"], resources: [expect.anything()] },
        { actions: ["dynamodb:GetItem"], resources: [connectionTable.arn] },
      ]),
    );
  });
});
