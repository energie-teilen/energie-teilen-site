import { Link } from "wouter";

/**
 * DATENSCHUTZERKLÄRUNG — required by GDPR Art. 13.
 * This is a structured starting point reflecting the data flows actually
 * present in this codebase (lead forms, Stripe, Resend, Vercel, Google Fonts,
 * Plausible). Have a German data-protection lawyer finalise it. Strongly
 * consider self-hosting the web fonts to avoid the Google-Fonts transfer issue.
 */
export default function Datenschutz() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 prose prose-neutral">
      <Link href="/" className="text-sm no-underline opacity-70 hover:opacity-100">
        ← Zur Startseite
      </Link>
      <h1>Datenschutzerklärung</h1>

      <h2>1. Verantwortlicher</h2>
      <p>
        Verantwortlich für die Datenverarbeitung auf dieser Website ist:
        <br />
        [FIRMENNAME], [ANSCHRIFT], E-Mail:{" "}
        <a href="mailto:kontakt@energie-teilen.de">kontakt@energie-teilen.de</a>.
      </p>

      <h2>2. Verarbeitung bei Kontakt- und Lead-Formularen</h2>
      <p>
        Wenn Sie den Mieterstrom-Rechner-Bericht anfordern oder eine
        Pilotaufnahme starten, verarbeiten wir die von Ihnen angegebenen Daten
        (u. a. Name, E-Mail-Adresse, Organisation, Standort, Projektangaben).
        Rechtsgrundlage ist die Anbahnung bzw. Erfüllung eines Vertrags
        (Art. 6 Abs. 1 lit. b DSGVO) sowie Ihre Einwilligung
        (Art. 6 Abs. 1 lit. a DSGVO), soweit erteilt.
      </p>

      <h2>3. Zahlungsabwicklung (Stripe)</h2>
      <p>
        Zahlungen werden über Stripe Payments Europe Ltd. abgewickelt. Dabei
        werden die für die Zahlung erforderlichen Daten an Stripe übermittelt.
        Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.
      </p>

      <h2>4. E-Mail-Versand (Resend) und Hosting (Vercel)</h2>
      <p>
        Benachrichtigungen werden über Resend versendet; die Website wird bei
        Vercel gehostet. Beide verarbeiten dabei technische Daten
        (z. B. Server-Logs) im Rahmen einer Auftragsverarbeitung.
      </p>

      <h2>5. Webschriften</h2>
      <p>
        [Aktuell werden Schriftarten von Google Fonts geladen. Empfehlung:
        Schriften selbst hosten, um eine Übermittlung der IP-Adresse an Google
        zu vermeiden. Bis dahin hier die Google-Fonts-Verarbeitung offenlegen.]
      </p>

      <h2>6. Reichweitenmessung (Plausible)</h2>
      <p>
        Zur datensparsamen Reichweitenmessung setzen wir Plausible Analytics
        ein. Plausible verwendet keine Cookies und erstellt keine
        personenbezogenen Profile. Rechtsgrundlage ist unser berechtigtes
        Interesse (Art. 6 Abs. 1 lit. f DSGVO).
      </p>

      <h2>7. Ihre Rechte</h2>
      <p>
        Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung
        der Verarbeitung, Datenübertragbarkeit und Widerspruch sowie das Recht,
        sich bei einer Aufsichtsbehörde zu beschweren. Erteilte Einwilligungen
        können Sie jederzeit mit Wirkung für die Zukunft widerrufen.
      </p>

      <p className="text-sm opacity-60">
        Hinweis: Strukturentwurf. Vor Veröffentlichung anwaltlich finalisieren.
      </p>
    </main>
  );
}
