import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * DeferUntilVisible
 *
 * Mounts its children only once they come close to the viewport.
 *
 * Code-splitting alone did not keep the chart library off the critical path:
 * React.lazy defers the DOWNLOAD until the component RENDERS, and on a single
 * long page every component renders at once, so the largest chunk in the build
 * was still fetched during the first paint for charts nobody had scrolled to.
 *
 * Deferring the mount is what actually defers the cost. The placeholder holds
 * the final height so nothing shifts when the real content arrives, and where
 * IntersectionObserver is unavailable the children render immediately rather
 * than never.
 */
export function DeferUntilVisible({
  children,
  minHeight,
  /** How far ahead of the viewport to start loading. */
  rootMargin = "600px",
  label,
}: {
  children: ReactNode;
  /** Reserved height, in pixels, so the layout does not move. */
  minHeight: number;
  rootMargin?: string;
  /** Announced while the content is not yet mounted. */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  return (
    <div ref={ref} style={{ minHeight }}>
      {visible ? (
        children
      ) : (
        <div
          role="status"
          aria-label={label ?? "Inhalt wird geladen"}
          className="h-full w-full animate-pulse rounded-xl bg-muted/40 motion-reduce:animate-none"
          style={{ minHeight }}
        />
      )}
    </div>
  );
}

export default DeferUntilVisible;
