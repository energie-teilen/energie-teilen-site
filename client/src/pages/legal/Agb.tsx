import { LegalLayout, LegalSection, PendingDetail } from "@/components/LegalLayout";
import {
  LEGAL_ENTITY,
  LEGAL_ENTITY_PENDING_DE,
  legalEntityPublishable,
} from "../../../../shared/legal-entity";
import { PILOT_OFFER_FULFILLMENT } from "../../../../shared/pilot-order";
import { PILOT_OFFER_SERVER_CONFIG } from "../../../../shared/schema";

/**
 * Terms for the paid pilot intake.
 *
 * The service description is generated from the same offer definitions the
 * checkout sells, so what a customer agrees to cannot drift from what they are
 * charged for.
 *
 * Clauses that genuinely need drafting — a limitation of liability below the
 * statutory standard, for instance — are ABSENT rather than stubbed. Statutory
 * liability is the safe default; it is a limitation that requires a lawyer, not
 * its omission. Nothing here instructs the reader to fill something in.
 */
export default function Agb() {
  const publishable = legalEntityPublishable();
  const provider = publishable ? LEGAL_ENTITY.name : null;

  return (
    <LegalLayout
      title="Allgemeine Geschäftsbedingungen"
      lead="Bedingungen für die kostenpflichtige Pilotaufnahme."
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

      <LegalSection title="§ 1 Geltungsbereich">
        <p>
          Diese Bedingungen gelten für Verträge über die kostenpflichtige Pilotaufnahme,
          die über diese Website zwischen{" "}
          {provider ?? <PendingDetail label="dem Anbieter" />} (nachfolgend „Anbieter")
          und dem Kunden geschlossen werden.
        </p>
        <p>
          Das Angebot richtet sich an Unternehmen, Eigentümergemeinschaften,
          Projektträger und öffentliche Stellen. Gesetzliche Rechte von Verbrauchern
          bleiben unberührt, soweit ein Vertrag mit einem Verbraucher zustande kommt.
        </p>
      </LegalSection>

      <LegalSection title="§ 2 Leistungsgegenstand">
        <p>
          Der Anbieter erbringt eine strukturierte Aufnahme des Vorhabens in der jeweils
          gebuchten Stufe. Der Leistungsumfang jeder Stufe ist:
        </p>
        <ul>
          {Object.values(PILOT_OFFER_SERVER_CONFIG).map((offer) => (
            <li key={offer.code}>
              <strong>{offer.label}</strong> — {PILOT_OFFER_FULFILLMENT[offer.code].deliverable}
            </li>
          ))}
        </ul>
        <p>
          Geschuldet ist die sorgfältige Erbringung der beschriebenen Leistung, nicht ein
          bestimmter wirtschaftlicher oder behördlicher Erfolg. Rechts-, Steuer- und
          Anlageberatung ist nicht Gegenstand des Vertrags.
        </p>
      </LegalSection>

      <LegalSection title="§ 3 Vertragsschluss">
        <p>
          Die Darstellung der Stufen auf dieser Website ist kein bindendes Angebot. Mit
          dem Absenden des Bezahlvorgangs gibt der Kunde ein Angebot ab. Der Vertrag
          kommt mit der Bestätigung des Anbieters nach erfolgreicher Zahlung zustande.
        </p>
      </LegalSection>

      <LegalSection title="§ 4 Vergütung und Zahlung">
        <p>
          Die Vergütung der gebuchten Stufe wird vor Leistungsbeginn fällig. Die Zahlung
          wird über den Zahlungsdienstleister Stripe abgewickelt. Alle Preise verstehen
          sich zuzüglich der jeweils geltenden Umsatzsteuer.
        </p>
      </LegalSection>

      <LegalSection title="§ 5 Mitwirkung des Kunden">
        <p>
          Der Kunde stellt die für die Bearbeitung erforderlichen Angaben und Unterlagen
          vollständig und zutreffend bereit. Welche Angaben das je Stufe sind, wird vor
          Vertragsschluss ausgewiesen. Verzögerungen, die auf fehlender oder
          unzutreffender Mitwirkung beruhen, gehen nicht zulasten des Anbieters.
        </p>
      </LegalSection>

      <LegalSection title="§ 6 Nutzungsrechte an den Ergebnissen">
        <p>
          Der Kunde erhält an den für ihn erstellten Unterlagen ein einfaches, zeitlich
          und räumlich unbeschränktes Nutzungsrecht für eigene Zwecke einschließlich der
          Vorlage bei Finanzierungspartnern und Behörden. Die zugrunde liegenden Modelle,
          Methoden und Werkzeuge des Anbieters bleiben bei diesem.
        </p>
      </LegalSection>

      <LegalSection title="§ 7 Haftung">
        <p>
          Der Anbieter haftet nach den gesetzlichen Bestimmungen. Die auf dieser Website
          bereitgestellten Berechnungen sind indikativ und beruhen auf den vom Kunden
          gesetzten sowie den ausgewiesenen voreingestellten Annahmen; sie ersetzen keine
          projektspezifische fachliche Prüfung.
        </p>
      </LegalSection>

      <LegalSection title="§ 8 Datenschutz">
        <p>
          Die Verarbeitung personenbezogener Daten richtet sich nach der
          Datenschutzerklärung dieser Website.
        </p>
      </LegalSection>

      <LegalSection title="§ 9 Schlussbestimmungen">
        <p>
          Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des
          UN-Kaufrechts. Ist der Kunde Kaufmann, juristische Person des öffentlichen
          Rechts oder öffentlich-rechtliches Sondervermögen, ist der Sitz des Anbieters
          ausschließlicher Gerichtsstand.
        </p>
        <p>
          Sollte eine Bestimmung dieser Bedingungen unwirksam sein, bleibt die Wirksamkeit
          der übrigen Bestimmungen unberührt.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
