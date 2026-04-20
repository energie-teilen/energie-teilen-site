import { SendEmailCommand } from "@aws-sdk/client-ses";
import { getFromEmail, getInternalNotificationEmail, getSesClient } from "./aws-clients.mjs";

function euroAmount(amountMinor, currency) {
  if (typeof amountMinor !== "number") {
    return "n/a";
  }

  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: (currency || "eur").toUpperCase(),
  }).format(amountMinor / 100);
}

async function sendEmail({ to, subject, text, html }) {
  await getSesClient().send(
    new SendEmailCommand({
      Source: getFromEmail(),
      Destination: {
        ToAddresses: [to],
      },
      Message: {
        Subject: {
          Charset: "UTF-8",
          Data: subject,
        },
        Body: {
          Text: {
            Charset: "UTF-8",
            Data: text,
          },
          Html: {
            Charset: "UTF-8",
            Data: html,
          },
        },
      },
    }),
  );
}

export async function sendCustomerConfirmationEmail(application) {
  const amount = euroAmount(application.amountPaid, application.currency);
  const subject = `Zahlung bestätigt: ${application.offerLabel}`;
  const text = [
    `Hallo ${application.name || ""},`,
    "",
    "vielen Dank. Ihre Zahlung für das Pilotangebot wurde erfolgreich bestätigt.",
    "",
    `Anwendung: ${application.applicationId}`,
    `Leistung: ${application.offerLabel}`,
    `Betrag: ${amount}`,
    `Projektart: ${application.projectType || "n/a"}`,
    `Standort: ${application.location || "n/a"}`,
    "",
    "Als Nächstes können Sie die strukturierte Intake-Erfassung und die Dokumentenbereitstellung abschließen.",
    "",
    "Energie Teilen",
  ].join("\n");

  const html = `
    <p>Hallo ${application.name || ""},</p>
    <p>vielen Dank. Ihre Zahlung für das Pilotangebot wurde erfolgreich bestätigt.</p>
    <ul>
      <li><strong>Anwendung:</strong> ${application.applicationId}</li>
      <li><strong>Leistung:</strong> ${application.offerLabel}</li>
      <li><strong>Betrag:</strong> ${amount}</li>
      <li><strong>Projektart:</strong> ${application.projectType || "n/a"}</li>
      <li><strong>Standort:</strong> ${application.location || "n/a"}</li>
    </ul>
    <p>Als Nächstes können Sie die strukturierte Intake-Erfassung und die Dokumentenbereitstellung abschließen.</p>
    <p>Energie Teilen</p>
  `;

  return sendEmail({
    to: application.email,
    subject,
    text,
    html,
  });
}

export async function sendInternalNotificationEmail(application) {
  const amount = euroAmount(application.amountPaid, application.currency);
  const subject = `Neue bezahlte Pilot-Anwendung: ${application.offerCode}`;
  const text = [
    "Eine neue bezahlte Pilot-Anwendung wurde angelegt.",
    "",
    `Anwendung: ${application.applicationId}`,
    `Leistung: ${application.offerLabel}`,
    `Betrag: ${amount}`,
    `Kontakt: ${application.name || "n/a"}`,
    `E-Mail: ${application.email}`,
    `Telefon: ${application.phone || "n/a"}`,
    `Organisation: ${application.organization || "n/a"}`,
    `Standort: ${application.location || "n/a"}`,
    `Projektart: ${application.projectType || "n/a"}`,
    `Stripe Session: ${application.stripeSessionId}`,
  ].join("\n");

  const html = `
    <p>Eine neue bezahlte Pilot-Anwendung wurde angelegt.</p>
    <ul>
      <li><strong>Anwendung:</strong> ${application.applicationId}</li>
      <li><strong>Leistung:</strong> ${application.offerLabel}</li>
      <li><strong>Betrag:</strong> ${amount}</li>
      <li><strong>Kontakt:</strong> ${application.name || "n/a"}</li>
      <li><strong>E-Mail:</strong> ${application.email}</li>
      <li><strong>Telefon:</strong> ${application.phone || "n/a"}</li>
      <li><strong>Organisation:</strong> ${application.organization || "n/a"}</li>
      <li><strong>Standort:</strong> ${application.location || "n/a"}</li>
      <li><strong>Projektart:</strong> ${application.projectType || "n/a"}</li>
      <li><strong>Stripe Session:</strong> ${application.stripeSessionId}</li>
    </ul>
  `;

  return sendEmail({
    to: getInternalNotificationEmail(),
    subject,
    text,
    html,
  });
}
