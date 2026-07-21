import type { LocaleShape } from "@/i18n/locale-shape";
import type { enSettings } from "@/i18n/locales/en/settings";

export const zhCNSettings = {
  pageLabel: "设置",
  runtimeFormLabel: "运行设置",
  language: {
    title: "语言",
    label: "语言",
    english: "English",
    simplifiedChinese: "简体中文",
  },
  modelRouting: {
    title: "模型设置",
    noProviders: "暂无模型服务",
    provider: "模型服务",
    reasoning: "推理强度",
    model: "模型",
    noModels: "暂无模型",
    contextWindow: "上下文窗口",
    contextSize: "上下文大小",
    contextSizePlaceholder: "例如 128000",
    contextSizeError: "请输入正整数",
    contextLimitModes: {
      auto: "自动",
      manual: "手动",
    },
    reasoningOptions: {
      default: "默认",
      low: "低",
      medium: "中",
      high: "高",
      xhigh: "极高",
    },
  },
  agentPrompt: {
    title: "Flowent 指令",
    placeholder: "添加 Flowent 在处理任务时遵循的指令。",
  },
  save: "保存",
  version: "Flowent v{{version}}",
} satisfies LocaleShape<typeof enSettings>;
