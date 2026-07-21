import type { LocaleShape } from "@/i18n/locale-shape";
import type { enCommon } from "@/i18n/locales/en/common";

export const zhCNCommon = {
  loading: "正在加载...",
  notifications: {
    label: "通知",
    list: "通知",
    dismiss: "关闭通知",
  },
} satisfies LocaleShape<typeof enCommon>;
