
import re, json
from pathlib import Path
import xml.etree.ElementTree as ET

TOKEN_RE = re.compile(r"[A-Za-z]+")
def localname(tag): return tag.rsplit('}',1)[1] if '}' in tag else tag
def text_of(elem): return ''.join(elem.itertext())
def tokenize(text): return TOKEN_RE.findall((text or "").lower())

def find_first_performance_year(root):
    for d in root.iter():
        if localname(d.tag) == "date":
            w = (d.attrib.get("when") or "").strip()
            if w.isdigit(): return int(w)
            for key in ("notBefore","notAfter","from","to"):
                v = (d.attrib.get(key) or "").strip()
                if v[:4].isdigit(): return int(v[:4])
            import re as _re
            m = _re.search(r"\b(15|16|17)\d{2}\b", (d.text or ""))
            if m: return int(m.group(0))
    return None

def parse_play(path: Path, play_id: int, metadata: dict = None):
    root = ET.parse(path).getroot()
    # Title and metadata from external source if available
    if metadata:
        title = metadata.get("title", path.stem)
        genre = metadata.get("genre", "unknown")
        first_year = metadata.get("first_performance_year")
        play_abbr = metadata.get("abbr", path.stem[:3].upper())
    else:
        # Fallback to TEI parsing
        title = None
        for t in root.iter():
            if localname(t.tag) == "title":
                title = (t.text or "").strip()
                if title: break
        if not title: title = path.stem
        play_abbr = path.stem[:3].upper()
        # Genre
        genre = None
        for g in root.iter():
            if localname(g.tag) in ("genre","term"):
                txt = (g.text or "").strip().lower()
                if txt in ("tragedy","comedy","history","romance","tragicomedy","problem play"):
                    genre = txt; break
        if not genre: genre = "unknown"
        first_year = find_first_performance_year(root)

    scenes = []; lines_map = {}
    token_idx = {}; token2_idx={}; token3_idx={}
    characters = {}; tokens_char_tmp = {}
    # character-level bigrams & trigrams temporary stores
    tokens_char2_tmp = {}
    tokens_char3_tmp = {}

    def is_div_type(e, typ):
        return localname(e.tag) == "div" and e.attrib.get("type","").lower()==typ
    acts = [e for e in root.iter() if is_div_type(e,"act")]
    if not acts: acts = [root]

    scene_seq = 0
    play_num_scenes = play_total_words = play_total_lines = play_num_speeches = 0

    for act_idx, act in enumerate(acts, start=1):
        scs = [e for e in act.iter() if is_div_type(e,"scene")]
        if not scs: scs = [act]
        for scene_idx, scene in enumerate(scs, start=1):
            scene_seq += 1
            scene_id = play_id * 1000 + scene_seq
            scene_canonical_id = f"{play_abbr}.{act_idx}.{scene_idx}"
            play_num_scenes += 1
            heading = None
            for h in scene:
                if localname(h.tag) in ("head","stage"):
                    heading = (text_of(h) or "").strip()
                    if heading: break
            if not heading: heading = f"Act {act_idx}, Scene {scene_idx}"
            speeches = [e for e in scene.iter() if localname(e.tag) == "sp"]
            num_speeches = len(speeches); play_num_speeches += num_speeches
            num_lines = 0; char_set=set()
            scene_unigrams={}; scene_bigrams={}; scene_trigrams={}; scene_lines=[]; line_idx=0
            for sp in speeches:
                speaker_elems = [e for e in sp if localname(e.tag) == "speaker"]
                speakers = []
                for se in speaker_elems:
                    nm = (text_of(se) or "").strip()
                    if nm: speakers.append(nm); char_set.add(nm)
                # ensure character aggregates exist for the speakers before counting lines
                if not speakers:
                    speakers = ["UNKNOWN"]
                    char_set.add("UNKNOWN")
                for nm in speakers:
                    key = (play_id, nm)
                    if key not in characters:
                        characters[key] = {"character_id": None, "play_id": play_id, "play_title": title, "name": nm,
                                           "total_words_spoken": 0, "num_speeches": 0, "num_lines": 0, "scenes_appeared_in": set()}
                    # count this speech for each named speaker
                    characters[key]["num_speeches"] += 1

                lines = [e for e in sp if localname(e.tag) in ("l","p")]
                if not lines: lines = [sp]
                for ln in lines:
                    t = (text_of(ln) or "").strip()
                    if not t: continue
                    line_idx += 1
                    line_canonical_id = f"{play_abbr}.{act_idx}.{scene_idx}.{line_idx}"
                    scene_lines.append({"line_id": line_idx, "canonical_id": line_canonical_id, "speaker": (speakers[0] if speakers else "UNKNOWN") or "UNKNOWN", "text": t})
                    num_lines += 1
                    toks = tokenize(t)
                    for tok in toks:
                        scene_unigrams[tok] = scene_unigrams.get(tok,0)+1
                        for nm in speakers:
                            d = tokens_char_tmp.setdefault((play_id,nm),{})
                            d[tok] = d.get(tok,0)+1
                            # update per-character line/word counts and scene membership
                            agg = characters.get((play_id, nm))
                            if agg is not None:
                                agg["total_words_spoken"] += 1
                                agg["num_lines"] += 1
                                agg["scenes_appeared_in"].add(scene_id)
                    for i in range(len(toks)-1):
                        bg = toks[i] + " " + toks[i+1]
                        scene_bigrams[bg] = scene_bigrams.get(bg,0)+1
                        for nm in speakers:
                            d2 = tokens_char2_tmp.setdefault((play_id,nm), {})
                            d2[bg] = d2.get(bg,0)+1
                    for i in range(len(toks)-2):
                        tg = toks[i] + " " + toks[i+1] + " " + toks[i+2]
                        scene_trigrams[tg] = scene_trigrams.get(tg,0)+1
                        for nm in speakers:
                            d3 = tokens_char3_tmp.setdefault((play_id,nm), {})
                            d3[tg] = d3.get(tg,0)+1
                for nm in speakers or ["UNKNOWN"]:
                    key = (play_id, nm)
                    agg = characters.get(key)
                    if not agg:
                        agg = {"character_id": None, "play_id": play_id, "play_title": title, "name": nm,
                               "total_words_spoken": 0, "num_speeches": 0, "num_lines": 0, "scenes_appeared_in": set()}
                        characters[key] = agg
                    # num_speeches already incremented above when speech began
            total_words = sum(scene_unigrams.values())
            unique_words = len(scene_unigrams)
            play_total_words += total_words
            play_total_lines += num_lines
            scenes.append({"scene_id": scene_id, "canonical_id": scene_canonical_id, "play_id": play_id, "play_title": title, "genre": genre,
                           "act": act_idx, "scene": scene_idx, "heading": heading, "total_words": total_words,
                           "unique_words": unique_words, "num_speeches": num_speeches, "num_lines": num_lines,
                           "characters_present_count": len(char_set)})
            lines_map[scene_id] = scene_lines
            for tok, cnt in scene_unigrams.items():
                token_idx.setdefault(tok, []).append((scene_id, cnt))
            for key, cnt in scene_bigrams.items():
                token2_idx.setdefault(key, []).append((scene_id, cnt))
            for key, cnt in scene_trigrams.items():
                token3_idx.setdefault(key, []).append((scene_id, cnt))
    play_row = {"play_id": play_id, "title": title, "abbr": play_abbr, "genre": genre, "first_performance_year": first_year,
                "num_acts": len(acts) if acts else 0, "num_scenes": play_num_scenes, "num_speeches": play_num_speeches,
                "total_words": play_total_words, "total_lines": play_total_lines}
    return scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, tokens_char2_tmp, tokens_char3_tmp, play_row

