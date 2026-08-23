/* eslint-disable @typescript-eslint/unbound-method -- runtime surface assertions */
import { describe, expect, it, vi } from "vitest";

const linkedResourceReads = vi.hoisted(() => ({ usagePricingTable: 0 }));

vi.mock("sst", () => ({
  Resource: {
    ControlTable: { name: "ControlTable" },
    FileTable: { name: "FileTable" },
    FileBucket: { name: "private-file-bucket" },
    get UsagePricingTable() {
      linkedResourceReads.usagePricingTable += 1;
      return { name: "UsageTable" };
    },
  },
}));

import {
  createFileApiRuntime,
  createFileWorkerRuntime,
  getFileHandlers,
  getFileWorkerRuntime,
} from "./runtime.js";

describe("file management runtime", () => {
  it("validates linked names and composes separate API and worker dependencies", () => {
    const api = createFileApiRuntime({
      controlTableName: "ControlTable",
      fileTableName: "FileTable",
      bucketName: "private-file-bucket",
    });
    const worker = createFileWorkerRuntime({
      fileTableName: "FileTable",
      usageTableName: "UsageTable",
      bucketName: "private-file-bucket",
    });
    expect(api.authentication.authenticate).toBeTypeOf("function");
    expect(api.service.authorizeUpload).toBeTypeOf("function");
    expect(api.downloads.authorizePrivate).toBeTypeOf("function");
    expect(api.downloads.authorizePublic).toBeTypeOf("function");
    expect(api.projects.inspect).toBeTypeOf("function");
    expect("usage" in api).toBe(false);
    expect(worker.objectStore.head).toBeTypeOf("function");
    expect(worker.usage.recordUsage).toBeTypeOf("function");
    expect(() =>
      createFileApiRuntime({
        controlTableName: "",
        fileTableName: "FileTable",
        bucketName: "bucket",
      }),
    ).toThrow();
  });

  it("does not read the worker-only usage link while composing API handlers", () => {
    expect(linkedResourceReads.usagePricingTable).toBe(0);
    expect(getFileHandlers().authorizeUpload).toBeTypeOf("function");
    expect(getFileHandlers().authorizeDownload).toBeTypeOf("function");
    expect(getFileHandlers().publicDownload).toBeTypeOf("function");
    expect(linkedResourceReads.usagePricingTable).toBe(0);
    expect(getFileWorkerRuntime().usage.recordUsage).toBeTypeOf("function");
    expect(linkedResourceReads.usagePricingTable).toBe(1);
  });
});
