import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { baueDatensatz } from "../src/datensatz-bauen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("2102-Fixtures ergeben vollständige Pflichtfelder-Basis", async () => {
  const basis = path.join(__dirname, "../data");
  const ae = JSON.parse(await readFile(path.join(basis, "2102-26-ae.json"), "utf8"));
  const bd = JSON.parse(await readFile(path.join(basis, "2102-26-bd.json"), "utf8"));
  const datensatz = baueDatensatz({ ae, bd, kuerzel: "OS" });
  assert.equal(datensatz.kuerzel, "OS");
  assert.equal(datensatz.auftraggeber.name, "Aras Dawd Psi");
  assert.equal(datensatz.kennzeichen.wert, "HB-AA 455");
  assert.equal(datensatz.kilometerstand.wert, "112450");
  assert.equal(datensatz.schadenfotos.vorneLinks, true);
  assert.equal(datensatz.schadenfotos.hintenLinks, true);
});
