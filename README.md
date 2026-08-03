# shakespeare-contabulate

Search all 38 surviving plays in the Folger Shakespeare—including Shakespeare and John Fletcher's coauthored *The Two Noble Kinsmen*—by token, phrase, and regex across plays, acts/scenes, characters, speeches, and lines.

This repo contains:

- A Python build pipeline (`build.py`) that reads Folger TEI XML in `tei/` and emits JSON indexes. It supports both Folger TEI Simple and the Folger master XML structure used by *The Two Noble Kinsmen*.
- A static web UI in `docs/` that loads those generated JSON files.
- Python and Playwright tests for data and UI behavior.

## Requirements

- Python 3.8+
- Node.js + npm (for Playwright tests)
- Optional: `lxml` (listed in `requirements.txt`, but `build.py` currently uses `xml.etree.ElementTree`)

## Build Data

Generate/re-generate data files:

```bash
python3 build.py
```

Current `build.py` behavior is fixed to:

- Input: `tei/*.xml`
- Output root: `docs/`
- Data output: `docs/data/*.json`
- Line output: `docs/lines/*.json`

Generated files include:

- `docs/data/plays.json`
- `docs/data/chunks.json`
- `docs/data/characters.json`
- `docs/data/speeches.json`
- `docs/data/tokens.json`
- `docs/data/tokens2.json`
- `docs/data/tokens3.json`
- `docs/data/tokens_char.json`
- `docs/data/tokens_char2.json`
- `docs/data/tokens_char3.json`
- `docs/lines/all_lines.json`
- `docs/lines/<scene_id>.json` (one file per scene)

The build also reads optional metadata from:

- `play_metadata.json`
- `character_metadata.json`

## Run Locally

Serve the static site from `docs/`:

```bash
python3 -m http.server 8766 -d docs
```

Then open [http://localhost:8766](http://localhost:8766).

## Tests

Run Python tests:

```bash
python3 -m unittest test_parse_play.py tests.test_build_output -v
```

or

```bash
python3 -m pytest tests test_parse_play.py -v
```

Run Playwright UI tests:

```bash
npm install
npx playwright install
npx playwright test
```

The Playwright config auto-starts a local server on port `8766` from `docs/`.

## Notes

- Generated JSON files under `docs/data/` and `docs/lines/` are committed in this repository.
- If you want to build a subset corpus, keep only the desired TEI files in `tei/` and run `python3 build.py`.
