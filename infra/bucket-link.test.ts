import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("bucket link policy", () => {
  it("exports only the resource name and grants no implicit S3 actions", async () => {
    const wrap = vi.fn();
    class Bucket {}
    vi.stubGlobal("sst", { Linkable: { wrap }, aws: { Bucket } });
    vi.resetModules();
    const { configureLeastPrivilegeBucketLink } = await import("./bucket-link.js");
    configureLeastPrivilegeBucketLink();
    configureLeastPrivilegeBucketLink();

    expect(wrap).toHaveBeenCalledOnce();
    const callback = wrap.mock.calls[0]?.[1] as (bucket: { name: string }) => unknown;
    expect(callback({ name: "private-file-bucket" })).toEqual({
      properties: { name: "private-file-bucket" },
      include: [],
    });
  });
});
