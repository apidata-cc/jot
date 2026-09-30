import { memo, useRef } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  FilePlus,
  FolderPlus,
  LocateFixed,
  Settings,
} from "lucide-react";
import { FileTree } from "./FileTree";
import { Tooltip } from "./ui/tooltip";
import { useFileStore } from "@/stores/fileStore";
import { useTabStore } from "@/stores/tabStore";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useUiStore,
} from "@/stores/uiStore";
import type { TreeNode } from "@/lib/tauri";

interface SidebarProps {
  rootChildren: TreeNode[];
  /** 正在按标签过滤（对应 TagPanel 中选中的标签），null 表示未过滤 */
  filterTag: string | null;
  onClearTag: () => void;
  collapsed: Record<string, boolean>;
  selectedPath: string | null;
  renamingPath: string | null;
  dropTarget: string | null;
  onToggle: (path: string) => void;
  onSelect: (node: TreeNode) => void;
  onNodeContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onBlankContextMenu: (e: React.MouseEvent) => void;
  onRenameSubmit: (node: TreeNode, newName: string) => void;
  onRenameCancel: () => void;
  onNewNoteIn: (dir: TreeNode) => void;
  onMoreMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onNewNote: () => void;
  onNewDir: () => void;
  onOpenSettings: () => void;
  onNodeDragStart: (node: TreeNode) => void;
  onNodeDragEnd: () => void;
  onDirDragOver: (e: React.DragEvent, node: TreeNode) => void;
  onDropOnDir: (node: TreeNode) => void;
  onDropToRoot: () => void;
}

