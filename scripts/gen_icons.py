"""Erzeugt PWA-Icons (192x192, 512x512) als PNG ohne externe Abhängigkeiten.
Motiv: stilisierte Avocado (Kreis + Kern) auf grünem Hintergrund, passend zum App-Thema.
Wird einmalig ausgeführt, danach liegen die PNGs unter icons/.
"""
import struct
import zlib
import os

def make_png(path, size):
    bg = (31, 138, 95)       # --accent
    flesh = (200, 230, 150)  # helles Avocado-Fruchtfleisch
    peel = (18, 90, 60)      # dunkler Rand
    seed = (92, 58, 30)      # Kern

    cx, cy = size / 2, size / 2
    r_outer = size * 0.36
    r_inner = size * 0.30
    r_seed = size * 0.11

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            dx, dy = x - cx, (y - cy) * 1.08  # leicht oval (Avocado-Form)
            dist = (dx * dx + dy * dy) ** 0.5
            if dist <= r_seed:
                col = seed
            elif dist <= r_inner:
                col = flesh
            elif dist <= r_outer:
                col = peel
            else:
                col = bg
            row.extend(col)
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

if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    make_png(os.path.join(out_dir, "icon-192.png"), 192)
    make_png(os.path.join(out_dir, "icon-512.png"), 512)
    make_png(os.path.join(out_dir, "icon-maskable-512.png"), 512)
    print("Icons erzeugt.")
