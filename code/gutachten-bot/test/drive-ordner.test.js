import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDriveFolderId } from "../src/drive-ordner.js";

test("Drive-Ordner-ID aus Share-Link und Roh-ID", () => {
  const id = "1C3O-9HqkF_QbmPCL2BqZ7BS0QgyUbNjG";
  assert.equal(
    normalizeDriveFolderId(`https://drive.google.com/drive/folders/${id}?usp=share_link`),
    id,
  );
  assert.equal(normalizeDriveFolderId(`${id}?usp=share_link`), id);
  assert.equal(normalizeDriveFolderId(id), id);
  assert.equal(normalizeDriveFolderId(""), "");
});
