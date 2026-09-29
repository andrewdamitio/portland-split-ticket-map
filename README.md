# Oregon 2024: legislative Democrats vs. Harris, precinct by precinct

An interactive map (`index.html`) comparing how Oregon's State House and State Senate Democrats ran against
Kamala Harris in November 2024, in every precinct of all 36 counties. It is built on a complete precinct-level
dataset of the 2024 President, State Senate and State House results, extracted from each county's official
results report. Every candidate, write-in, overvote and undervote is included.

Open `index.html` in a browser. It is a single self-contained page; the map tiles and Leaflet load from the web.

## The data

| File | What it is |
|---|---|
| `data/full_vote_counts_2024.csv` | **The full results.** One row per precinct × contest × item (31,471 rows, 1,313 precincts). |
| `data/split_ticket_data.csv` | The per-precinct figures the map shows (two-party shares, differences, third-party totals, notes). |
| `data/sources/` | The official county results files the numbers come from, plus the Secretary of State's certified totals. |
| `data/extracted/` | Each county's results as read from its report, before joining (`_log.txt` lists every check and correction). |

`full_vote_counts_2024.csv` columns:

- `county`, `precinct`: the precinct id used by the map; `precinct_label`: the precinct as printed in the county report
- `office` (`President`, `State Senate`, `State House`) and `district`
- `type`: `candidate`, `writein`, `total_votes` (candidates + write-ins), `overvotes`, `undervotes`,
  `ballots_cast` (ballots with that contest on them), `registered`
- `candidate` and `party` (DEM, REP, LIB, PGP, IND, NAV, CON, WTP, PRO) for candidate rows; `votes`

Lane County prints small counts as "<10", and those cells say `<10` here too. `registered` and `ballots_cast`
appear only where the county report prints them (or, for `ballots_cast`, where they follow from votes + over + under).

## How the numbers were checked

Each county's report came in one of three forms, and each needed a different extraction method:

- **Text PDFs, CSV or XML (18 counties):** parsed directly. Clackamas, Clatsop, Columbia, Deschutes (the county's
  Clear Ballot XML export), Douglas, Hood River, Jackson, Josephine, Klamath, Lane, Linn, Marion, Multnomah (CSV),
  Tillamook, Umatilla, Union, Wasco and Yamhill.
- **Scans read with OCR (3):** Benton, Crook and Washington. The OCR text is in `data/ocr/`. Cells that OCR misread
  were corrected from the page image, from the printed percentage, or from the row arithmetic. Each correction is
  listed in `data/extracted/_log.txt`, and Washington's are in `data/config/washington.json`.
- **Scans transcribed by hand from the page images (15):** Baker, Coos, Curry, Gilliam, Grant, Harney, Jefferson,
  Lake, Lincoln, Malheur, Morrow, Polk, Sherman, Wallowa and Wheeler, in `data/manual/`. Wasco's first page (a signed
  scan) is also transcribed there.

Every precinct row is checked against the arithmetic the reports themselves satisfy:

- candidates + write-ins = total votes
- total votes + overvotes + undervotes = ballots cast

Every column is also checked against the county's printed totals row, wherever the report has one.

As a final check, the per-precinct numbers are summed statewide and compared with the Secretary of State's
certified totals (`npm run check`):

- **203 of 219 candidate totals match exactly**, including Harris and Trump.
- **13 are consistent once Lane's "<10" cells are allowed for.**
- **3 differ, and in each case our sums equal the counties' own certified reports:**
  - SD 5 Anderson: the counties total 42,336; the Secretary of State prints 42,335.
  - HD 20 Chambers: Marion + Polk = 14,938; the Secretary of State prints 14,398 (two digits transposed).
  - HD 25 Bowman: Washington County, which covers the whole district, prints 24,096; the Secretary of State prints 24,798.

## What the map shows (definitions)

- **Two-party share** means Democrat ÷ (Democrat + Republican). Third-party candidates and write-ins are left out
  of the share, and each tooltip shows how many such votes there were ("Other").
- A candidate's party is their own party (`data/config/candidates.csv`), so a Republican also nominated by the
  Democrats counts as the Republican.
- A House or Senate race is compared with President only if it had **both a Democrat and a Republican**. That
  excludes, for example, HD 16 (a Democrat vs. a Pacific Green), HD 11 (a Republican vs. a nonaffiliated
  candidate) and SD 14 (a Democrat vs. a Libertarian), as well as unopposed races.
- A precinct is colored on the "vs. President" views only if the race and the presidential vote each have
  **at least 50 two-party votes**. Smaller precincts are gray and have a note.
- **District rankings** are vote-weighted over all of a district's precincts.
- A precinct's district comes from the official results. The results are split between two districts in 20
  precincts: the precinct is shown with its larger part, and both parts count toward their districts' totals.
- **Drop-off** is the share of presidential two-party voters who did not cast a two-party vote in the
  legislative race (skipped it, or voted third-party or write-in).

## Known gaps

- Washington 323 and Marion 716 are precincts on the map with no voters; no county report lists them.
- Washington 451's ballots had no State House contest in the county's report, so the precinct has no House figure.
- Lane County's "<10" cells make its third-party and write-in totals minimums ("at least …").

## Corrections to the previous version of the data

Rebuilding everything from the county reports fixed these errors in the earlier hand-assembled data:

- **HD 21:** the Democrat is Virginia **Stapleton**; the old data said "Appleton".
- **Washington 317:** Harris had 77 votes; the old data said 1.
- **Washington 443:** the HD 31 counts were Gutierrez 0, Edwards 11.
- **Klamath, HD 55:** the old House numbers were copies of the Senate race. They are now the real certified
  counts, which change 22 precincts.
- **Third-party votes:** the old "Republican" House figures in three-way races (HD 31, HD 33) included
  Libertarian votes. They are now split into Republican and other.
- **SD 14:** Katy Brumbelow was shown as the Republican but ran as a Libertarian.
- **Washington 444–456:** 13 precincts that had no presidential data before now have it.
- **Umatilla:** 16 precincts are now assigned to HD 57, as in the official results, instead of HD 58.

## Rebuilding

Requires Node.js 18+ (no npm packages) and Poppler's `pdftotext` for the text PDFs. If `pdftotext` is not on your
PATH, set `PDFTOTEXT` to its full path.

```
npm run all        # extract -> combine -> check against the certified totals -> build the map
npm run extract    # scripts/extract_all.js: every county report -> data/extracted/<county>.csv
npm run combine    # scripts/combine.js: -> data/full_vote_counts_2024.csv
npm run check      # scripts/check_official_totals.js: compare statewide sums with the Secretary of State
npm run build      # scripts/build_map.js: -> data/split_ticket_data.csv and the data inside index.html
```

OCR is not needed to rebuild: its output is committed. `scripts/ocr.sh` shows how it was made (Poppler + Tesseract 5).

Code layout: `scripts/extract/` has one parser per report format; `scripts/lib/` has CSV helpers, the candidate
table lookup and precinct-id matching; `data/config/` has the candidate table, precinct aliases and the per-page
layouts of the OCR'd reports.

## Sources

- Clackamas, Marion, Yamhill, Lane, Multnomah, Benton, Polk and Washington: official results downloaded from
  each county.
- The other 28 counties: the counties' own results documents as archived by OpenElections
  (github.com/openelections/openelections-sources-or, `2024/general`). Deschutes is its Clear Ballot XML export.
- Statewide certified totals: Oregon Secretary of State, *2024 General Election* abstract (Oregon Blue Book).
