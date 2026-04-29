/**
 * Energy Civic Ledger design reminder for this file:
 * The footer should feel like the closing page of a professional operating document.
 * Keep it precise, restrained, and specific to Energie Teilen.
 */

const footerLinks = [
  { label: "Überblick", href: "#ueberblick" },
  { label: "Leistungen", href: "#leistungen" },
  { label: "Struktur", href: "#struktur" },
  { label: "Stakeholder", href: "#stakeholder" },
  { label: "Pilotstart", href: "#pilot-start" },
];

export default function Footer() {
  return (
    <footer className="border-t border-border/70 bg-[linear-gradient(180deg,rgba(245,241,233,0.82),rgba(239,234,225,0.96))]">
      <div className="container py-10 sm:py-12">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div className="space-y-5">
            <div className="brand-lockup brand-lockup-footer">
              <span className="brand-mark" aria-hidden="true">
                ET
              </span>
              <span className="brand-copy">
                <strong>Energie Teilen</strong>
                <small>Professionelle Pilotaufnahme für lokale Energieprojekte</small>
              </span>
            </div>
            <p className="max-w-2xl text-base leading-8 text-muted-foreground">
              Energie Teilen verbindet bezahlte Erstqualifizierung, strukturierte Projektaufnahme und saubere operative
              Vorbereitung in einer digitalen Oberfläche, die Eigentümern, Quartieren, Projektpartnern und
              institutionellen Akteuren einen klaren nächsten Schritt gibt.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Navigation</p>
              <div className="flex flex-col gap-2">
                {footerLinks.map((item) => (
                  <a key={item.href} href={item.href} className="text-sm text-foreground transition-opacity hover:opacity-70">
                    {item.label}
                  </a>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Operativer Kontakt</p>
              <div className="space-y-2 text-sm text-foreground">
                <p>Frankfurt am Main, Deutschland</p>
                <a href="#pilot-start" className="block transition-opacity hover:opacity-70">
                  Pilotaufnahme starten
                </a>
                <a href="mailto:vincenzo.grimaldi.engineering@gmail.com" className="block text-muted-foreground transition-opacity hover:opacity-70">
                  vincenzo.grimaldi.engineering@gmail.com
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border/70 pt-5 text-xs uppercase tracking-[0.14em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© Energie Teilen</span>
          <span>Germany-focused paid pilot intake and structuring workflow</span>
        </div>
      </div>
    </footer>
  );
}
