// src/stores/uiStore.ts
import { create } from "zustand";
import type { TreeNode, TemplateInfo } from "@/lib/tauri";
import type { MenuEntry } from "@/components/ui/context-menu";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate, type UpdateResult } from "@/lib/updateCheck";

interface MenuPosition {
  x: number;
  y: number;
  entries: MenuEntry[];
}

// 关闭确认对话框的在途 Promise（单槽位复用，见 showCloseDialog）
let closeDialogPending: Promise<"save" | "discard" | "cancel"> | null = null;

export interface UIState {
  // 面板开关
  focusMode: boolean;
  sidebarVisible: boolean;
  /** 侧边栏宽度，rem 单位（根字号 15px 基准、随 DPI 等比缩放；16 等价原 w-64） */
  sidebarWidth: number;
  /** 右侧信息面板宽度，rem 单位（语义同 sidebarWidth，按面板独立记忆） */
  outlineWidth: number;
  backlinksWidth: number;
  tagsWidth: number;
  todoWidth: number;
  frontmatterWidth: number;
  tabBarVisible: boolean;
  zoomLevel: number;
  settingsOpen: boolean;
  aboutOpen: boolean;
  // 检查更新对话框（checking 为在途态，结果态进 updateDialogState）
  updateDialogOpen: boolean;
  updateDialogState: "checking" | "available" | "latest" | "error";
  updateLatestVersion: string | null;
  updateLatestUrl: string | null;
  closeDialogOpen: boolean;
  closeDialogResolve: ((choice: "save" | "discard" | "cancel") => void) | null;
  authPrompt: boolean;
  authReason: string | null;
  authSnoozed: boolean;
  pandocDialogOpen: boolean;
  pandocDialogResolve: ((ok: boolean) => void) | null;
  paletteOpen: boolean;
  emojiOpen: boolean;
  templatePickerOpen: boolean;
  templateList: TemplateInfo[];
  outlineOpen: boolean;
  backlinksOpen: boolean;
  tagsOpen: boolean;
  activeTag: string | null;
  frontmatterPanelOpen: boolean;
  todoPanelOpen: boolean;

  // 右键菜单
  menu: MenuPosition | null;

  // 拖拽
  dragging: TreeNode | null;
  dragPos: { x: number; y: number };
  dropTarget: string | null;
  externalDragZone: "sidebar" | "editor" | null;
  externalDropDir: string | null;

  // 动作
  toggleFocusMode: () => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setPanelWidth: (panel: PanelWidthKey, width: number) => void;
  closeMenu: () => void;
  showCloseDialog: () => Promise<"save" | "discard" | "cancel">;
  showPandocDialog: () => Promise<boolean>;
  openUpdateCheck: () => void;
}

// 侧边栏宽度常量（rem 单位）。
// 用 rem 而非 px：根字号 15px 基准并随 DPI 缩放（见 useAppShell），宽度随之等比缩放，与原 w-64 语义一致
export const SIDEBAR_MIN_WIDTH = 12; // ≈180px @15px 根字号
export const SIDEBAR_MAX_WIDTH = 32; // ≈480px @15px 根字号
export const SIDEBAR_DEFAULT_WIDTH = 16; // 等价原固定 w-64

// 右侧信息面板（大纲/反向链接/标签/待办/元数据）共用的宽度范围与默认值（rem）
export const SIDE_PANEL_MIN_WIDTH = 10; // ≈150px @15px 根字号
export const SIDE_PANEL_MAX_WIDTH = 40; // ≈600px @15px 根字号
export const SIDE_PANEL_DEFAULT_WIDTHS = {
  outlineWidth: 12, // 等价原 w-48
  backlinksWidth: 13, // 等价原 w-52
  tagsWidth: 12, // 等价原 w-48
  todoWidth: 14, // 等价原 w-56
  frontmatterWidth: 13, // 等价原 w-52
} as const;

export type PanelWidthKey = keyof typeof SIDE_PANEL_DEFAULT_WIDTHS;

// 各宽度字段的合法区间：localStorage 恢复与 set 动作共用同一收敛
const WIDTH_FIELD_RANGES: Record<
  PanelWidthKey | "sidebarWidth",
  readonly [number, number]
> = {
  sidebarWidth: [SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH],
  outlineWidth: [SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_MAX_WIDTH],
  backlinksWidth: [SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_MAX_WIDTH],
  tagsWidth: [SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_MAX_WIDTH],
  todoWidth: [SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_MAX_WIDTH],
  frontmatterWidth: [SIDE_PANEL_MIN_WIDTH, SIDE_PANEL_MAX_WIDTH],
};

// 宽度收敛：非法值回落默认宽度，其余钳制到字段区间
function clampPanelWidth(
  width: number,
  field: PanelWidthKey | "sidebarWidth",
): number {
  if (!Number.isFinite(width) || width <= 0) {
    return field === "sidebarWidth"
      ? SIDEBAR_DEFAULT_WIDTH
      : SIDE_PANEL_DEFAULT_WIDTHS[field];
  }
  const [min, max] = WIDTH_FIELD_RANGES[field];
  return Math.min(max, Math.max(min, width));
}

