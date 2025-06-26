import React, { useState, useCallback } from "react";
import s from "../styles/resizable.module.scss";
import { startMouseMove } from "yon-utils";

interface ResizablePanelProps {
  initialWidth?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  initialWidth,
  children,
  className = "",
  style = {},
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const [width, setWidth] = useState(initialWidth || "300px");

  const startResizing = useCallback(
    (e: React.PointerEvent) => {
      const panel = e.currentTarget.parentElement;
      if (!panel) return;

      const startWidth = panel.offsetWidth;
      let newWidth = startWidth;

      e.preventDefault();
      setIsResizing(true);
      startMouseMove({
        initialEvent: e.nativeEvent,
        onMove(e) {
          newWidth = startWidth + e.deltaX;
          panel.style.flexBasis = `${newWidth}px`;
        },
        onEnd() {
          setWidth(`${newWidth}px`);
          setIsResizing(false);
        },
      });
    },
    [width]
  );

  return (
    <div
      className={`${s.panel} ${className}`}
      style={{
        ...style,
        flexBasis: width,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div className={s.panelContent}>{children}</div>
      <div
        className={`${s.resizer} ${isResizing ? "isResizing" : ""}`}
        onPointerDown={startResizing}
      />
    </div>
  );
};
