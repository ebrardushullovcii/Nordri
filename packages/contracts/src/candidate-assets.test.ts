import { describe, expect, test } from "vitest";

import {
  CandidateAssetImportInputSchema,
  CandidateAssetRestoreInputSchema,
  CandidateAssetSchema,
} from "./candidate-assets";

describe("candidate asset contracts", () => {
  test("defaults imports to private sensitive local storage", () => {
    expect(
      CandidateAssetImportInputSchema.parse({ kind: "work_sample" }),
    ).toEqual({
      kind: "work_sample",
      sensitivity: "sensitive",
      consentScope: "private_storage_only",
      retention: "until_deleted",
      forJob: null,
    });
  });

  test("never includes a raw path or file bytes in renderer-safe metadata", () => {
    const asset = CandidateAssetSchema.parse({
      id: "asset_1",
      kind: "resume",
      originalName: "resume.pdf",
      mime: "application/pdf",
      byteSize: 1234,
      sha256: "a".repeat(64),
      createdAt: "2026-08-10T10:00:00.000Z",
      sensitivity: "sensitive",
      consentScope: "private_storage_only",
      retention: "until_deleted",
    });

    expect(asset).not.toHaveProperty("path");
    expect(asset).not.toHaveProperty("bytes");
    expect(asset.deletedAt).toBeNull();
    expect(asset.extractedText).toBeNull();
  });

  test("rejects oversized and non-digest metadata", () => {
    const base = {
      id: "asset_1",
      kind: "other",
      originalName: "unsafe.bin",
      mime: "application/octet-stream",
      byteSize: 26 * 1024 * 1024,
      sha256: "not-a-digest",
      createdAt: "2026-08-10T10:00:00.000Z",
      sensitivity: "sensitive",
      consentScope: "private_storage_only",
      retention: "until_deleted",
    };

    expect(CandidateAssetSchema.safeParse(base).success).toBe(false);
  });

  test("accepts renderer-safe lifecycle metadata and requires a retention choice to restore", () => {
    const lifecycleAsset = CandidateAssetSchema.parse({
      id: "asset_1",
      kind: "resume",
      originalName: "resume.pdf",
      mime: "application/pdf",
      byteSize: 1234,
      sha256: "a".repeat(64),
      createdAt: "2026-08-10T10:00:00.000Z",
      sensitivity: "sensitive",
      consentScope: "private_storage_only",
      retention: "30_days",
      deletedAt: "2026-09-09T10:00:00.000Z",
      lifecycle: {
        retentionStartedAt: "2026-08-10T10:00:00.000Z",
        expiresAt: "2026-09-09T10:00:00.000Z",
        deletionReason: "expired",
        purgeAt: "2026-09-16T10:00:00.000Z",
      },
    });

    expect(lifecycleAsset.lifecycle?.deletionReason).toBe("expired");
    expect(lifecycleAsset).not.toHaveProperty("path");
    expect(
      CandidateAssetRestoreInputSchema.safeParse({ assetId: "asset_1" })
        .success,
    ).toBe(false);
    expect(
      CandidateAssetRestoreInputSchema.parse({
        assetId: "asset_1",
        retention: "90_days",
      }),
    ).toEqual({ assetId: "asset_1", retention: "90_days" });
  });

  test("rejects lifecycle chronology that does not match retention and Trash policy", () => {
    const base = {
      id: "asset_1",
      kind: "resume",
      originalName: "resume.pdf",
      mime: "application/pdf",
      byteSize: 1234,
      sha256: "a".repeat(64),
      createdAt: "2026-08-10T10:00:00.000Z",
      sensitivity: "sensitive",
      consentScope: "private_storage_only",
      retention: "30_days",
      extractedText: null,
    };

    const invalidAssets = [
      {
        ...base,
        deletedAt: null,
        lifecycle: {
          retentionStartedAt: base.createdAt,
          expiresAt: "2026-09-09T10:00:00.000Z",
          deletionReason: "removed",
          purgeAt: "2026-08-17T10:00:00.000Z",
        },
      },
      {
        ...base,
        deletedAt: null,
        lifecycle: {
          retentionStartedAt: base.createdAt,
          expiresAt: "2026-09-08T10:00:00.000Z",
          deletionReason: null,
          purgeAt: null,
        },
      },
      {
        ...base,
        retention: "until_deleted",
        deletedAt: "2026-08-11T10:00:00.000Z",
        lifecycle: {
          retentionStartedAt: base.createdAt,
          expiresAt: null,
          deletionReason: "expired",
          purgeAt: "2026-08-18T10:00:00.000Z",
        },
      },
      {
        ...base,
        deletedAt: "2026-08-11T10:00:00.000Z",
        lifecycle: {
          retentionStartedAt: base.createdAt,
          expiresAt: "2026-09-09T10:00:00.000Z",
          deletionReason: "removed",
          purgeAt: "2026-08-17T10:00:00.000Z",
        },
      },
      {
        ...base,
        deletedAt: "2026-09-08T10:00:00.000Z",
        lifecycle: {
          retentionStartedAt: base.createdAt,
          expiresAt: "2026-09-09T10:00:00.000Z",
          deletionReason: "expired",
          purgeAt: "2026-09-15T10:00:00.000Z",
        },
      },
      {
        ...base,
        deletedAt: null,
        lifecycle: {
          retentionStartedAt: "2026-08-09T10:00:00.000Z",
          expiresAt: "2026-09-08T10:00:00.000Z",
          deletionReason: null,
          purgeAt: null,
        },
      },
    ];

    for (const asset of invalidAssets) {
      expect(CandidateAssetSchema.safeParse(asset).success).toBe(false);
    }
  });
});