// memo：编辑器每次按键都会让 App 重渲染，侧边栏（含整棵 FileTree）不应跟着重渲染
export const Sidebar = memo(function Sidebar(props: SidebarProps) {
  // 宽度存于 uiStore 并持久化（rem 单位），拖右缘调节，替代原固定 w-64
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const asideRef = useRef<HTMLElement>(null);
  // 树滚动容器：定位当前文档时在此范围内查询目标行并滚动
  const treeRef = useRef<HTMLDivElement>(null);
  // 当前打开文档的路径；无打开文档时定位按钮置灰
  const activePath = useTabStore((s) => s.tabs[s.activeTabIdx]?.path ?? null);
  // 任一目录处于展开态即视为“展开中”：按钮显示“全部折叠”；反之显示“全部展开”
  let hasExpandedDir = false;
  const walkDirs = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (!n.isDir) continue;
      if (!(props.collapsed[n.path] ?? false)) {
        hasExpandedDir = true;
        return;
      }
      walkDirs(n.children);
    }
  };
  walkDirs(props.rootChildren);

  // 右缘拖拽调宽。性能关键：拖拽期间完全绕过 React——pointermove 只写
  // aside + 外层挂载 wrapper 的 style.width（rAF 合帧到每帧一次），避免每条
  // 指针事件都触发 App 全量重渲染；松手时才把最终宽度写入 store 并持久化
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // aside 的父节点是 App 中控制显隐的挂载 wrapper（overflow-hidden），宽度必须同步
    const aside = asideRef.current;
    const wrapper = aside?.parentElement;
    if (!aside || !wrapper) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId); // 指针快速甩出也不丢 move/up 事件
    const startX = e.clientX;
    const startWidth = useUiStore.getState().sidebarWidth;
    // 指针位移按根字号 + body zoom 换算回 rem，缩放状态下边缘仍贴合光标
    const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 15;
    const zoom = 1 + useUiStore.getState().zoomLevel * 0.2;
    const pxPerRem = rootFont * zoom;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none"; // 拖拽中禁止选中树/编辑器文本
    // 锁定光标形状：capture 只锁事件不锁光标，快速拖动指针越过编辑器时会闪变成 I-beam
    document.body.style.cursor = "ew-resize";
    // 挂载 wrapper 的显隐过渡会拖慢内联改宽，拖拽期间临时禁用
    wrapper.style.transition = "none";

    let raf = 0;
    let widthRem = startWidth;
    const applyWidth = () => {
      raf = 0;
      const px = `${widthRem * pxPerRem}px`;
      aside.style.width = px;
      wrapper.style.width = px;
    };
    const onMove = (ev: PointerEvent) => {
      widthRem = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, startWidth + (ev.clientX - startX) / pxPerRem),
      );
      if (!raf) raf = requestAnimationFrame(applyWidth);
    };
    const finish = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      if (raf) cancelAnimationFrame(raf);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      wrapper.style.transition = "";
      // 落 store：触发一次 React 渲染对齐（值与内联样式相同，无视觉跳变）并持久化
      useUiStore.getState().setSidebarWidth(widthRem);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  };

  // 定位当前文档：不动其他目录的折叠状态，仅展开其目录链 → 滚动到行并闪烁高亮
  // （想要“折叠 + 定位”可先点全部折叠再点这里）。展开引起 React 重渲染，
  // 双 rAF 等新行挂载后再查询
  const revealActiveFile = () => {
    const path = useTabStore.getState().activeTab()?.path;
    if (!path) return;
    useFileStore.getState().expandTo(path);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const row = treeRef.current?.querySelector<HTMLElement>(
          `[data-tree-path="${CSS.escape(path)}"]`,
        );
        if (!row) return;
        row.scrollIntoView({ block: "center", behavior: "smooth" });
        row.classList.remove("tree-reveal-flash");
        void row.offsetWidth; // 强制 reflow，连续点击时重触发动画
        row.classList.add("tree-reveal-flash");
        row.addEventListener(
          "animationend",
          () => row.classList.remove("tree-reveal-flash"),
          { once: true },
        );
      }),
    );
  };

  return (
    <aside
      ref={asideRef}
      className="relative flex h-full shrink-0 select-none flex-col bg-sidebar"
      style={{ width: `${sidebarWidth}rem` }}
    >
      {/* 标签过滤指示条：点击标签后仅显示命中笔记，可在此清除过滤 */}
      {props.filterTag && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-3 py-1.5">
          <span className="truncate rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
            #{props.filterTag}
          </span>
          <span className="shrink-0 text-[10px] text-secondary/60">已过滤</span>
          <button
            className="ml-auto shrink-0 text-[10px] text-secondary hover:text-foreground"
            onClick={props.onClearTag}
          >
            清除
          </button>
        </div>
      )}

      {/* 目录树 */}
      <div
        ref={treeRef}
        className="m-1 flex-1 overflow-y-auto rounded pb-4"
        onContextMenu={(e) => {
          e.preventDefault();
          props.onBlankContextMenu(e);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          e.preventDefault();
          props.onDropToRoot();
        }}
      >
        {props.filterTag && props.rootChildren.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-secondary/60">
            该标签下暂无笔记
          </p>
        ) : (
          <FileTree
            nodes={props.rootChildren}
            collapsed={props.collapsed}
            selectedPath={props.selectedPath}
            renamingPath={props.renamingPath}
            dropTarget={props.dropTarget}
            onToggle={props.onToggle}
            onSelect={props.onSelect}
            onContextMenu={props.onNodeContextMenu}
            onRenameSubmit={props.onRenameSubmit}
            onRenameCancel={props.onRenameCancel}
            onNewNoteIn={props.onNewNoteIn}
            onMoreMenu={props.onMoreMenu}
            onNodeDragStart={props.onNodeDragStart}
            onNodeDragEnd={props.onNodeDragEnd}
            onDirDragOver={props.onDirDragOver}
            onDropOnDir={props.onDropOnDir}
          />
        )}
      </div>

      {/* 底部操作 */}
      <div className="flex h-10 shrink-0 items-center px-2">
        <Tooltip label="新建笔记">
          <button
            className="flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-hover hover:text-foreground"
            onClick={props.onNewNote}
          >
            <FilePlus size={15} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <Tooltip label="新建目录">
          <button
            className="flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-hover hover:text-foreground"
            onClick={props.onNewDir}
          >
            <FolderPlus size={15} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <div className="flex-1" />
        <Tooltip label="定位当前文档">
          <button
            className="flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            disabled={!activePath}
            onClick={revealActiveFile}
          >
            <LocateFixed size={15} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <Tooltip label={hasExpandedDir ? "全部折叠" : "全部展开"}>
          <button
            className="flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-hover hover:text-foreground"
            onClick={() => useFileStore.getState().setAllCollapsed(hasExpandedDir)}
          >
            {hasExpandedDir ? (
              <ChevronsDownUp size={15} strokeWidth={1.8} />
            ) : (
              <ChevronsUpDown size={15} strokeWidth={1.8} />
            )}
          </button>
        </Tooltip>
        <Tooltip label="设置">
          <button
            className="flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-hover hover:text-foreground"
            onClick={props.onOpenSettings}
          >
            <Settings size={15} strokeWidth={1.8} />
          </button>
        </Tooltip>
      </div>

      {/* 右缘拖拽条：拖动调宽，双击恢复默认宽度。hover 显示淡 accent 提示线，
          拖动中沿用同色不再加深——内容实时跟随已是反馈，实色高亮只会显脏 */}
      <div
        className="group absolute inset-y-0 right-0 z-10 flex w-1.5 cursor-ew-resize justify-center"
        onPointerDown={onResizeStart}
        onDoubleClick={() => useUiStore.getState().setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
      >
        <div className="w-px bg-transparent transition-colors group-hover:bg-accent/40" />
      </div>
    </aside>
  );
});
