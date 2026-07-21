import type { LocaleShape } from "@/i18n/locale-shape";
import type { enNavigation } from "@/i18n/locales/en/navigation";

export const zhCNNavigation = {
  menu: "菜单",
  dialogTitle: "导航",
  toggleSidebarFromBoundary: "从边界切换侧栏",
  toggleSidebar: "切换侧栏",
  closeSidebar: "关闭侧栏",
  collapseSidebar: "收起侧栏",
  expandSidebar: "展开侧栏",
  mobileNavigation: "移动端导航",
  primaryNavigation: "主导航",
  noProvider: "未选择模型服务",
  sections: {
    tools: "工具",
    setup: "配置",
  },
  views: {
    workspace: "工作区",
    workflows: "工作流",
    skills: "技能",
    mcp: "MCP",
    providers: "模型服务",
    channels: "渠道",
    permissions: "权限",
    settings: "设置",
  },
  workflowHistory: {
    options: "更多操作",
    optionsFor: "“{{name}}”的更多操作",
    openNewTab: "在新标签页打开",
    rename: "重命名",
    renameInput: "重命名“{{name}}”",
    pin: "置顶",
    unpin: "取消置顶",
    delete: "删除",
    empty: "还没有工作流。",
  },
} satisfies LocaleShape<typeof enNavigation>;
