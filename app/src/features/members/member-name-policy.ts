import type { MemberNamePolicy } from "@/lib/backend";

export type MemberNameMetrics = {
  chars: number;
  utf8Bytes: number;
};

export function memberNameMetrics(
  value: string,
  policy: MemberNamePolicy,
): MemberNameMetrics {
  const normalized = value.normalize(policy.normalization);
  return {
    chars: [...normalized].length,
    utf8Bytes: new TextEncoder().encode(normalized).length,
  };
}

export function memberNameValidationMessage(
  value: string,
  policy: MemberNamePolicy,
): string | null {
  if (!value) {
    return "名称不能为空";
  }
  if (value.trim() !== value) {
    return "名称不能以空白开头或结尾";
  }
  const metrics = memberNameMetrics(value, policy);
  if (metrics.utf8Bytes > policy.max_utf8_bytes) {
    return "名称包含的多字节字符过多，请缩短名称";
  }
  if (metrics.chars > policy.max_code_points) {
    return `名称最多${policy.max_code_points}个字符`;
  }
  return null;
}

export function memberNameErrorMessage(
  code: string,
  policy: MemberNamePolicy,
): string | null {
  if (code === "name_too_long") {
    return `名称最多${policy.max_code_points}个字符`;
  }
  if (code === "name_too_large") {
    return "名称包含的多字节字符过多，请缩短名称";
  }
  return null;
}

export function memberNameConstraints(policy: MemberNamePolicy): string {
  return `Names are limited to ${policy.max_code_points} Unicode code points after ${policy.normalization} normalization and ${policy.max_utf8_bytes} UTF-8 bytes.`;
}

export function memberNameCount(
  value: string,
  policy: MemberNamePolicy,
): string | null {
  const metrics = memberNameMetrics(value, policy);
  const nearChars =
    metrics.chars >= Math.ceil((policy.max_code_points * 3) / 4);
  const nearBytes =
    metrics.utf8Bytes >= Math.ceil((policy.max_utf8_bytes * 3) / 4);
  return nearChars || nearBytes
    ? `${metrics.chars}/${policy.max_code_points} characters · ${metrics.utf8Bytes}/${policy.max_utf8_bytes} UTF-8 bytes`
    : null;
}
