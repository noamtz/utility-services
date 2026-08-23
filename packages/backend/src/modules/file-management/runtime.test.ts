/* eslint-disable @typescript-eslint/unbound-method -- runtime surface assertions */
import { describe, expect, it } from "vitest";

import { createFileManagementRuntime } from "./runtime.js";

describe("file management runtime", () => {
  it("validates linked names and composes API and worker dependencies", () => {
    const runtime = createFileManagementRuntime({
      controlTableName: "ControlTable",
      fileTableName: "FileTable",
      usageTableName: "UsageTable",
      bucketName: "private-file-bucket",
    });
    expect(runtime.authentication.authenticate).toBeTypeOf("function");
    expect(runtime.service.authorizeUpload).toBeTypeOf("function");
    expect(runtime.objectStore.head).toBeTypeOf("function");
    expect(runtime.usage.recordUsage).toBeTypeOf("function");
    expect(() =>
      createFileManagementRuntime({
        controlTableName: "",
        fileTableName: "FileTable",
        usageTableName: "UsageTable",
        bucketName: "bucket",
      }),
    ).toThrow();
  });
});
