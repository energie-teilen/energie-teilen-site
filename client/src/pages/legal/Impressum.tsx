import { LegalLayout, LegalSection, PendingDetail } from "@/components/LegalLayout";
import {
  LEGAL_ENTITY,
  LEGAL_ENTITY_PENDING_DE,
  formattedAddress,
  legalEntityPublishable,
} from "../../../../shared/legal-entity";

/**
 * Imprint.
 *
 * Every detail comes from shared/legal-entity.ts. Nothing on this page is
 * written inline, so there is exactly one place to fill in and no way for a
 * template value to survive into production: legal-entity.test.ts rejects
 * placeholder shapes, and the release gate fails while the record is
 * incomplete.
 *
 * Until then the page states plainly that the details are being added rather
 * than displaying bracketed placeholders, which would be worse than useless.
 */
export default function Impressum() {
  const publishable = legalEntityPublishable();
  const address = formattedAddress();

  return (
    <LegalLayout
      title="Impressum"
      lead="Anbieterkennzeichnung und Kontaktangaben."
      updated="2026-09-08"
    >
      {!publishable ? (
        <div
          role="status"
          className="rounded-2xl border border-amber-500/40 bg-amber-500/8 p-5 text-sm leading-7 text-foreground/90"
        >
          {LEGAL_ENTITY_PENDING_DE}
        </div>
      ) : null}

      <LegalSection title="Anbieter">
        {address ? (
          <address>
            {address.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        ) : (
          <PendingDetail label="Firmierung und Anschrift" />
        )}
      </LegalSection>

      <LegalSection title="Vertreten durch">
        {publishable ? <p>{LEGAL_ENTITY.representedBy}</p> : <PendingDetail label="Vertretungsberechtigte Person" />}
      </LegalSection>

      <LegalSection title="Kontakt">
        <p>
          E-Mail:{" "}
          <a href={`mailto:${LEGAL_ENTITY.email}`}>{LEGAL_ENTITY.email}</a>
        </p>
        <p>
          Telefon:{" "}
          {publishable ? LEGAL_ENTITY.phone : <PendingDetail label="Telefonnummer" />}
        </p>
      </LegalSection>

      <LegalSection title="Registereintrag">
        {LEGAL_ENTITY.registerCourt && LEGAL_ENTITY.registerNumber ? (
          <p>
            {LEGAL_ENTITY.registerCourt}
            <br />
            {LEGAL_ENTITY.registerNumber}
          </p>
        ) : publishable ? (
          <p>Für die Rechtsform des Anbieters besteht keine Registereintragung.</p>
        ) : (
          <PendingDetail label="Registergericht und Registernummer" />
        )}
      </LegalSection>

      <LegalSection title="Umsatzsteuer-Identifikationsnummer">
        {LEGAL_ENTITY.vatId ? (
          <p>{LEGAL_ENTITY.vatId}</p>
        ) : publishable ? (
          <p>Es wurde keine Umsatzsteuer-Identifikationsnummer erteilt.</p>
        ) : (
          <PendingDetail label="USt-IdNr." />
        )}
      </LegalSection>

      {LEGAL_ENTITY.contentResponsible ? (
        <LegalSection title="Redaktionell verantwortlich">
          <address>
            <span className="block">{LEGAL_ENTITY.contentResponsible.name}</span>
            <span className="block">{LEGAL_ENTITY.contentResponsible.address}</span>
          </address>
        </LegalSection>
      ) : null}

      <LegalSection title="Verbraucherstreitbeilegung">
        {LEGAL_ENTITY.disputeResolution.participates && LEGAL_ENTITY.disputeResolution.body ? (
          <p>
            Der Anbieter nimmt am Streitbeilegungsverfahren vor folgender Stelle teil:{" "}
            {LEGAL_ENTITY.disputeResolution.body}
          </p>
        ) : (
          <p>
            Der Anbieter ist nicht bereit und nicht verpflichtet, an
            Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
            teilzunehmen.
          </p>
        )}
      </LegalSection>

      <LegalSection title="Haftung für Inhalte und Links">
        <p>
          Die Inhalte dieser Seiten wurden mit Sorgfalt erstellt. Für die Richtigkeit,
          Vollständigkeit und Aktualität der Inhalte wird keine Gewähr übernommen. Für
          Inhalte externer Links sind ausschließlich deren Betreiber verantwortlich; zum
          Zeitpunkt der Verlinkung waren keine Rechtsverstöße erkennbar.
        </p>
        <p>
          Die auf dieser Seite bereitgestellten Berechnungen sind indikativ. Sie stellen
          keine Rechts-, Steuer- oder Anlageberatung dar und ersetzen keine
          projektspezifische Prüfung.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
