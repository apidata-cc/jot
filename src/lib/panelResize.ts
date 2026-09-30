// src/lib/panelResize.ts
// 面板宽度拖拽的共享实现：左侧 Sidebar（右缘手柄）与右侧各信息面板（左缘手柄）共用。
// 性能关键：拖拽期间完全绕过 React——pointermove 只写目标元素 style.width（rAF 合帧
// 到每帧一次），避免每条指针事件都触发 App 全量重渲染；松手时才经 onCommit 落回 store。
import type { PointerEvent as ReactPointerEvent } from "react";

export interface PanelResizeOptions {
  /** 需要同步写宽度的元素（Sidebar 传 aside + 挂载 wrapper，右侧面板只传面板根） */
  targets: (HTMLElement | null | undefined)[];
  /** 方向系数：+1 指针右移变宽（右缘手柄）；-1 指针右移变窄（左缘手柄） */
  dir: 1 | -1;
  minRem: number;
  maxRem: number;
  /** 松手时回调最终宽度（rem，已收敛到区间内） */
  onCommit: (widthRem: number) => void;
}

export function startPanelResize(
  e: ReactPointerEvent<HTMLDivElement>,
  opts: PanelResizeOptions,
): void {
  const els = opts.targets.filter((el): el is HTMLElement => !!el);
  if (els.length === 0) return;
  e.preventDefault();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId); // 指针快速甩出也不丢 move/up 事件
  const startX = e.clientX;
  // 指针位移按根字号 + body zoom 换算回 rem，缩放状态下边缘仍贴合光标
  const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 15;
  const zoom = parseFloat(document.body.style.zoom) / 100 || 1;
  const pxPerRem = rootFont * zoom;
  // 起始宽度取实测值而非 store，天然与当前渲染一致
  const startRem = els[0].getBoundingClientRect().width / pxPerRem;
  const prevUserSelect = document.body.style.userSelect;
  const prevCursor = document.body.style.cursor;
  document.body.style.userSelect = "none"; // 拖拽中禁止选中面板/编辑器文本
  // 锁定光标形状：capture 只锁事件不锁光标，快速拖动越过其他区域时会闪变
  document.body.style.cursor = "ew-resize";
  // 元素上的 CSS 过渡会拖慢内联改宽，拖拽期间临时禁用
  for (const el of els) el.style.transition = "none";

  let raf = 0;
  let widthRem = startRem;
  const apply = () => {
    raf = 0;
    const px = `${widthRem * pxPerRem}px`;
    for (const el of els) el.style.width = px;
  };
  const onMove = (ev: PointerEvent) => {
    widthRem = Math.min(
      opts.maxRem,
      Math.max(opts.minRem, startRem + (opts.dir * (ev.clientX - startX)) / pxPerRem),
    );
    if (!raf) raf = requestAnimationFrame(apply);
  };
  const finish = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
    if (raf) cancelAnimationFrame(raf);
    document.body.style.userSelect = prevUserSelect;
    document.body.style.cursor = prevCursor;
    for (const el of els) el.style.transition = "";
    // 落 store：触发一次 React 渲染对齐（值与内联样式相同，无视觉跳变）并持久化
    opts.onCommit(widthRem);
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
}
