#!/usr/bin/env python3
"""Kleine JPEG-Vorschau. Das Original bleibt unverändert."""

import json
import sys
from pathlib import Path

from PIL import Image, ImageFile

ImageFile.LOAD_TRUNCATED_IMAGES = True

MAX_KANTE = 1600


def komprimiere(quelle, ziel, kante=MAX_KANTE):
    bild = Image.open(quelle)
    bild.load()
    bild.thumbnail((kante, kante))
    ausgabe = Path(ziel)
    ausgabe.parent.mkdir(parents=True, exist_ok=True)
    bild.convert("RGB").save(ausgabe, quality=70, optimize=True)
    return {
        "breite": bild.size[0],
        "hoehe": bild.size[1],
        "bytes": ausgabe.stat().st_size,
    }


if __name__ == "__main__":
    print(json.dumps(komprimiere(sys.argv[1], sys.argv[2])))
