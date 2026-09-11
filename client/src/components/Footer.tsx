import { ArrowUpRight } from "lucide-react";
import { navRoutes } from "../../../shared/routes";
import { contactEmail, operatorLocality } from "../../../shared/legal-entity";

/**
 * Energy Civic Ledger — footer.
 *
 * Closing page of a professional operating document. Restrained, precise.
 *
 * Upgrades over the previous version:
 *   - The "Werkzeuge" column is generated from the route manifest, so every
 *     tool that exists is linked and none is advertised that does not.
 *   - A "Rechtliches" column for Impressum, Datenschutz and AGB.
 *   - Final CTA strip routes warm readers directly into the paid pilot intake.
 *   - <address> with the contact mailbox and, once the operator record is
 *     publishable, its locality — both read from shared/legal-entity.ts. No
 *     city is shown that the record does not state.
 *   - All design tokens, classes, and tone preserved.
 */

const navigationLinks = [
  { label: "Überblick", href: "#ueberblick" },
  { label: "Rechner", href: "#rechner" },
  { label: "Leistungen", href: "#leistungen" },
  { label: "Struktur", href: "#struktur" },
  { label: "Stakeholder", href: "#stakeholder" },
  { label: "Pilotstart", href: "#pilot-start" },
];

/*
 * Read from the route manifest rather than listed here, so the footer cannot
 * advertise a tool that does not exist or omit one that does. Two of these
 * were previously advertised as still in preparation after being built.
 */
const tools = navRoutes().map((r) => ({ label: r.navLabel, href: r.path, note: undefined as string | undefined }));

const legal = [
  { label: "Impressum", href: "/impressum" },
  { label: "Datenschutz", href: "/datenschutz" },
  { label: "AGB", href: "/agb" },
];

export default function Footer() {
  const email = contactEmail();
  const locality = operatorLocality();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border/70 bg-[linear-gradient(180deg,rgba(245,241,233,0.82),rgba(239,234,225,0.96))]">
      <div className="container py-10 sm:py-12">
        {/* HEADLINE BAND */}
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
              Energie Teilen verbindet bezahlte Erstqualifizierung, strukturierte
              Projektaufnahme und saubere operative Vorbereitung in einer digitalen
              Oberfläche, die Eigentümern, Quartieren, Projektpartnern und
              institutionellen Akteuren einen klaren nächsten Schritt gibt.
            </p>
          </div>

          {/* FINAL CTA STRIP — warm readers route into paid pilot */}
          <div className="rounded-[28px] border border-primary/15 bg-primary/6 p-6">
            <p className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">
              Nächster Schritt
            </p>
            <p className="mt-3 font-display text-xl font-semibold leading-snug tracking-[-0.02em] text-foreground">
              Konstellation als bezahlte Pilotaufnahme starten.
            </p>
            <a
              href="#pilot-start"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Pilot starten
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </div>

        {/* COLUMN BAND — three columns of links */}
        <div className="mt-12 grid gap-10 border-t border-border/70 pt-10 md:grid-cols-3">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Navigation
            </p>
            <div className="flex flex-col gap-2">
              {navigationLinks.map((item) => (
                <a
                  key={item.href + item.label}
                  href={item.href}
                  className="text-sm text-foreground transition-opacity hover:opacity-70"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Werkzeuge
            </p>
            <div className="flex flex-col gap-2">
              {tools.map((item) =>
                item.note ? (
                  // Not built yet — render as a non-clickable roadmap label so it
                  // never pretends to be a working tool (was a misleading link).
                  <span
                    key={item.label}
                    className="text-sm text-muted-foreground"
                    aria-disabled="true"
                  >
                    {item.label}
                    <span className="ml-2 text-xs opacity-70">· {item.note}</span>
                  </span>
                ) : (
                  <a
                    key={item.label}
                    href={item.href}
                    className="text-sm text-foreground transition-opacity hover:opacity-70"
                  >
                    {item.label}
                  </a>
                ),
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-3">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Operativer Kontakt
              </p>
              <address className="not-italic space-y-2 text-sm text-foreground">
                {locality ? <p>{locality}</p> : null}
                {email ? (
                  <a
                    href={`mailto:${email}`}
                    className="block text-muted-foreground transition-opacity hover:opacity-70"
                  >
                    {email}
                  </a>
                ) : null}
              </address>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Rechtliches
              </p>
              <div className="flex flex-col gap-2">
                {legal.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="text-sm text-foreground transition-opacity hover:opacity-70"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* CLOSING META */}
        <div className="mt-10 flex flex-col gap-3 border-t border-border/70 pt-5 text-xs uppercase tracking-[0.14em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {year} Energie Teilen</span>
          <span>Germany-focused paid pilot intake and structuring workflow</span>
        </div>
      </div>
    </footer>
  );
}
