"""Erzeugt PWA-Icons (192x192, 512x512) als PNG ohne externe Abhängigkeiten.
Motiv Keto-Dashboard: stilisierte Avocado (Kreis + Kern) auf grünem Hintergrund.
Motiv Kochbuch: aufgeschlagenes Buch auf terrakottafarbenem Hintergrund — eigene, bewusst
andere Farbwelt, damit sich die beiden Homescreen-Symbole klar unterscheiden.
Wird einmalig ausgeführt, danach liegen die PNGs unter icons/ bzw. kochbuch/icons/.
"""
import struct
import zlib
import os

def _write_png(path, size, pixel_at):
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            row.extend(pixel_at(x, y))
        rows.append(bytes([0]) + bytes(row))  # filter type 0 pro Zeile

    raw = b"".join(rows)
    compressed = zlib.compress(raw, 9)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data)))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit, RGB (colortype 2)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(png)

def make_png(path, size):
    bg = (31, 138, 95)       # --accent
    flesh = (200, 230, 150)  # helles Avocado-Fruchtfleisch
    peel = (18, 90, 60)      # dunkler Rand
    seed = (92, 58, 30)      # Kern

    cx, cy = size / 2, size / 2
    r_outer = size * 0.36
    r_inner = size * 0.30
    r_seed = size * 0.11

    def pixel_at(x, y):
        dx, dy = x - cx, (y - cy) * 1.08  # leicht oval (Avocado-Form)
        dist = (dx * dx + dy * dy) ** 0.5
        if dist <= r_seed:
            return seed
        if dist <= r_inner:
            return flesh
        if dist <= r_outer:
            return peel
        return bg

    _write_png(path, size, pixel_at)

def make_kochbuch_png(path, size):
    bg = (181, 101, 29)    # --accent (Kochbuch)
    cover = (255, 250, 243)  # Buchdeckel/Seiten, helles Papierweiß
    spine = (122, 68, 20)    # Buchrücken/Mitte, dunkler

    # Aufgeschlagenes Buch: zwei leicht schräge Seiten, die in der Mitte zusammenlaufen.
    half_w = size * 0.30
    top = size * 0.30
    bottom = size * 0.74
    cx = size / 2
    spine_w = size * 0.018

    def pixel_at(x, y):
        if y < top or y > bottom:
            return bg
        t = (y - top) / (bottom - top)  # 0 oben, 1 unten
        spread = half_w * (0.55 + 0.45 * t)  # Seiten öffnen sich nach unten leicht mehr
        left_edge = cx - spread
        right_edge = cx + spread
        if left_edge <= x <= right_edge:
            if abs(x - cx) <= spine_w:
                return spine
            return cover
        return bg

    _write_png(path, size, pixel_at)

if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    make_png(os.path.join(out_dir, "icon-192.png"), 192)
    make_png(os.path.join(out_dir, "icon-512.png"), 512)
    make_png(os.path.join(out_dir, "icon-maskable-512.png"), 512)

    kb_out_dir = os.path.join(os.path.dirname(__file__), "..", "kochbuch", "icons")
    os.makedirs(kb_out_dir, exist_ok=True)
    make_kochbuch_png(os.path.join(kb_out_dir, "icon-192.png"), 192)
    make_kochbuch_png(os.path.join(kb_out_dir, "icon-512.png"), 512)
    make_kochbuch_png(os.path.join(kb_out_dir, "icon-maskable-512.png"), 512)

    print("Icons erzeugt.")
