import { LegalLayout, LegalSection, PendingDetail } from "@/components/LegalLayout";
import {
  LEGAL_ENTITY,
  LEGAL_ENTITY_PENDING_DE,
  formattedAddress,
  legalEntityPublishable,
} from "../../../../shared/legal-entity";

/**
 * Privacy notice.
 *
 * Describes the data flows this codebase actually has — the lead form, Stripe
 * Checkout, Resend, the hosting platform, and Plausible — and nothing it does
 * not. A notice that lists processors the application never contacts is as
 * wrong as one that omits processors it does.
 *
 * The controller's identity comes from shared/legal-entity.ts, so it cannot
 * disagree with the imprint.
 */
export default function Datenschutz() {
  const publishable = legalEntityPublishable();
  const address = formattedAddress();

  return (
    <LegalLayout
      title="Datenschutzerklärung"
      lead="Welche Daten diese Website verarbeitet, wozu, auf welcher Rechtsgrundlage und wie lange."
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

      <LegalSection title="1. Verantwortlicher">
        {address ? (
          <address>
            {address.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
            <span className="mt-2 block">
              E-Mail: <a href={`mailto:${LEGAL_ENTITY.email}`}>{LEGAL_ENTITY.email}</a>
            </span>
          </address>
        ) : (
          <>
            <PendingDetail label="Verantwortliche Stelle" />
            <p className="mt-2">
              E-Mail: <a href={`mailto:${LEGAL_ENTITY.email}`}>{LEGAL_ENTITY.email}</a>
            </p>
          </>
        )}
      </LegalSection>

      <LegalSection title="2. Berechnungen im Rechner">
        <p>
          Die Wirtschaftlichkeitsberechnung läuft vollständig in Ihrem Browser. Die von
          Ihnen eingestellten Werte werden dabei nicht an uns übertragen. Sie werden
          ausschließlich lokal in Ihrem Browser gespeichert, damit Ihre Konstellation
          beim nächsten Besuch noch vorliegt; Sie können diese Speicherung jederzeit
          über die Einstellungen Ihres Browsers löschen.
        </p>
      </LegalSection>

      <LegalSection title="3. Berichtsanforderung und Pilotaufnahme">
        <p>
          Fordern Sie den Bericht an oder starten Sie eine Pilotaufnahme, verarbeiten wir
          die von Ihnen angegebenen Daten — insbesondere E-Mail-Adresse sowie die
          Angaben zu Ihrem Vorhaben. Rechtsgrundlage ist die Durchführung
          vorvertraglicher Maßnahmen und die Erfüllung des Vertrags
          (Art. 6 Abs. 1 lit. b DSGVO) sowie, soweit Sie sie erteilt haben, Ihre
          Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Eine erteilte Einwilligung können
          Sie jederzeit mit Wirkung für die Zukunft widerrufen.
        </p>
      </LegalSection>

      <LegalSection title="4. Zahlungsabwicklung">
        <p>
          Zahlungen werden über Stripe abgewickelt. Beim Start eines Bezahlvorgangs
          werden Sie zu Stripe weitergeleitet; die Zahlungsdaten geben Sie dort ein und
          sie erreichen uns nicht. Wir erhalten von Stripe die Information, ob eine
          Zahlung erfolgt ist, sowie die zur Zuordnung nötigen Angaben.
          Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
        </p>
      </LegalSection>

      <LegalSection title="5. E-Mail-Versand und Hosting">
        <p>
          Benachrichtigungen und Bestätigungen versenden wir über Resend. Die Website
          wird bei Vercel gehostet. Beide verarbeiten dabei technische Daten wie
          Server-Logdateien im Rahmen einer Auftragsverarbeitung nach Art. 28 DSGVO.
        </p>
      </LegalSection>

      <LegalSection title="6. Schriftarten">
        <p>
          Schriftarten werden von dieser Website selbst ausgeliefert. Es findet keine
          Verbindung zu externen Schriftanbietern und damit keine Übermittlung Ihrer
          IP-Adresse an Dritte zu diesem Zweck statt.
        </p>
      </LegalSection>

      <LegalSection title="7. Reichweitenmessung">
        <p>
          Zur datensparsamen Reichweitenmessung setzen wir Plausible Analytics ein.
          Plausible verwendet keine Cookies, speichert keine geräteübergreifenden
          Kennungen und bildet keine personenbezogenen Profile. Rechtsgrundlage ist
          unser berechtigtes Interesse an einer Auswertung der Nutzung
          (Art. 6 Abs. 1 lit. f DSGVO).
        </p>
      </LegalSection>

      <LegalSection title="8. Speicherdauer">
        <p>
          Wir speichern personenbezogene Daten so lange, wie es für den jeweiligen Zweck
          erforderlich ist. Anfragen und Projektdaten löschen wir, sobald der Vorgang
          abgeschlossen ist und keine gesetzlichen Aufbewahrungsfristen entgegenstehen;
          für steuerlich relevante Unterlagen gelten die handels- und steuerrechtlichen
          Fristen.
        </p>
      </LegalSection>

      <LegalSection title="9. Ihre Rechte">
        <p>
          Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der
          Verarbeitung, Datenübertragbarkeit und Widerspruch. Außerdem können Sie sich
          bei einer Datenschutz-Aufsichtsbehörde beschweren.
        </p>
        <p>
          Für Auskunft, Löschung oder Widerspruch genügt eine formlose Nachricht an{" "}
          <a href={`mailto:${LEGAL_ENTITY.email}`}>{LEGAL_ENTITY.email}</a>.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
