import { enCommon } from "@/i18n/locales/en/common";
import { enNavigation } from "@/i18n/locales/en/navigation";
import { enSetup } from "@/i18n/locales/en/setup";
import { enSettings } from "@/i18n/locales/en/settings";
import { enWorkflows } from "@/i18n/locales/en/workflows";
import { enWorkspace } from "@/i18n/locales/en/workspace";
import { zhCNCommon } from "@/i18n/locales/zh-CN/common";
import { zhCNNavigation } from "@/i18n/locales/zh-CN/navigation";
import { zhCNSetup } from "@/i18n/locales/zh-CN/setup";
import { zhCNSettings } from "@/i18n/locales/zh-CN/settings";
import { zhCNWorkflows } from "@/i18n/locales/zh-CN/workflows";
import { zhCNWorkspace } from "@/i18n/locales/zh-CN/workspace";

export const resources = {
  en: {
    translation: {
      common: enCommon,
      navigation: enNavigation,
      setup: enSetup,
      settings: enSettings,
      workflows: enWorkflows,
      workspace: enWorkspace,
    },
  },
  "zh-CN": {
    translation: {
      common: zhCNCommon,
      navigation: zhCNNavigation,
      setup: zhCNSetup,
      settings: zhCNSettings,
      workflows: zhCNWorkflows,
      workspace: zhCNWorkspace,
    },
  },
} as const;
