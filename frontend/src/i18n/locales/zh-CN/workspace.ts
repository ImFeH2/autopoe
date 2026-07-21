import type { LocaleShape } from "@/i18n/locale-shape";
import type { enWorkspace } from "@/i18n/locales/en/workspace";

export const zhCNWorkspace = {
  pageLabel: "工作区",
  composer: {
    label: "工作区消息输入",
    message: "给 Flowent 发消息",
    send: "发送消息",
    stop: "停止",
  },
  menus: {
    commands: "命令",
    skills: "技能",
  },
  context: {
    capacityStatus: "上下文容量",
    label: "上下文",
    refining: "正在整理...",
  },
  plan: {
    summary: "计划 · 已完成 {{completed}}/{{total}}",
    tasks: "计划任务",
    statuses: {
      completed: "完成",
      inProgress: "进行中",
      pending: "待处理",
    },
  },
  conversation: {
    empty: "从哪里开始？",
    jumpTo: "跳转到{{actor}}：{{summary}}",
    message: "消息",
    messages: "对话消息",
    shortcuts: "对话快捷导航",
    flowent: "Flowent",
    you: "你",
  },
  assistant: {
    response: "Flowent 回复",
    thinking: "正在思考",
    thinkingInProgress: "正在思考...",
    thoughtProcess: "思考过程",
  },
  messageActions: {
    cancel: "取消",
    copied: "已复制",
    copy: "复制",
    copyFailed: "复制失败",
    edit: "编辑",
    editMessage: "编辑消息",
    retry: "重试",
    save: "保存",
    saveAndRetry: "保存并重试",
  },
  systemMessages: {
    contextCompacted: "上下文已精简",
    contextOptimized: "上下文已优化",
    summary: "{{label}}摘要",
  },
  tools: {
    approved: "已批准",
    denied: "已拒绝",
    exit: "退出码 {{code}}",
    failure: "失败信息",
    review: "审核",
    reviewerOutput: "审核输出",
    statuses: {
      done: "完成",
      failed: "失败",
      running: "运行中",
      waiting: "等待中",
    },
  },
  commands: {
    clearDescription: "清空对话",
    compactDescription: "整理上下文",
    notFound: "未找到该命令。",
  },
  notifications: {
    compactUnavailable: "Flowent 正在回复，暂时无法整理上下文。",
    conversationCouldNotBeCleared: "对话未能清空。",
  },
  errors: {
    contextCouldNotBeCompacted: "上下文未能整理。",
    contextCouldNotBeOptimized: "上下文未能优化。",
    messageCouldNotBeSent: "消息未能发送。",
    messageCouldNotBeUpdated: "消息未能更新。",
    requestFailedMessage: "请检查模型连接设置后重试。",
    requestFailedTitle: "请求失败",
    responseInProgress: "Flowent 正在回复",
    responseInterrupted: "回复已中断",
  },
} satisfies LocaleShape<typeof enWorkspace>;
