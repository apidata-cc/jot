// src/components/ResizablePanel.tsx
import { useRef, type ReactNode } from "react";
import {
  SIDE_PANEL_DEFAULT_WIDTHS,
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  useUiStore,
  type PanelWidthKey,
} from "@/stores/uiStore";
import { startPanelResize } from "@/lib/panelResize";

interface ResizablePanelProps {
  panelKey: PanelWidthKey;
  children: ReactNode;
}

// 右侧信息面板通用壳：左缘拖拽条调宽 + 双击恢复默认 + 统一左边框/背景。
// 各面板将原根 <div className="flex h-full w-XX shrink-0 ..."> 替换为本组件即可，
// 宽度按 panelKey 在 uiStore 独立记忆。
export function ResizablePanel({ panelKey, children }: ResizablePanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useUiStore((s) => s[panelKey]);
  const defaultRem = SIDE_PANEL_DEFAULT_WIDTHS[panelKey];

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const panel = ref.current;
    if (!panel) return;
    startPanelResize(e, {
      targets: [panel],
      dir: -1, // 左缘手柄：向左拖变宽
      minRem: SIDE_PANEL_MIN_WIDTH,
      maxRem: SIDE_PANEL_MAX_WIDTH,
      onCommit: (w) => useUiStore.getState().setPanelWidth(panelKey, w),
    });
  };

  return (
    <div
      ref={ref}
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-sidebar"
      style={{ width: `${width}rem` }}
    >
      {children}
      {/* 左缘拖拽条：拖动调宽，双击恢复默认宽度 */}
      <div
        className="group absolute inset-y-0 left-0 z-10 flex w-1.5 cursor-ew-resize justify-center"
        onPointerDown={onResizeStart}
        onDoubleClick={() => useUiStore.getState().setPanelWidth(panelKey, defaultRem)}
      >
        <div className="w-px bg-transparent transition-colors group-hover:bg-accent/40" />
      </div>
    </div>
  );
}
