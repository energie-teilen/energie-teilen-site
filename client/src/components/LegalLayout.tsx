import { Link } from "wouter";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

/**
 * LegalLayout
 *
 * The legally mandatory pages sit inside the same shell as everything else.
 *
 * They previously rendered bare — no header, no footer, no way back into the
 * product except one small text link. A visitor who follows an imprint link
 * from a search result or a forwarded email landed outside the site's
 * information architecture entirely, which costs both trust and every path
 * onward.
 */
export function LegalLayout({
  title,
  lead,
  updated,
  children,
}: {
  title: string;
  lead?: string;
  /** ISO date the text was last revised. Shown so a reader can judge currency. */
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main id="main" className="mx-auto w-full max-w-3xl px-6 pb-24 pt-28 sm:pt-32">
        <nav aria-label="Brotkrumen" className="mb-8">
          <ol className="flex items-center gap-2 text-xs text-muted-foreground">
            <li>
              <Link href="/" className="underline-offset-4 hover:text-foreground hover:underline">
                Startseite
              </Link>
            </li>
            <li aria-hidden>·</li>
            <li aria-current="page" className="text-foreground">
              {title}
            </li>
          </ol>
        </nav>

        <header className="space-y-3 border-b border-border/60 pb-8">
          <h1 className="font-display text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl">
            {title}
          </h1>
          {lead ? <p className="text-base leading-8 text-muted-foreground">{lead}</p> : null}
          {updated ? (
            <p className="text-xs text-muted-foreground">
              Stand:{" "}
              <time dateTime={updated}>
                {new Date(updated).toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </time>
            </p>
          ) : null}
        </header>

        {/*
          Typography is set here rather than with a prose plugin: the plugin's
          muted greys did not meet the contrast threshold against this
          background, which an accessibility scan reported as a serious
          violation on all three pages.
        */}
        <div className="legal-prose mt-10 space-y-8">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

/** One titled block of a legal document. */
export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-7 text-foreground/85">{children}</div>
    </section>
  );
}

/**
 * A detail that is not yet available.
 *
 * Rendering the label with an explicit "wird ergänzt" is honest; rendering
 * "[FIRMENNAME]" is not, and neither is silently omitting a required heading.
 */
export function PendingDetail({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-800">
      {label} — wird ergänzt
    </span>
  );
}
