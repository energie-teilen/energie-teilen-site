import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import ToolPageLayout from "@/components/ToolPageLayout";
import {
  API_AUTH_DOC,
  API_ENDPOINTS,
  API_GUARANTEES,
  type ApiEndpointDoc,
} from "../../../../shared/api-reference";
import { API_VERSION } from "../../../../shared/api-contract";

/**
 * /api
 *
 * The API reference.
 *
 * Nine endpoints existed with no documentation at all, which meant nobody
 * outside this repository could evaluate them. Everything on this page is
 * rendered from shared/api-reference.ts, and a test checks that every
 * documented path is actually mounted and every mounted path is documented.
 */

function MethodBadge({ method }: { method: ApiEndpointDoc["method"] }) {
  return (
    <span
      className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[0.68rem] font-semibold tracking-wide ${
        method === "GET"
          ? "bg-primary/10 text-primary"
          : "bg-amber-500/15 text-amber-800"
      }`}
    >
      {method}
    </span>
  );
}

function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className="mt-3">
      {label ? (
        <p className="mb-1.5 text-[0.66rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
      ) : null}
      <pre
        tabIndex={0}
        role="region"
        aria-label={label ?? "Codebeispiel"}
        className="overflow-x-auto rounded-xl border border-border/60 bg-background/80 p-4 font-mono text-[0.72rem] leading-6 text-foreground/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {children}
      </pre>
    </div>
  );
}

function Endpoint({ doc }: { doc: ApiEndpointDoc }) {
  const [open, setOpen] = useState(false);
  const id = doc.path.replace(/\W+/g, "-").replace(/^-|-$/g, "");

  return (
    <article id={id} className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <MethodBadge method={doc.method} />
        <code className="font-mono text-sm font-medium text-foreground">{doc.path}</code>
      </div>
      <h3 className="mt-3 font-display text-lg font-semibold tracking-[-0.01em] text-foreground">
        {doc.summary}
      </h3>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">{doc.purpose}</p>

      {/* The parameter table scrolls on narrow viewports; a region a keyboard
          user cannot scroll hides its columns from them entirely. */}
      {doc.parameters.length > 0 ? (
        <div
          className="mt-5 overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          tabIndex={0}
          role="region"
          aria-label={`Parameter von ${doc.method} ${doc.path}`}
        >
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="text-[0.66rem] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Feld</th>
                <th className="pb-2 pr-4 font-medium">Typ</th>
                <th className="pb-2 pr-4 font-medium">Pflicht</th>
                <th className="pb-2 font-medium">Bedeutung</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {doc.parameters.map((p) => (
                <tr key={p.name} className="border-t border-border/50">
                  <td className="py-2.5 pr-4 font-mono text-xs text-foreground">{p.name}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">{p.type}</td>
                  <td className="py-2.5 pr-4 text-xs">
                    {p.required ? (
                      <span className="text-foreground">ja</span>
                    ) : (
                      <span className="text-muted-foreground">nein</span>
                    )}
                  </td>
                  <td className="py-2.5 text-sm leading-6 text-muted-foreground">{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <CodeBlock label="Anfrage">{doc.example}</CodeBlock>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-4 text-sm text-primary underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {open ? "Antwort ausblenden" : "Antwort und Verweigerungen anzeigen"}
      </button>

      {open ? (
        <div className="mt-2">
          <CodeBlock label="Antwort (gekürzt)">{doc.responseExample}</CodeBlock>
          {doc.refuses.length > 0 ? (
            <div className="mt-4">
              <p className="text-[0.66rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Wird abgelehnt
              </p>
              <ul className="mt-2 space-y-1.5">
                {doc.refuses.map((r) => (
                  <li key={r.when} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                      {r.code}
                    </code>
                    <span className="text-muted-foreground">{r.when}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default function ApiReference() {
  return (
    <ToolPageLayout
      path="/api"
      kicker={`API v${API_VERSION}`}
      heading="Dieselbe Engine, hinter einem Schlüssel."
      lede="Neun Endpunkte für Wirtschaftlichkeit, Qualifizierung, Messkonzept, Aufteilung, Abrechnung und Marktkommunikation. Jede Antwort trägt einen Modellstempel und die Herkunft jedes Eingabewerts, und die Engine verweigert die Antwort, wo sie sie nur schätzen könnte."
    >
      <div className="space-y-8">
        {/* What an integrator gets, before the endpoint list */}
        <section className="rounded-[24px] border border-primary/25 bg-primary/5 p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Was auf jeder Antwort steht
          </h2>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {API_GUARANTEES.map((g) => (
              <div key={g.title}>
                <dt className="text-sm font-semibold text-foreground">{g.title}</dt>
                <dd className="mt-1.5 text-sm leading-6 text-muted-foreground">{g.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
            <KeyRound className="h-5 w-5 text-primary" />
            Authentifizierung
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
            {API_AUTH_DOC.description}
          </p>
          <CodeBlock label="Beispiel">{API_AUTH_DOC.example}</CodeBlock>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold tracking-[-0.015em] text-foreground">
            Endpunkte
          </h2>
          {API_ENDPOINTS.map((doc) => (
            <Endpoint key={`${doc.method} ${doc.path}`} doc={doc} />
          ))}
        </section>

        <section className="rounded-[22px] border border-border/70 bg-card p-5 sm:p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Zugang</h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
            Schlüssel werden je Integration ausgegeben und sind einzeln widerrufbar. Für einen
            Zugang genügt eine Nachricht mit dem vorgesehenen Einsatzzweck; der Schlüssel wird
            einmal im Klartext übergeben und danach nur noch als Hash gehalten.
          </p>
        </section>
      </div>
    </ToolPageLayout>
  );
}