export const useUiStore = create<UIState>()((set, get) => ({
  focusMode: false,
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  ...SIDE_PANEL_DEFAULT_WIDTHS,
  tabBarVisible: false,
  zoomLevel: 0,
  settingsOpen: false,
  aboutOpen: false,
  updateDialogOpen: false,
  updateDialogState: "checking",
  updateLatestVersion: null,
  updateLatestUrl: null,
  closeDialogOpen: false,
  closeDialogResolve: null,
  authPrompt: false,
  authReason: null,
  authSnoozed: false,
  pandocDialogOpen: false,
  pandocDialogResolve: null,
  paletteOpen: false,
  emojiOpen: false,
  templatePickerOpen: false,
  templateList: [],
  outlineOpen: false,
  backlinksOpen: false,
  tagsOpen: false,
  activeTag: null,
  frontmatterPanelOpen: false,
  todoPanelOpen: false,
  menu: null,
  dragging: null,
  dragPos: { x: 0, y: 0 },
  dropTarget: null,
  externalDragZone: null,
  externalDropDir: null,

  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarWidth: (width) => set({ sidebarWidth: clampPanelWidth(width, "sidebarWidth") }),
  // computed key 需要断言：panel 是 PanelWidthKey 之一，键值对合法
  setPanelWidth: (panel, width) =>
    set({ [panel]: clampPanelWidth(width, panel) } as Partial<UIState>),
  closeMenu: () => set({ menu: null }),

  showCloseDialog: () => {
    // 对话框已打开时复用同一 Promise：
    // 否则旧 Promise 的 resolve 槽位被覆盖，await 它的 closeTab 永久悬挂
    if (get().closeDialogOpen && closeDialogPending) return closeDialogPending;
    closeDialogPending = new Promise<"save" | "discard" | "cancel">((resolve) => {
      set({
        closeDialogOpen: true,
        closeDialogResolve: (choice) => {
          closeDialogPending = null;
          resolve(choice);
        },
      });
    });
    return closeDialogPending;
  },

  showPandocDialog: () => {
    return new Promise<boolean>((resolve) => {
      set({ pandocDialogOpen: true, pandocDialogResolve: resolve });
    });
  },

  openUpdateCheck: () => {
    set({
      updateDialogOpen: true,
      updateDialogState: "checking",
      updateLatestVersion: null,
      updateLatestUrl: null,
    });
    (async () => {
      let result: UpdateResult;
      try {
        result = await checkForUpdate(await getVersion());
      } catch {
        // dev 环境无 Tauri runtime / getVersion 失败：按检查失败处理
        result = { status: "error" };
      }
      if (!get().updateDialogOpen) return; // 检查期间用户已关闭对话框：丢弃结果
      if (result.status === "update-available") {
        set({
          updateDialogState: "available",
          updateLatestVersion: result.latestVersion,
          updateLatestUrl: result.downloadUrl,
        });
      } else if (result.status === "up-to-date") {
        set({ updateDialogState: "latest" });
      } else {
        set({ updateDialogState: "error" });
      }
    })();
  },
}));

// ---- 布局偏好持久化 ----
// 侧边栏开关/宽度 + 右侧面板开关/宽度是用户显式设置的布局偏好，跨会话保留。
// 其余状态（对话框、右键菜单、拖拽等）是临时态，每次启动恢复默认。
export const UI_PREFS_KEY = "notes-ui-prefs";
const UI_PREFS_FIELDS = [
  "sidebarVisible",
  "sidebarWidth",
  "outlineOpen",
  "backlinksOpen",
  "tagsOpen",
  "frontmatterPanelOpen",
  "todoPanelOpen",
  "outlineWidth",
  "backlinksWidth",
  "tagsWidth",
  "todoWidth",
  "frontmatterWidth",
] as const;

type UiPrefs = Pick<UIState, (typeof UI_PREFS_FIELDS)[number]>;

const DEFAULT_UI_PREFS: UiPrefs = {
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  ...SIDE_PANEL_DEFAULT_WIDTHS,
  outlineOpen: false,
  backlinksOpen: false,
  tagsOpen: false,
  frontmatterPanelOpen: false,
  todoPanelOpen: false,
};

function readUiPrefs(): UiPrefs {
  const prefs: UiPrefs = { ...DEFAULT_UI_PREFS };
  // union 键在 prefs 上的写入位置类型会被 TS 交叉成 never，用宽索引签名收发
  const writable = prefs as Record<string, unknown>;
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const key of UI_PREFS_FIELDS) {
        const value = parsed[key];
        const isWidthField =
          key === "sidebarWidth" || (key as string) in SIDE_PANEL_DEFAULT_WIDTHS;
        if (isWidthField) {
          // 宽度是数字并收敛到合法区间，防 localStorage 脏数据撑破布局
          if (typeof value === "number") {
            writable[key] = clampPanelWidth(
              value,
              key as PanelWidthKey | "sidebarWidth",
            );
          }
        } else if (typeof value === "boolean") {
          writable[key] = value;
        }
      }
    }
  } catch {
    /* localStorage 不可用或数据损坏：忽略，用默认值 */
  }
  return prefs;
}

/** 序列化布局偏好子集（键序固定，用于变化比对 + 落盘） */
function serializeUiPrefs(s: UiPrefs): string {
  const o: Record<string, boolean | number> = {};
  for (const key of UI_PREFS_FIELDS) o[key] = s[key];
  return JSON.stringify(o);
}

// 模块加载时同步恢复（App 首次渲染前生效，避免侧边栏闪现）
useUiStore.setState(readUiPrefs());

// 布局偏好变化时按需写回：序列化比对，右键菜单/拖拽等无关 setState 不触发写入
let lastUiPrefsJson = serializeUiPrefs(useUiStore.getState());
useUiStore.subscribe((state) => {
  const json = serializeUiPrefs(state);
  if (json === lastUiPrefsJson) return;
  lastUiPrefsJson = json;
  try {
    localStorage.setItem(UI_PREFS_KEY, json);
  } catch {
    /* localStorage 不可用：静默忽略 */
  }
});
