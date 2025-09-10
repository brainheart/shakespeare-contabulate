# shax_build

This repository builds word/phrase counts and character aggregates from TEI XML files (Folger Shakespeare TEIs).

Usage

Generate the JSON outputs (reads TEI files under `tei/` and writes to `public/data` and `public/lines`):
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

- Requires Python 3.8+; `lxml` is optional (std lib parser is used now).
- Generated directories `public/data/` and `public/lines/` are ignored by git; regenerate them with the command above.
- To run on a subset of TEIs, place only those files in `tei/` and rebuild.
