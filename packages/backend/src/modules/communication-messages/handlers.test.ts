import { describe, expect, it, vi } from "vitest";
import { createReceiveGreenWebhookHandler } from "./handlers.js";
import type { createCommunicationMessageService } from "./service.js";
const base = {
  typeWebhook: "incomingMessageReceived",
  instanceData: { idInstance: "1" },
  idMessage: "m1",
  timestamp: 1_704_067_200,
  senderData: { chatId: "1@g.us", sender: "1@g.us" },
  messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "hello" } },
};
const event = (
  body: unknown,
  headers: Record<string, string> = { authorization: "Bearer token" },
) => ({
  requestContext: { requestId: "request", http: { method: "POST", path: "/x" } },
  pathParameters: { connectionId: "con_abcdefghijklmnopqrstuv" },
  headers,
  body: JSON.stringify(body),
});
describe("GREEN webhook handler", () => {
  it("queues authenticated group text", async () => {
    const receive = vi.fn().mockResolvedValue(undefined);
    const handler = createReceiveGreenWebhookHandler({ receive } as unknown as ReturnType<
      typeof createCommunicationMessageService
    >);
    expect((await handler(event(base))).statusCode).toBe(200);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ bearer: "token" }));
  });
  it("rejects direct and malformed messages", async () => {
    const receive = vi.fn();
    const handler = createReceiveGreenWebhookHandler({ receive } as unknown as ReturnType<
      typeof createCommunicationMessageService
    >);
    expect((await handler(event({ ...base, senderData: { chatId: "1@c.us" } }))).statusCode).toBe(
      400,
    );
    expect((await handler(event({ nope: true }))).statusCode).toBe(400);
    expect(receive).not.toHaveBeenCalled();
  });
  it("accepts the provider's capitalized authorization spelling and passes absent auth through", async () => {
    const receive = vi.fn().mockResolvedValue(undefined);
    const handler = createReceiveGreenWebhookHandler({ receive } as unknown as ReturnType<
      typeof createCommunicationMessageService
    >);
    await handler(event(base, { Authorization: "Bearer alternate" }));
    await handler(event(base, {}));
    expect(receive).toHaveBeenNthCalledWith(1, expect.objectContaining({ bearer: "alternate" }));
    expect(receive).toHaveBeenNthCalledWith(2, expect.objectContaining({ bearer: undefined }));
  });
});
