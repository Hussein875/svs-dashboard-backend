import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { komprimiere } from "../src/drive-foto.js";

test("große Aufnahme wird zur kleinen Vorschau", async () => {
  const ordner = mkdtempSync(path.join(tmpdir(), "gutachten-foto-"));
  const quelle = path.join(ordner, "gross.jpg");
  const ziel = path.join(ordner, "vorschau.jpg");
  const erzeugt = spawnSync("python3", ["-c", `
from PIL import Image
import random
bild = Image.new("RGB", (4000, 3000))
punkte = bild.load()
rng = random.Random(1)
for y in range(0, 3000, 4):
    for x in range(0, 4000, 4):
        farbe = (rng.randrange(256), rng.randrange(256), rng.randrange(256))
        for dy in range(4):
            for dx in range(4):
                punkte[x+dx, y+dy] = farbe
bild.save(${JSON.stringify(quelle)}, quality=95)
`], { encoding: "utf8" });
  assert.equal(erzeugt.status, 0, erzeugt.stderr);
  const vorschau = await komprimiere(quelle, ziel);
  assert.ok(vorschau.bytes < statSync(quelle).size);
  assert.ok(vorschau.breite <= 1600);
  assert.ok(vorschau.hoehe <= 1600);
});
