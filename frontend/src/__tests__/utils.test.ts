import { describe, expect, it, vi } from "vitest";

import { createClientId, createUuid } from "@/lib/utils";

const testUuid = "00000000-0000-4000-8000-000000000000";

describe("createClientId", () => {
  it("uses crypto.randomUUID when available", () => {
    const id = createClientId("message", {
      getRandomValues: () => {
        throw new Error("getRandomValues should not be called");
      },
      randomUUID: () => testUuid,
    });

    expect(id).toBe(`message-${testUuid}`);
  });

  it("falls back to crypto.getRandomValues as a v4 UUID", () => {
    const id = createClientId("message", {
      getRandomValues: (bytes) => {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = index;
        }
        return bytes;
      },
    });

    expect(id).toBe("message-00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("throws when Web Crypto is unavailable", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(() => createClientId("message", null)).toThrow(
        "Web Crypto is required for UUID generation",
      );
      expect(warnSpy).toHaveBeenCalledOnce();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("createUuid", () => {
  it("uses crypto.randomUUID without adding a prefix", () => {
    const id = createUuid({
      getRandomValues: () => {
        throw new Error("getRandomValues should not be called");
      },
      randomUUID: () => testUuid,
    });

    expect(id).toBe(testUuid);
  });

  it("throws when Web Crypto is unavailable", () => {
    expect(() => createUuid(null)).toThrow(
      "Web Crypto is required for UUID generation",
    );
  });
});
