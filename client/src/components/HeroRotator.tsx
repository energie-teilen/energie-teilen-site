/**
 * HeroRotator — cinematic crossfading background for the hero frame.
 *  - Shuffles image order on every mount (different first frame each visit)
 *  - Crossfades to the next image every `intervalMs` (default 6s), 1.4s dissolve
 *  - Subtle Ken Burns drift for a filmic feel (off under reduced-motion)
 *  - Preloads the upcoming image so the crossfade never flashes
 *  - Pauses while the tab is hidden (saves CPU/bandwidth)
 *  - Degrades gracefully: 1 image => static; 0 => renders nothing
 * Drop inside any element with position:relative; overflow:hidden (.hero-frame).
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { HeroImage } from "@/lib/hero-images";

function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function HeroRotator({
  images,
  intervalMs = 6000,
  className = "",
}: {
  images: readonly HeroImage[];
  intervalMs?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const order = useMemo(() => shuffle(images), [images]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (order.length < 2) return;
    const next = new Image();
    next.src = order[(index + 1) % order.length].src;
  }, [index, order]);

  useEffect(() => {
    if (reduceMotion || order.length < 2) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const start = () => {
      stop();
      timer = setInterval(() => setIndex((i) => (i + 1) % order.length), intervalMs);
    };
    const onVisibility = () =>
      document.visibilityState === "hidden" ? stop() : start();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [order.length, intervalMs, reduceMotion]);

  if (order.length === 0) return null;
  const active = order[index];

  return (
    <div className={`hero-rotator ${className}`} role="img" aria-label={active.alt}>
      <AnimatePresence initial={false}>
        <motion.div
          key={active.src}
          className="hero-rotator__layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: "easeInOut" }}
        >
          <img
            src={active.src}
            alt=""
            aria-hidden="true"
            className={reduceMotion ? "hero-rotator__img" : "hero-rotator__img hero-rotator__img--kenburns"}
            draggable={false}
          />
        </motion.div>
      </AnimatePresence>
      <div className="hero-rotator__scrim" aria-hidden="true" />
      {order.length > 1 ? (
        <div className="hero-rotator__dots" aria-hidden="true">
          {order.map((img, i) => (
            <span key={img.src} className={i === index ? "hero-rotator__dot hero-rotator__dot--on" : "hero-rotator__dot"} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default HeroRotator;
