import { Link } from "wouter";

/**
 * AGB — terms for the paid pilot-intake service.
 * Structured skeleton only. The B2C/B2B distinction (esp. the right of
 * withdrawal, § 312g BGB) materially changes the wording — have a lawyer draft
 * the final version against your actual service description and pricing.
 */
export default function Agb() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 prose prose-neutral">
      <Link href="/" className="text-sm no-underline opacity-70 hover:opacity-100">
        ← Zur Startseite
      </Link>
      <h1>Allgemeine Geschäftsbedingungen</h1>

      <h2>§ 1 Geltungsbereich</h2>
      <p>
        Diese AGB gelten für alle über diese Website geschlossenen Verträge über
        die bezahlte Pilotaufnahme zwischen [FIRMENNAME] (nachfolgend „Anbieter")
        und dem Kunden.
      </p>

      <h2>§ 2 Leistungsgegenstand</h2>
      <p>
        Der Anbieter erbringt eine strukturierte Pilotaufnahme für lokale
        Energieprojekte in drei Stufen (Eligibility Check, Structuring Package,
        Full Preparation Mandate). Der konkrete Leistungsumfang der jeweiligen
        Stufe wird vor Vertragsschluss beschrieben. Es wird keine Rechts-,
        Steuer- oder Anlageberatung geschuldet.
      </p>

      <h2>§ 3 Vertragsschluss und Zahlung</h2>
      <p>
        Der Vertrag kommt mit erfolgreicher Bezahlung über den Zahlungsdienst
        Stripe zustande. Die Vergütung ist im Voraus fällig.
      </p>

      <h2>§ 4 Mitwirkungspflichten</h2>
      <p>
        Der Kunde stellt die für die Bearbeitung erforderlichen Informationen
        und Unterlagen vollständig und zutreffend bereit.
      </p>

      <h2>§ 5 Haftung</h2>
      <p>
        Der Anbieter haftet nach den gesetzlichen Bestimmungen. [Haftungs-
        beschränkungen für einfache Fahrlässigkeit anwaltlich ausgestalten.]
      </p>

      <h2>§ 6 Widerruf</h2>
      <p>
        [Bei Verbrauchern: Widerrufsrecht nach § 312g BGB und entsprechende
        Belehrung einfügen. Bei reinem B2B-Geschäft anpassen.]
      </p>

      <h2>§ 7 Schlussbestimmungen</h2>
      <p>
        Es gilt deutsches Recht. Sollten einzelne Bestimmungen unwirksam sein,
        bleibt der übrige Vertrag wirksam.
      </p>

      <p className="text-sm opacity-60">
        Hinweis: Strukturentwurf. Vor Veröffentlichung anwaltlich ausarbeiten.
      </p>
    </main>
  );
}
