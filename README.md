# shax_build

This repository builds word/phrase counts and character aggregates from TEI XML files (Folger Shakespeare TEIs).

Usage

Run the build script which reads TEI files from `tei/` and writes JSON outputs to `public/data`:

```bash
python3 build.py
```

Outputs (in `public/data`):

- `plays.json` - metadata per play (id, title, genre, counts)
- `chunks.json` - scenes/acts as "chunks" with counts
- `characters.json` - per-character aggregates (word counts, scenes appeared)
- `tokens.json`, `tokens2.json`, `tokens3.json` - unigram/bigram/trigram indexes mapping token -> list of (scene_id, count)
- `tokens_char.json` - token -> list of (character_id, count)

Notes

- Requires Python 3.8+ and `lxml` is suggested in `requirements.txt` though the script currently uses the stdlib `xml.etree.ElementTree` for parsing.
- If you want to run on a subset of TEIs, place them in `tei/` and re-run the script.
