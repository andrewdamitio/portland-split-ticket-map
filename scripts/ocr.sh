#!/usr/bin/env bash
# How the OCR text in data/ocr/<county>/ was produced from the scanned county PDFs. You do NOT need to run this
# to rebuild the map: the OCR output is committed, and the OCR-specific corrections in data/config/*.json refer
# to it (a different Tesseract version could read some cells differently).
#
#   scripts/ocr.sh <county-slug>        e.g.  scripts/ocr.sh washington
#
# Requires Poppler (pdftoppm) and Tesseract 5. Pages are rendered at 300 dpi in grayscale and read with
# page-segmentation mode 6 (a single uniform block of text), keeping the spacing between columns.
# Benton's pages are printed sideways and were rotated 90 degrees clockwise before OCR.
set -euo pipefail
county="$1"
root="$(cd "$(dirname "$0")/.." && pwd)"
pdf="$root/data/sources/$county-2024-general.pdf"
out="$root/data/ocr/$county"
tmp="$(mktemp -d)"
mkdir -p "$out"
pdftoppm -r 300 -gray -png "$pdf" "$tmp/$county"
for f in "$tmp"/*.png; do
  OMP_THREAD_LIMIT=1 tesseract "$f" "$out/$(basename "${f%.png}")" --psm 6 -c preserve_interword_spaces=1 quiet &
  while [ "$(jobs -r | wc -l)" -ge 8 ]; do sleep 0.2; done
done
wait
rm -rf "$tmp"
echo "OCR text written to $out"
