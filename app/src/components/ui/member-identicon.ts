export const MEMBER_IDENTICON_NAMESPACE = "huddol-member-identicon";
export const MEMBER_IDENTICON_VERSION = "v1";
export const MEMBER_IDENTICON_PATTERN_BITS = 15;

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const identiconCache = new Map<number, MemberIdenticon>();

export type IdenticonTheme = "dark" | "light";
export type HslColor = { hue: number; lightness: number; saturation: number };
export type MemberIdenticon = {
  activeCells: readonly { key: string; x: number; y: number }[];
  cells: readonly boolean[];
  hue: number;
  input: string;
  pattern: string;
  version: typeof MEMBER_IDENTICON_VERSION;
};

function rotateRight(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount));
}

export function sha256Bytes(input: string): Uint8Array {
  const source = new TextEncoder().encode(input);
  const bitLength = source.length * 8;
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1)
      words[index] = paddedView.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const previous = words[index - 15];
      const previousTwo = words[index - 2];
      const sigma0 =
        rotateRight(previous, 7) ^ rotateRight(previous, 18) ^ (previous >>> 3);
      const sigma1 =
        rotateRight(previousTwo, 17) ^
        rotateRight(previousTwo, 19) ^
        (previousTwo >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (const [index, value] of [h0, h1, h2, h3, h4, h5, h6, h7].entries())
    digestView.setUint32(index * 4, value);
  return digest;
}

export function memberIdenticonInput(memberId: number): string {
  return `${MEMBER_IDENTICON_NAMESPACE}|${MEMBER_IDENTICON_VERSION}|${memberId}`;
}

export function memberIdenticonThemeColors(
  hue: number,
  theme: IdenticonTheme,
): { background: HslColor; foreground: HslColor } {
  const normalizedHue = ((Math.round(hue) % 360) + 360) % 360;
  return theme === "dark"
    ? {
        background: { hue: normalizedHue, saturation: 28, lightness: 14 },
        foreground: { hue: normalizedHue, saturation: 65, lightness: 78 },
      }
    : {
        background: { hue: normalizedHue, saturation: 18, lightness: 96 },
        foreground: { hue: normalizedHue, saturation: 70, lightness: 24 },
      };
}

export function createMemberIdenticon(memberId: number): MemberIdenticon {
  const cached = identiconCache.get(memberId);
  if (cached) return cached;
  const input = memberIdenticonInput(memberId);
  const digest = sha256Bytes(input);
  const activeCells: Array<{ key: string; x: number; y: number }> = [];
  const cells: boolean[] = [];
  const sourceRows: boolean[][] = [];
  for (let row = 0; row < 5; row += 1) {
    const sourceRow: boolean[] = [];
    for (let column = 0; column < 3; column += 1) {
      const bitIndex = row * 3 + column;
      sourceRow.push(
        ((digest[Math.floor(bitIndex / 8)] >>> (7 - (bitIndex % 8))) & 1) === 1,
      );
    }
    sourceRows.push(sourceRow);
    const mirroredRow = [
      sourceRow[0],
      sourceRow[1],
      sourceRow[2],
      sourceRow[1],
      sourceRow[0],
    ];
    for (let column = 0; column < mirroredRow.length; column += 1) {
      const active = mirroredRow[column];
      cells.push(active);
      if (active) {
        activeCells.push({ key: `${row}:${column}`, x: column, y: row });
      }
    }
  }
  const identicon: MemberIdenticon = {
    activeCells,
    cells,
    hue: ((digest[16] << 8) | digest[17]) % 360,
    input,
    pattern: sourceRows.map((row) => row.map(Number).join("")).join("/"),
    version: MEMBER_IDENTICON_VERSION,
  };
  identiconCache.set(memberId, identicon);
  return identicon;
}
