import { describe, expect, it, vi } from "vitest";

import { runFileWorker } from "./workers.js";

function metrics() {
  return { count: vi.fn(), gauge: vi.fn(), flush: vi.fn() };
}

describe("file worker observability", () => {
  it("records bounded completion summaries and flushes", async () => {
    const observed = metrics();
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(
      runFileWorker(
        "FileUploadReconciliation",
        () => Promise.resolve({ processed: 3, pages: 2 }),
        observed,
        logger,
      ),
    ).resolves.toEqual({ processed: 3, pages: 2 });
    expect(observed.count).toHaveBeenCalledWith("FileWorkerProcessed", "Success", 3);
    expect(observed.flush).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenLastCalledWith("file.worker.completed", {
      operation: "FileUploadReconciliation",
      processed: 3,
      pages: 2,
    });
  });

  it("records and rethrows transient failure without raw error detail", async () => {
    const observed = metrics();
    const logger = { info: vi.fn(), error: vi.fn() };
    const failure = new Error("private provider detail");
    await expect(
      runFileWorker("FileTrashPurge", async () => Promise.reject(failure), observed, logger),
    ).rejects.toBe(failure);
    expect(observed.count).toHaveBeenCalledWith("FileWorkerFailure", "Failed");
    expect(observed.flush).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private provider detail");
  });
});
