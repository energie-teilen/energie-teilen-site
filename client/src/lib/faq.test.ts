import { describe, it, expect } from "vitest";

import { FAQ, allFaqEntries, faqFor } from "../../../shared/faq";
import { indexableRoutes, routeFor } from "../../../shared/routes";

/**
 * The FAQ is published three ways: rendered on the page, emitted as FAQPage
 * structured data, and inlined into the long-form index at /llms-full.txt. All
 * three read this module, so what is asserted here holds for all three.
 */

describe("the published questions", () => {
  it("attaches every section to a route that exists and is indexable", () => {
    const indexable = new Set(indexableRoutes().map((r) => r.path));
    for (const section of FAQ) {
      expect(routeFor(section.path), section.path).not.toBeNull();
      expect(indexable.has(section.path), `${section.path} is indexable`).toBe(true);
    }
  });

  it("asks each question once across the whole site", () => {
    // The same question answered at two URLs splits whatever ranking either
    // would have earned, and leaves two answers to keep in step.
    const questions = allFaqEntries().map((e) => e.question);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("names one section per route", () => {
    const paths = FAQ.map((s) => s.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("actually asks a question", () => {
    for (const entry of allFaqEntries()) expect(entry.question.trim()).toMatch(/\?$/);
  });

  it("answers at length enough to be quotable on its own", () => {
    // An answer lifted out of context still has to be true and complete. A
    // one-line answer gets paraphrased into something this codebase did not say.
    for (const entry of allFaqEntries()) {
      expect(entry.answer.length, entry.question).toBeGreaterThan(140);
    }
  });

  it("claims no legal admissibility anywhere", () => {
    // The engines assess economic and structural conditions. An answer that
    // drifted into "is permitted" would be the single most damaging sentence
    // on the site.
    for (const entry of allFaqEntries()) {
      expect(entry.answer, entry.question).not.toMatch(/ist (rechtlich )?zulässig|ist erlaubt|ist gestattet/i);
    }
  });

  it("cites no statute, because no citation here has been checked", () => {
    // Verification gate: a paragraph reference is a claim about a published
    // text. Until that text has been read against the code, the answer says
    // what the code does instead.
    for (const entry of allFaqEntries()) {
      expect(entry.answer, entry.question).not.toMatch(/§|\bEEG\b|\bEnWG\b|\bMsbG\b/);
    }
  });

  it("states the interval counts that make this site worth citing", () => {
    const grid = faqFor("/marktkommunikation").map((e) => e.answer).join(" ");
    expect(grid).toContain("92");
    expect(grid).toContain("96");
    expect(grid).toContain("100");
    expect(grid).toContain("35.040");
  });

  it("covers every tool page", () => {
    for (const route of indexableRoutes()) {
      if (route.kind !== "tool" && route.kind !== "reference") continue;
      expect(faqFor(route.path).length, `${route.path} has no questions`).toBeGreaterThan(0);
    }
  });
});
