import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Energy Civic Ledger design reminder for this file:
 * The header must feel institutional, calm, and precise.
 * It should borrow the portfolio's custom navigation discipline,
 * but remain tailored only to Energie Teilen.
 */

const navItems = [
  { label: "Überblick", href: "#ueberblick" },
  { label: "Leistungen", href: "#leistungen" },
  { label: "Struktur", href: "#struktur" },
  { label: "Stakeholder", href: "#stakeholder" },
  { label: "Pilotstart", href: "#pilot-start" },
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

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const isHidden = useScrollDirection();

  useEffect(() => {
    if (!menuOpen) return;

    const close = () => setMenuOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("hashchange", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("hashchange", close);
    };
  }, [menuOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-transform duration-500 ${
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
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className="header-link">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <Button asChild className="rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/92">
              <a href="#pilot-start">Pilot starten</a>
            </Button>
          </div>

          <button
            type="button"
            className="header-toggle lg:hidden"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Navigation schließen" : "Navigation öffnen"}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen ? (
          <div className="mobile-nav-panel lg:hidden">
            <nav className="flex flex-col gap-2" aria-label="Mobile Navigation">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="mobile-nav-link"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <Button asChild className="mt-4 w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/92">
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
