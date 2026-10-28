import assert from "node:assert/strict";
import test from "node:test";
import { istGeminiRateLimit } from "../src/gemini-lesen.js";

test("429 und 503 gelten als Rate-Limit für Retry", () => {
  assert.equal(istGeminiRateLimit(429), true);
  assert.equal(istGeminiRateLimit(503), true);
  assert.equal(istGeminiRateLimit(400), false);
});
