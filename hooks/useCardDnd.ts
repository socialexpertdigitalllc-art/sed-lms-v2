"use client";

import { useRef, useState, type DragEvent } from "react";

/**
 * Native HTML5 drag-and-drop reordering within a single card grid.
 * Dragging a card and dropping it on another moves the dragged key before
 * the target key in the visible order; `onReorder` receives the new visible
 * key order. Drags that originate outside this grid are ignored.
 */
export function useCardDnd(visibleKeys: string[], onReorder: (nextVisible: string[]) => void) {
  const dragKey = useRef<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const reset = () => {
    dragKey.current = null;
    setOverKey(null);
  };

  const cardProps = (key: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      dragKey.current = key;
      e.dataTransfer.setData("text/plain", key);
      e.dataTransfer.effectAllowed = "move" as const;
    },
    onDragOver: (e: DragEvent) => {
      if (!dragKey.current) return;
      e.preventDefault();
      if (dragKey.current !== key) setOverKey(key);
    },
    onDragLeave: () => {
      setOverKey((k) => (k === key ? null : k));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const src = dragKey.current ?? e.dataTransfer.getData("text/plain");
      reset();
      if (!src || src === key || !visibleKeys.includes(src)) return;
      const next = visibleKeys.filter((k) => k !== src);
      next.splice(next.indexOf(key), 0, src);
      onReorder(next);
    },
    onDragEnd: reset,
  });

  return { overKey, cardProps };
}
