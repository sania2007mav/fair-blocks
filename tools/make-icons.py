"""Draw the PWA icons with the stdlib only. Run from the repo root."""

import struct
import zlib
from pathlib import Path


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, size, rgba):
    raw = b"".join(b"\x00" + rgba[y * size * 4 : (y + 1) * size * 4] for y in range(size))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def rounded_rect(px, size, x, y, w, h, radius, color):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if xx < 0 or yy < 0 or xx >= size or yy >= size:
                continue
            dx = 0
            dy = 0
            if xx < x + radius and yy < y + radius:
                dx, dy = x + radius - xx, y + radius - yy
            elif xx >= x + w - radius and yy < y + radius:
                dx, dy = xx - (x + w - radius - 1), y + radius - yy
            elif xx < x + radius and yy >= y + h - radius:
                dx, dy = x + radius - xx, yy - (y + h - radius - 1)
            elif xx >= x + w - radius and yy >= y + h - radius:
                dx, dy = xx - (x + w - radius - 1), yy - (y + h - radius - 1)
            if dx or dy:
                if dx * dx + dy * dy > radius * radius:
                    continue
            i = (yy * size + xx) * 4
            px[i : i + 4] = bytes(color)


def icon(size):
    px = bytearray([0, 0, 0, 0] * size * size)
    rounded_rect(px, size, 0, 0, size, size, int(size * 0.22), (61, 78, 196, 255))
    margin = int(size * 0.18)
    gap = int(size * 0.045)
    inner = size - margin * 2
    cell = (inner - gap) // 2
    colors = [(255, 90, 106, 255), (255, 176, 32, 255), (46, 194, 126, 255), (74, 163, 255, 255)]
    radius = max(2, cell // 6)
    index = 0
    for row in range(2):
        for col in range(2):
            x = margin + col * (cell + gap)
            y = margin + row * (cell + gap)
            rounded_rect(px, size, x, y, cell, cell, radius, colors[index])
            index += 1
    return px


def main():
    root = Path(__file__).resolve().parents[1]
    folder = root / "icons"
    folder.mkdir(exist_ok=True)
    for size in (192, 512):
        write_png(folder / f"icon-{size}.png", size, icon(size))
        print("wrote", folder / f"icon-{size}.png")


if __name__ == "__main__":
    main()
