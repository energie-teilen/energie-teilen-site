import { Link } from "wouter";
import { Compass } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

/**
 * 404.
 *
 * Previously this page was untouched scaffolding: English copy on a
 * German-language product, a colour palette from a different design system,
 * and a button instead of a link — so the only way onward was not a real
 * navigation target.
 *
 * A 404 is a routing accident that still costs a visit. This one keeps the
 * visitor inside the site, in the product's own language, and offers the three
 * destinations that are actually worth reaching.
 */

const DESTINATIONS = [
  {
    href: "/#rechner",
    title: "Wirtschaftlichkeit rechnen",
    body: "Drei Szenarien, dokumentierte Annahmen, Bericht als PDF.",
  },
  {
    href: "/#leistungen",
    title: "Leistungen ansehen",
    body: "Was die Pilotaufnahme je Stufe umfasst.",
  },
  {
    href: "/#pilot-start",
    title: "Pilotaufnahme starten",
    body: "Der nächste Schritt, wenn die Konstellation trägt.",
  },
];

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main id="main" className="mx-auto w-full max-w-3xl px-6 pb-24 pt-32">
        <p className="text-[0.72rem] font-medium uppercase tracking-[0.22em] text-primary">
          Fehler 404
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl">
          Diese Seite gibt es nicht.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-8 text-muted-foreground">
          Die aufgerufene Adresse führt ins Leere — möglicherweise wurde sie geändert
          oder der Link ist unvollständig. Von hier aus kommen Sie direkt weiter:
        </p>

        <ul className="mt-10 grid gap-3">
          {DESTINATIONS.map((d) => (
            <li key={d.href}>
              <Link
                href={d.href}
                className="group flex items-start gap-4 rounded-[20px] border border-border/70 bg-card p-5 transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Compass
                  aria-hidden
                  className="mt-0.5 h-5 w-5 shrink-0 text-primary/70 transition-colors group-hover:text-primary"
                />
                <span className="min-w-0">
                  <span className="block font-display text-base font-semibold text-foreground">
                    {d.title}
                  </span>
                  <span className="mt-1 block text-sm leading-7 text-muted-foreground">
                    {d.body}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-sm leading-7 text-muted-foreground">
          Nichts davon passt?{" "}
          <Link href="/" className="text-primary underline underline-offset-4">
            Zur Startseite
          </Link>
          .
        </p>
      </main>
      <Footer />
    </div>
  );
}
