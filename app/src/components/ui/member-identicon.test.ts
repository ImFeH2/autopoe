import { describe, expect, it } from "vitest";
import {
  createMemberIdenticon,
  type HslColor,
  MEMBER_IDENTICON_NAMESPACE,
  MEMBER_IDENTICON_PATTERN_BITS,
  MEMBER_IDENTICON_VERSION,
  memberIdenticonInput,
  memberIdenticonThemeColors,
  sha256Bytes,
} from "./member-identicon";

function digestHex(input: string) {
  return Array.from(sha256Bytes(input), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function hslToRgb({ hue, saturation, lightness }: HslColor) {
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;
  const chroma =
    (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const offset = normalizedLightness - chroma / 2;
  const [red, green, blue] =
    section < 1
      ? [chroma, secondary, 0]
      : section < 2
        ? [secondary, chroma, 0]
        : section < 3
          ? [0, chroma, secondary]
          : section < 4
            ? [0, secondary, chroma]
            : section < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  return [red + offset, green + offset, blue + offset];
}

function relativeLuminance(color: HslColor) {
  const coefficients = [0.2126, 0.7152, 0.0722];
  return hslToRgb(color).reduce((total, channel, index) => {
    const linear =
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return total + linear * coefficients[index];
  }, 0);
}

function contrastRatio(foreground: HslColor, background: HslColor) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("member identicon v1", () => {
  it("locks the namespace, version, input bytes, and SHA-256 implementation", () => {
    expect(MEMBER_IDENTICON_NAMESPACE).toBe("flowent-member-identicon");
    expect(MEMBER_IDENTICON_VERSION).toBe("v1");
    expect(MEMBER_IDENTICON_PATTERN_BITS).toBe(15);
    expect(memberIdenticonInput(2)).toBe("flowent-member-identicon|v1|2");
    expect(digestHex(memberIdenticonInput(2))).toBe(
      "91cb23f7f951c035cc3848731f7c973606362dbbecf46d7d268bcec1c273ffeb",
    );
  });

  it("maps the first 15 most-significant bits into mirrored 5 by 5 rows", () => {
    const identicon = createMemberIdenticon(2);

    expect(identicon.pattern).toBe("100/100/011/100/101");
    expect(identicon.hue).toBe(150);
    expect(identicon.cells).toHaveLength(25);
    for (let row = 0; row < 5; row += 1) {
      const offset = row * 5;
      expect(identicon.cells[offset]).toBe(identicon.cells[offset + 4]);
      expect(identicon.cells[offset + 1]).toBe(identicon.cells[offset + 3]);
    }
  });

  it("is deterministic for a stable ID and normally differs for another ID", () => {
    expect(createMemberIdenticon(2)).toBe(createMemberIdenticon(2));
    expect(createMemberIdenticon(2)).toEqual(createMemberIdenticon(2));
    expect(createMemberIdenticon(2).pattern).not.toBe(
      createMemberIdenticon(3).pattern,
    );
    expect(createMemberIdenticon(2).hue).not.toBe(createMemberIdenticon(3).hue);
  });

  it("maintains WCAG text-level contrast for every derived hue in both palettes", () => {
    for (const theme of ["dark", "light"] as const) {
      let minimumContrast = Number.POSITIVE_INFINITY;
      for (let hue = 0; hue < 360; hue += 1) {
        const colors = memberIdenticonThemeColors(hue, theme);
        minimumContrast = Math.min(
          minimumContrast,
          contrastRatio(colors.foreground, colors.background),
        );
      }
      expect(minimumContrast).toBeGreaterThanOrEqual(4.5);
    }
  });
});
