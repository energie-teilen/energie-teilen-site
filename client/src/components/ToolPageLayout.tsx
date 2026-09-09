import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { routeFor, type RouteDefinition } from "../../../shared/routes";
import { faqFor } from "../../../shared/faq";

/**
 * ToolPageLayout
 *
 * The shell every standalone tool page sits in.
 *
 * Each tool has its own route because a section inside a long page cannot be
 * indexed, cannot be linked to from an answer, and cannot rank for the question
 * it answers. That only pays off if the page around the tool is a real page:
 * a heading that states the question, the tool itself, and a way onward that is
 * not the browser's back button.
 */
export function ToolPageLayout({
  path,
  kicker,
  heading,
  lede,
  children,
  aside,
}: {
  path: string;
  kicker: string;
  heading: string;
  lede: string;
  children: React.ReactNode;
  /** Optional block below the tool: method, caveats, definitions. */
  aside?: React.ReactNode;
}) {
  const route = routeFor(path);
  const faq = faqFor(path);
  const related = (route?.relatedPaths ?? [])
    .map((p) => routeFor(p))
    .filter((r): r is RouteDefinition => r !== null);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main id="main" className="mx-auto w-full max-w-6xl px-6 pb-24 pt-28 sm:pt-32">
        <nav aria-label="Brotkrumen" className="mb-8">
          <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <li>
              <Link href="/" className="underline-offset-4 hover:text-foreground hover:underline">
                Startseite
              </Link>
            </li>
            <li aria-hidden>·</li>
            <li aria-current="page" className="text-foreground">
              {route?.navLabel ?? heading}
            </li>
          </ol>
        </nav>

        <header className="max-w-3xl space-y-4 border-b border-border/60 pb-10">
          <p className="text-[0.72rem] font-medium uppercase tracking-[0.2em] text-primary">
            {kicker}
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-[2.6rem] sm:leading-[1.1]">
            {heading}
          </h1>
          <p className="text-base leading-8 text-muted-foreground sm:text-lg">{lede}</p>
        </header>

        <div className="mt-10">{children}</div>

        {aside ? <div className="mt-14 max-w-3xl">{aside}</div> : null}

        {faq.length > 0 ? (
          <section className="mt-16 max-w-3xl border-t border-border/60 pt-10">
            <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-foreground">
              Häufige Fragen
            </h2>
            {/*
              These answers are also published as structured data. They are
              rendered here because an answer that exists only in a metadata
              block is one a reader cannot check — and a page that says one
              thing to a crawler and another to a person deserves neither's
              trust.
            */}
            <dl className="mt-6 space-y-6">
              {faq.map((entry) => (
                <div key={entry.question} className="space-y-2">
                  <dt className="font-medium leading-7 text-foreground">{entry.question}</dt>
                  <dd className="text-sm leading-7 text-muted-foreground">{entry.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {related.length > 0 ? (
          <section className="mt-16 border-t border-border/60 pt-10">
            <h2 className="text-[0.72rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Weiter
            </h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-3">
              {related.map((r) => (
                <li key={r.path}>
                  <Link
                    href={r.path}
                    className="group flex h-full flex-col gap-2 rounded-[20px] border border-border/70 bg-card p-5 transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="font-display text-base font-semibold text-foreground">
                      {r.navLabel}
                    </span>
                    <span className="text-sm leading-6 text-muted-foreground">{r.answers}</span>
                    <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-xs font-medium text-primary">
                      Öffnen
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}

export default ToolPageLayout;
