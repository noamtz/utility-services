import { describe, expect, it, vi } from "vitest";

import { executeWatermarkBackfill, parseBackfillArguments } from "./backfill-watermark-index.mjs";

const projectA = "11111111-1111-4111-8111-111111111111";
const projectB = "22222222-2222-4222-8222-222222222222";

function watermark(projectId: string, sourceKind = "cloudtrail-download") {
  return {
    pk: `PROJECT#${projectId}`,
    sk: `WATERMARK#${sourceKind}`,
    itemType: "usage-watermark",
    internalProjectId: projectId,
    sourceKind,
    lastMeteredAt: "2026-08-25T00:00:00.000Z",
  };
}

describe("watermark index backfill operator", () => {
  it("defaults to dry-run and gates apply with stage-bound confirmation", () => {
    expect(parseBackfillArguments(["--stage-name", "dev-rus02"])).toEqual({
      stage: "dev-rus02",
      apply: false,
    });
    expect(() => parseBackfillArguments(["--stage-name", "production", "--apply"])).toThrow(
      "requires --confirm",
    );
    expect(
      parseBackfillArguments([
        "--stage-name",
        "production",
        "--apply",
        "--confirm",
        "APPLY:production:watermark-index",
      ]),
    ).toMatchObject({ apply: true });
  });

  it("paginates and reports only aggregate source counts in dry-run", async () => {
    const operations = {
      listWatermarks: vi
        .fn()
        .mockResolvedValueOnce({ items: [watermark(projectA)], cursor: { pk: "opaque" } })
        .mockResolvedValueOnce({ items: [watermark(projectB, "file-upload")] }),
      updateWatermark: vi.fn(),
    };
    const write = vi.fn();
    await expect(
      executeWatermarkBackfill(["--stage-name", "dev-rus02"], operations, write),
    ).resolves.toMatchObject({ examined: 2, pending: 2, applied: 0, mode: "dry-run" });
    expect(operations.updateWatermark).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceCounts: { "cloudtrail-download": 1, "file-upload": 1 },
      }),
    );
    expect(JSON.stringify(write.mock.calls)).not.toMatch(/11111111|22222222|PROJECT#/u);
  });

  it("conditionally updates only missing index keys and stays idempotent", async () => {
    const missing = watermark(projectA);
    const current = {
      ...watermark(projectB),
      gsi1pk: "WATERMARK#cloudtrail-download",
      gsi1sk: `2026-08-25T00:00:00.000Z#${projectB}`,
    };
    const operations = {
      listWatermarks: vi.fn().mockResolvedValue({ items: [missing, current] }),
      updateWatermark: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      executeWatermarkBackfill(
        ["--stage-name", "dev-rus02", "--apply", "--confirm", "APPLY:dev-rus02:watermark-index"],
        operations,
        vi.fn(),
      ),
    ).resolves.toMatchObject({ pending: 1, applied: 1 });
    expect(operations.updateWatermark).toHaveBeenCalledTimes(1);
    expect(operations.updateWatermark).toHaveBeenCalledWith(
      missing,
      expect.objectContaining({ gsi1pk: "WATERMARK#cloudtrail-download" }),
    );
  });
});
