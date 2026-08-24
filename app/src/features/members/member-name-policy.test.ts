import { describe, expect, it } from "vitest";
import {
  memberNameCount,
  memberNameErrorMessage,
  memberNameMetrics,
  memberNameValidationMessage,
} from "./member-name-policy";

const policy = {
  normalization: "NFKC" as const,
  max_code_points: 32,
  max_utf8_bytes: 128,
};

describe("Member name policy", () => {
  it("counts NFKC Unicode code points rather than UTF-16 units", () => {
    expect(memberNameMetrics("E\u0301", policy)).toEqual({
      chars: 1,
      utf8Bytes: 2,
    });
    expect(memberNameMetrics("😀", policy)).toEqual({ chars: 1, utf8Bytes: 4 });
    expect(memberNameMetrics("ﬃ", policy)).toEqual({ chars: 3, utf8Bytes: 3 });
  });

  it("accepts 32 normalized code points and rejects 33", () => {
    expect(memberNameValidationMessage("a".repeat(32), policy)).toBeNull();
    expect(memberNameValidationMessage("a".repeat(33), policy)).toBe(
      "名称最多32个字符",
    );
  });

  it("reports normalized UTF-8 overflow with understandable copy", () => {
    const fourByteLetter = "𐐀";
    expect(
      memberNameValidationMessage(fourByteLetter.repeat(32), policy),
    ).toBeNull();
    expect(
      memberNameValidationMessage(`${fourByteLetter.repeat(32)}a`, policy),
    ).toBe("名称包含的多字节字符过多，请缩短名称");
    expect(memberNameErrorMessage("name_too_large", policy)).toBe(
      "名称包含的多字节字符过多，请缩短名称",
    );
  });

  it("shows a policy-derived count near either limit", () => {
    expect(memberNameCount("a".repeat(23), policy)).toBeNull();
    expect(memberNameCount("a".repeat(24), policy)).toBe(
      "24/32 characters · 24/128 UTF-8 bytes",
    );
    expect(memberNameCount("𐐀".repeat(24), policy)).toBe(
      "24/32 characters · 96/128 UTF-8 bytes",
    );
  });
});
