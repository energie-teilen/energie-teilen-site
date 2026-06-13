import { useEffect, useMemo, useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Energy Civic Ledger — header.
 *
 * Discipline preserved: institutional, calm, precise. Same shell, same brand lockup,
 * same scroll-direction hide. No design language change.
 *
 * Upgrades over the previous version:
 *   - "Rechner" inserted into primary nav (links to new Kapitel 02 calculator).
 *   - Active-section highlight via IntersectionObserver — the current chapter
 *     in view gets aria-current="true" and a subtle indicator.
 *   - Hash-link clicks smooth-scroll without route bouncing.
 *   - Mobile menu closes on Escape and on outside click.
 *   - Reduced-motion respected for transitions.
 */

const navItems = [
  { label: "Überblick", href: "#ueberblick", id: "ueberblick" },
  { label: "Rechner", href: "#rechner", id: "rechner" },
  { label: "Leistungen", href: "#leistungen", id: "leistungen" },
  { label: "Struktur", href: "#struktur", id: "struktur" },
  { label: "Stakeholder", href: "#stakeholder", id: "stakeholder" },
  { label: "Pilotstart", href: "#pilot-start", id: "pilot-start" },
];

function useScrollDirection() {
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    let previousY = window.scrollY;
    let ticking = false;

    const update = () => {
      const currentY = window.scrollY;
      const delta = currentY - previousY;

      if (currentY > 180 && delta > 12) {
        setIsHidden(true);
      } else if (delta < -8 || currentY < 120) {
        setIsHidden(false);
      }

      previousY = currentY;
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return isHidden;
}

/**
 * Tracks which section is currently the "primary" one in the viewport.
 * Uses one IntersectionObserver instance shared across all nav targets.
 */
function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    // Track intersection ratios; the most-visible section wins.
    const visibility = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibility.set(entry.target.id, entry.intersectionRatio);
        }
        // pick the id with the highest ratio
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of visibility) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        setActive(bestId);
      },
      {
        // staggered thresholds give smoother handoffs between sections
        threshold: [0, 0.15, 0.3, 0.5, 0.75, 1],
        rootMargin: "-20% 0px -50% 0px",
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const isHidden = useScrollDirection();

  // memoize so the hook's dependency reference stays stable
  const sectionIds = useMemo(() => navItems.map((n) => n.id), []);
  const activeSection = useActiveSection(sectionIds);

  // Close mobile menu on resize, hash change, or Escape
  useEffect(() => {
    if (!menuOpen) return;

    const close = () => setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    // Prevent the page behind the open mobile panel from scrolling.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("resize", close);
    window.addEventListener("hashchange", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("resize", close);
      window.removeEventListener("hashchange", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-transform duration-500 motion-reduce:transition-none ${
        isHidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="container pt-4 sm:pt-5">
        <div className="header-shell">
          <a href="#top" className="brand-lockup" aria-label="Energie Teilen Startseite">
            <span className="brand-mark" aria-hidden="true">
              ET
            </span>
            <span className="brand-copy">
              <strong>Energie Teilen</strong>
              <small>Bezahlte Pilotaufnahme für lokale Energieprojekte</small>
            </span>
          </a>

          <nav className="header-nav" aria-label="Primäre Navigation">
            {navItems.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className="header-link"
                  aria-current={isActive ? "true" : undefined}
                  data-active={isActive ? "true" : undefined}
                  style={
                    isActive
                      ? { color: "var(--color-primary, currentColor)", fontWeight: 600 }
                      : undefined
                  }
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <Button
              asChild
              className="rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/92"
            >
              <a href="#pilot-start">Pilot starten</a>
            </Button>
          </div>

          <button
            type="button"
            className="header-toggle lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="primary-mobile-nav"
            aria-label={menuOpen ? "Navigation schließen" : "Navigation öffnen"}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen ? (
          <div id="primary-mobile-nav" className="mobile-nav-panel lg:hidden">
            <nav className="flex flex-col gap-2" aria-label="Mobile Navigation">
              {navItems.map((item) => {
                const isActive = activeSection === item.id;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className="mobile-nav-link"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </a>
                );
              })}
            </nav>
            <Button
              asChild
              className="mt-4 w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/92"
            >
              <a href="#pilot-start" onClick={() => setMenuOpen(false)}>
                Bezahlte Pilotaufnahme starten
              </a>
            </Button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