def build(tei_dir: Path, out_dir: Path):
    data_dir = out_dir / "data"
    lines_dir = out_dir / "lines"
    data_dir.mkdir(parents=True, exist_ok=True)
    lines_dir.mkdir(parents=True, exist_ok=True)
    
    # Load play metadata
    metadata_path = Path(__file__).parent / "play_metadata.json"
    play_metadata_map = {}
    if metadata_path.exists():
        with open(metadata_path, 'r', encoding='utf-8') as f:
            metadata_json = json.load(f)
            for item in metadata_json.get("plays", []):
                play_metadata_map[item["filename"]] = item

    # Load optional character metadata (e.g., sex) keyed by (play_id, name)
    char_meta_path = Path(__file__).parent / "character_metadata.json"
    def _norm_name(s: str) -> str:
        return (s or "").upper().strip().replace("\n", " ").replace("\r", " ")
    character_meta_map = {}
    if char_meta_path.exists():
        try:
            with open(char_meta_path, 'r', encoding='utf-8') as f:
                meta_json = json.load(f)
                for rec in meta_json.get("characters", []):
                    pid = rec.get("play_id")
                    nm = rec.get("name")
                    sex = rec.get("sex")
                    if pid is None or not nm or not sex: continue
                    character_meta_map[(int(pid), _norm_name(nm))] = sex.upper()
        except Exception:
            character_meta_map = {}
    
    plays=[]; scenes_all=[]; token_idx_all={}; token2_idx_all={}; token3_idx_all={}; characters_rows=[]; tokens_char_idx={}; tokens_char2_idx={}; tokens_char3_idx={}
    all_lines = []  # Collect all lines from all plays with global metadata
    play_id=1
    for path in sorted(tei_dir.glob("*.xml")):
        metadata = play_metadata_map.get(path.name)
        scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, tokens_char2_tmp, tokens_char3_tmp, play_row = parse_play(path, play_id, metadata)
        scenes_all.extend(scenes)
        
        # Save per-scene line files and collect all lines for global file
        global_line_num = 0
        for scene in scenes:
            sid = scene["scene_id"]
            act = scene["act"]
            scene_num = scene["scene"]
            scene_lines = lines_map.get(sid, [])
            
            # Save per-scene file
            (lines_dir / f"{sid}.json").write_text(json.dumps(scene_lines, ensure_ascii=False), encoding="utf-8")
            
            # Add to global lines with full metadata
            for line_data in scene_lines:
                global_line_num += 1
                all_lines.append({
                    "play_id": play_id,
                    "canonical_id": line_data["canonical_id"],
                    "act": act,
                    "scene": scene_num,
                    "line_num": global_line_num,
                    "speaker": line_data["speaker"],
                    "text": line_data["text"]
                })
        for dsrc, ddst in ((token_idx, token_idx_all),(token2_idx, token2_idx_all),(token3_idx, token3_idx_all)):
            for tok, lst in dsrc.items(): ddst.setdefault(tok, []).extend(lst)
        # finalize characters: assign ids and convert sets to lists
        char_id_seq=0; name_to_id={}
        for (pid, nm), agg in sorted(characters.items(), key=lambda x: x[0][1]):
            char_id_seq += 1
            cid = pid * 10000 + char_id_seq
            name_to_id[(pid, nm)] = cid
            agg["character_id"] = cid
            # convert scenes_appeared_in set -> sorted list
            agg["scenes_appeared_in"] = sorted(list(agg.get("scenes_appeared_in", set())))
            characters_rows.append(agg)
        for (pid, nm), tokdict in tokens_char_tmp.items():
            cid = name_to_id.get((pid, nm))
            if cid is None: continue
            for tok, cnt in tokdict.items():
                tokens_char_idx.setdefault(tok, []).append((cid, cnt))
        for (pid, nm), tokdict in tokens_char2_tmp.items():
            cid = name_to_id.get((pid, nm))
            if cid is None: continue
            for tok, cnt in tokdict.items():
                tokens_char2_idx.setdefault(tok, []).append((cid, cnt))
        for (pid, nm), tokdict in tokens_char3_tmp.items():
            cid = name_to_id.get((pid, nm))
            if cid is None: continue
            for tok, cnt in tokdict.items():
                tokens_char3_idx.setdefault(tok, []).append((cid, cnt))
        plays.append(play_row); play_id += 1
    # Attach sex to characters using metadata and heuristics
    def _heuristic_sex_from_name(name: str) -> str:
        n = _norm_name(name)
        n2 = re.sub(r"[^A-Z\s]", " ", n)
        # Strong female role/title cues
        female_words = [
            "QUEEN","LADY","PRINCESS","MISTRESS","GENTLEWOMAN","NURSE","MAID",
            "MOTHER","WITCH","COUNTESS","DUCHESS","WIFE","DAUGHTER","PRIESTESS"
        ]
        # Strong male role/title cues
        male_words = [
            "KING","LORD","EARL","DUKE","PRINCE","SIR","GENTLEMAN","FATHER",
            "CAPTAIN","SERVANT","MESSENGER","BOY","CONSTABLE"
        ]
        if any(re.search(fr"\b{w}\b", n2) for w in female_words):
            return 'F'
        if any(re.search(fr"\b{w}\b", n2) for w in male_words):
            return 'M'
        # Common female given names and heroines (not exhaustive)
        female_names = {
            "JULIET","DESDEMONA","OPHELIA","PORTIA","NERISSA","ROSALIND","CELIA","HERMIA","HELENA",
            "HIPPOLYTA","OLIVIA","VIOLA","MARIA","BIANCA","EMILIA","KATHERINA","KATE","CLEOPATRA",
            "OCTAVIA","CORDELIA","REGAN","GONERIL","GERTRUDE","MIRANDA","TAMORA","LAVINIA","IMOGEN",
            "JESSICA","ANNE","PAULINA","PERDITA","CONSTANCE","MARGARET","KATHERINE","KATHARINE",
            "JULIA","SYLVIA","VIOLA","LUCIANA","ADRIANA","VIOLA","OPHELIA","BEATRICE","HERO",
            "VIOLA","OLIVIA","VIOLA","VIOLA"
        }
        male_names = {
            "ROMEO","HAMLET","OTHELLO","IAGO","MACBETH","BANQUO","LEAR","PROSPERO","ANTONY",
            "PROTEUS","VALENTINE","BEROWNE","FALSTAFF","SHYLOCK","BASSANIO","BENEDICK","CLAUDIO",
            "PETRUCHIO","HENRY","RICHARD","JOHN","ANTIPHOLUS","DROMIO","ORSINO","PARIS","TYBALT",
            "MERCUTIO","HORATIO","POLONIUS","LAERTES","CASSIO","RODERIGO","BRUTUS","CASSIUS","CAESAR"
        }
        if n in female_names:
            return 'F'
        if n in male_names:
            return 'M'
        # Rare genuinely unclear cases
        unknown_names = {"ARIEL"}
        if n in unknown_names:
            return 'U'
        # Default majority case: male
        return 'M'
    for ch in characters_rows:
        pid = ch.get("play_id"); nm = ch.get("name")
        sex = character_meta_map.get((pid, _norm_name(nm)))
        if not sex:
            sex = _heuristic_sex_from_name(nm)
        ch["sex"] = sex

    (data_dir / "plays.json").write_text(json.dumps(plays, ensure_ascii=False), encoding="utf-8")
    (data_dir / "chunks.json").write_text(json.dumps(scenes_all, ensure_ascii=False), encoding="utf-8")
    (data_dir / "characters.json").write_text(json.dumps(characters_rows, ensure_ascii=False), encoding="utf-8")
    (data_dir / "tokens.json").write_text(json.dumps(token_idx_all, ensure_ascii=False), encoding="utf-8")
    (data_dir / "tokens2.json").write_text(json.dumps(token2_idx_all, ensure_ascii=False), encoding="utf-8")
    (data_dir / "tokens3.json").write_text(json.dumps(token3_idx_all, ensure_ascii=False), encoding="utf-8")
    (data_dir / "tokens_char.json").write_text(json.dumps(tokens_char_idx, ensure_ascii=False), encoding="utf-8")
    (data_dir / "tokens_char2.json").write_text(json.dumps(tokens_char2_idx, ensure_ascii=False), encoding="utf-8")
    (data_dir / "tokens_char3.json").write_text(json.dumps(tokens_char3_idx, ensure_ascii=False), encoding="utf-8")
    
    # Write consolidated all_lines.json file
    (lines_dir / "all_lines.json").write_text(json.dumps(all_lines, ensure_ascii=False), encoding="utf-8")
    
    return {"play_count": len(plays), "scene_count": len(scenes_all), "line_count": len(all_lines)}


if __name__ == '__main__':
    import sys
    base = Path(__file__).parent
    tei_dir = base / 'tei'
    out_dir = base / 'public'
    print(f"Building from {tei_dir} -> {out_dir}")
    res = build(tei_dir, out_dir)
    print(f"Done: {res['play_count']} plays, {res['scene_count']} scenes, {res['line_count']} lines written to {out_dir}/data and {out_dir}/lines")
