import { describe, expect, it, vi } from "vitest";

import { createClientId } from "@/lib/utils";

describe("createClientId", () => {
  it("uses crypto.randomUUID when available", () => {
    const id = createClientId("message", {
      getRandomValues: () => {
        throw new Error("getRandomValues should not be called");
      },
      randomUUID: () => "00000000-0000-4000-8000-000000000000",
    });

    expect(id).toBe("message-00000000-0000-4000-8000-000000000000");
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
        "Web Crypto is required for client ID generation",
      );
      expect(warnSpy).toHaveBeenCalledOnce();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
