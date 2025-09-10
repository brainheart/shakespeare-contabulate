# shax_build

This repository builds word/phrase counts and character aggregates from TEI XML files (Folger Shakespeare TEIs).

Usage

Option 1 (Makefile):
```bash
make build      # generate outputs
make clean      # remove generated outputs
make regenerate # clean then build
```

Option 2 (direct):
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
- Generated directories `public/data/` and `public/lines/` are ignored by git; regenerate them with `make build`.
- To run on a subset of TEIs, place only those files in `tei/` and rebuild.
