import assert from "node:assert/strict";
import test from "node:test";
import { datensatzAusBd } from "../src/bd-lesen.js";

test("unklare Reifenangaben bleiben leer", () => {
  const daten = datensatzAusBd({
    kuerzel: "OS",
    kilometerstand: "112450",
    kilometerstandLesbar: true,
    hu: "11/2026",
    huLesbar: true,
    fahrbereitschaft: "nicht verkehrssicher",
    hergang: ["geparkt"],
    polizei: true,
    bereifung: {
      profiltiefe: "4",
      hersteller: "Hanwar",
      herstellerLesbar: false,
      dimension: "",
      dimensionLesbar: false,
      felgen: "Aluminium",
    },
    vorschaedenAngegeben: true,
  });
  assert.equal(daten.kuerzel, "OS");
  assert.equal(daten.kilometerstand.wert, "112450");
  assert.equal(daten.schilderung.wert, "Parkplatzunfall");
  assert.equal(daten.bereifung.lesbar, false);
  assert.equal(JSON.stringify(daten.bereifung).includes("Hanwar"), false);
  assert.equal(daten.polizei.angegeben, true);
});
