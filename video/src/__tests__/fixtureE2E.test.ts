/**
 * Fixture-level e2e smoke tests for composition selection and schema validity.
 *
 * This keeps the "import any user/year JSON and render" path honest by checking
 * that real fixture documents parse and route to the expected composition.
 */
import { describe, expect, it } from "vitest";
import { documentSchema, type SkylineDocument } from "../schema";
import { pickComposition } from "../../scripts/render";

import sampleYear from "../../fixtures/sample-year.json";
import sparseYear from "../../fixtures/sparse-year.json";
import maxedYear from "../../fixtures/maxed-year.json";
import leapYear from "../../fixtures/leap-year.json";
import emptyYear from "../../fixtures/empty-year.json";
import singleFull from "../../fixtures/single-full.json";
import mixedFull from "../../fixtures/mixed-full.json";

const SINGLE_FIXTURES: Array<[string, SkylineDocument]> = [
  ["sample-year", sampleYear as SkylineDocument],
  ["sparse-year", sparseYear as SkylineDocument],
  ["maxed-year", maxedYear as SkylineDocument],
  ["leap-year", leapYear as SkylineDocument],
  ["empty-year", emptyYear as SkylineDocument],
  ["single-full", singleFull as SkylineDocument],
];

const MULTI_FIXTURES: Array<[string, SkylineDocument]> = [
  ["mixed-full", mixedFull as SkylineDocument],
];

describe("fixture e2e routing", () => {
  for (const [name, fixture] of SINGLE_FIXTURES) {
    it(`${name} parses and routes to SkylineYear`, () => {
      const doc = documentSchema.parse(fixture);
      expect(doc.years.length).toBe(1);
      expect(pickComposition(doc)).toBe("SkylineYear");
    });
  }

  for (const [name, fixture] of MULTI_FIXTURES) {
    it(`${name} parses and routes to SkylineFull`, () => {
      const doc = documentSchema.parse(fixture);
      expect(doc.years.length).toBeGreaterThan(1);
      expect(pickComposition(doc)).toBe("SkylineFull");
    });
  }
});

