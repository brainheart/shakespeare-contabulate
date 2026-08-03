
import datetime
import re, json, math, sys
from pathlib import Path
import xml.etree.ElementTree as ET

TOKEN_RE = re.compile(r"[A-Za-z]+")
SENT_RE = re.compile(r"[.!?]+")
def localname(tag): return tag.rsplit('}',1)[1] if '}' in tag else tag
def text_of(elem): return ''.join(elem.itertext())
# Stage directions and speaker labels are not spoken text; collect dialogue
# around them at any nesting depth.
NON_SPOKEN_TAGS = ("stage", "speaker")
def spoken_text_of(elem):
    parts = []
    def walk(node):
        if node.text:
            parts.append(node.text)
        for child in node:
            if localname(child.tag) not in NON_SPOKEN_TAGS:
                walk(child)
            if child.tail:
                parts.append(child.tail)
    walk(elem)
    return ''.join(parts)
def tokenize(text): return TOKEN_RE.findall((text or "").lower())
def count_sentences(text): return len(SENT_RE.findall(text or ""))

def mattr(tokens, window=50):
    """Moving-average type-token ratio: lexical diversity comparable across lengths."""
    if not tokens: return 0.0
    if len(tokens) < window:
        return len(set(tokens)) / len(tokens)
    ratios = [len(set(tokens[i:i + window])) / window
              for i in range(len(tokens) - window + 1)]
    return sum(ratios) / len(ratios)

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
    uses_master_structure = any(
        localname(elem.tag) in ("div1", "div2")
        for elem in root.iter()
    )
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

    scenes = []; lines_map = {}; speech_rows = []
    play_tokens = []  # ordered token stream for play-level MATTR
    token_idx = {}; token2_idx={}; token3_idx={}
    characters = {}; tokens_char_tmp = {}
    # character-level bigrams & trigrams temporary stores
    tokens_char2_tmp = {}
    tokens_char3_tmp = {}

    def split_p_by_lb(p_elem):
        lines = []
        cur = p_elem.text or ""
        for child in p_elem:
            if localname(child.tag) == "lb":
                text = re.sub(r"\s+", " ", cur).strip()
                if text:
                    lines.append(text)
                cur = child.tail or ""
            elif localname(child.tag) not in NON_SPOKEN_TAGS:
                cur += spoken_text_of(child)
        text = re.sub(r"\s+", " ", cur).strip()
        if text:
            lines.append(text)
        return lines

    def split_ab_by_ftln(ab_elem):
        lines = []
        cur = []

        def flush():
            text = re.sub(r"\s+", " ", "".join(cur)).strip()
            cur.clear()
            if text:
                lines.append(text)

        def append_source_text(value, semantic_space=False):
            if not value:
                return
            if value.strip():
                cur.append(value)
            elif semantic_space:
                cur.append(" ")

        def walk(node):
            append_source_text(node.text, localname(node.tag) == "c")
            for child in node:
                if (
                    localname(child.tag) == "milestone"
                    and child.attrib.get("unit") == "ftln"
                ):
                    flush()
                elif localname(child.tag) != "lb" and localname(child.tag) not in NON_SPOKEN_TAGS:
                    walk(child)
                append_source_text(child.tail)

        walk(ab_elem)
        flush()
        return lines

    def fallback_speakers_from_who(sp_elem):
        refs = [
            ref.lstrip("#")
            for ref in (sp_elem.attrib.get("who") or "").split()
            if ref.startswith("#")
        ]
        if not refs:
            return []
        bare = [re.sub(r"_.*$", "", ref) for ref in refs]
        if len(bare) == 1:
            return [bare[0].upper()]
        roots = {re.sub(r"\..*$", "", ref) for ref in bare}
        if len(roots) == 1:
            return [f"ALL {next(iter(roots)).upper()}"]
        return [" / ".join(ref.upper() for ref in bare)]

    def iter_sp_line_texts(sp_elem):
        elems = [e for e in sp_elem.iter() if localname(e.tag) in ("l", "p")]
        if not elems and uses_master_structure:
            elems = [e for e in sp_elem.iter() if localname(e.tag) == "ab"]
        if not elems:
            # Fallback: collect spoken text, skipping speaker labels and stage
            # directions (e.g. the "reads" cue before a letter) at any depth.
            t = re.sub(r"\s+", " ", spoken_text_of(sp_elem)).strip()
            if t:
                yield t
            return
        for ln in elems:
            if (
                localname(ln.tag) == "ab"
                and any(
                    localname(e.tag) == "milestone"
                    and e.attrib.get("unit") == "ftln"
                    for e in ln.iter()
                )
            ):
                parts = split_ab_by_ftln(ln)
            else:
                parts = split_p_by_lb(ln)
            if not parts:
                t = re.sub(r"\s+", " ", spoken_text_of(ln)).strip()
                if t:
                    parts = [t]
            for part in parts:
                yield part

    def div_type(e):
        return (e.attrib.get("type","") or "").lower()
    def is_div(e):
        return localname(e.tag) in ("div", "div1", "div2")
    def is_div_type(e, typ):
        return is_div(e) and div_type(e) == typ
    def has_speech_descendant(e):
        return any(localname(desc.tag) == "sp" for desc in e.iter())
    def numbered_div_index(e, fallback):
        raw = (e.attrib.get("n") or "").strip()
        try:
            return int(raw)
        except ValueError:
            return fallback
    special_types = {"prologue", "epilogue", "induction", "chorus"}
    body = None
    for e in root.iter():
        if localname(e.tag) == "body":
            body = e
            break
    top_divs = [e for e in list(body) if is_div(e)] if body is not None else []
    sections = [e for e in top_divs if is_div_type(e, "act") or div_type(e) in special_types]
    used_root_fallback = False
    if not sections:
        acts = [e for e in root.iter() if is_div_type(e, "act")]
        if acts:
            sections = acts
        else:
            sections = [root]
            used_root_fallback = True

    scene_seq = 0
    play_num_scenes = play_total_words = play_total_lines = play_num_speeches = 0
    act_total = sum(1 for e in sections if is_div_type(e, "act")) or (1 if used_root_fallback else 0)
    act_idx = 0
    epilogue_idx = 0
    special_scene_idx = 0

    for section in sections:
        section_type = div_type(section) if is_div(section) else "act"
        if section_type == "act":
            act_idx += 1
            act_sort_act = act_idx
            act_scene_idx = 0
            act_label = None
            child_divs = [e for e in list(section) if is_div(e)]
            scs = []
            for child in child_divs:
                if is_div_type(child, "scene") or div_type(child) in special_types:
                    scs.append(child)
                elif has_speech_descendant(child):
                    print(
                        f"Warning: treating unrecognized <div type={div_type(child)!r} "
                        f"n={child.attrib.get('n')!r}> with speeches as a scene in {path.name}",
                        file=sys.stderr,
                    )
                    scs.append(child)
            if not scs:
                scs = [section]
            for scene in scs:
                scene_type = div_type(scene) if is_div(scene) else "scene"
                if scene_type in special_types:
                    act_label = scene_type.capitalize()
                    if scene_type == "epilogue":
                        epilogue_idx += 1
                        act_sort = act_total + epilogue_idx
                    else:
                        act_sort = 0
                    special_scene_idx += 1
                    scene_idx = special_scene_idx
                    scene_label = act_label
                else:
                    act_scene_idx += 1
                    act_sort = act_sort_act
                    act_label = None
                    scene_label = None
                    scene_idx = numbered_div_index(scene, act_scene_idx)
                scene_seq += 1
                scene_id = play_id * 1000 + scene_seq
                scene_canonical_id = f"{play_abbr}.{act_sort}.{scene_idx}"
                play_num_scenes += 1
                heading = None
                for h in scene:
                    if localname(h.tag) in ("head","stage"):
                        heading = (text_of(h) or "").strip()
                        if heading: break
                if not heading:
                    if scene_label:
                        heading = scene_label
                    else:
                        heading = f"Act {act_sort}, Scene {scene_idx}"
                speeches = [e for e in scene.iter() if localname(e.tag) == "sp"]
                num_speeches = len(speeches); play_num_speeches += num_speeches
                num_lines = 0; char_set=set()
                scene_unigrams={}; scene_bigrams={}; scene_trigrams={}; scene_lines=[]; line_idx=0; scene_sentences=0
                for speech_idx, sp in enumerate(speeches, start=1):
                    speaker_elems = [e for e in sp if localname(e.tag) == "speaker"]
                    speakers = []
                    for se in speaker_elems:
                        nm = re.sub(r"\s+", " ", text_of(se) or "").strip()
                        if nm: speakers.append(nm); char_set.add(nm)
                    # ensure character aggregates exist for the speakers before counting lines
                    if not speakers:
                        speakers = (
                            fallback_speakers_from_who(sp)
                            if uses_master_structure
                            else []
                        ) or ["UNKNOWN"]
                        char_set.update(speakers)
                    for nm in speakers:
                        key = (play_id, nm)
                        if key not in characters:
                            characters[key] = {"character_id": None, "play_id": play_id, "play_title": title, "name": nm,
                                               "total_words_spoken": 0, "num_speeches": 0, "num_lines": 0, "scenes_appeared_in": set()}
                        # count this speech for each named speaker
                        characters[key]["num_speeches"] += 1

                    raw_speech_line_texts = list(iter_sp_line_texts(sp))
                    speech_line_texts = [
                        re.sub(r"\s+", " ", text).strip()
                        for text in raw_speech_line_texts
                        if text and text.strip()
                    ]
                    for t in raw_speech_line_texts:
                        line_idx += 1
                        line_canonical_id = f"{play_abbr}.{act_sort}.{scene_idx}.{line_idx}"
                        line_row = {"line_id": line_idx, "canonical_id": line_canonical_id, "speaker": (speakers[0] if speakers else "UNKNOWN") or "UNKNOWN", "text": t}
                        if act_label: line_row["act_label"] = act_label
                        if scene_label: line_row["scene_label"] = scene_label
                        scene_lines.append(line_row)
                        num_lines += 1
                        toks = tokenize(t)
                        play_tokens.extend(toks)
                        n_sent = count_sentences(t)
                        scene_sentences += n_sent
                        if n_sent:
                            for nm in speakers:
                                agg = characters.get((play_id, nm))
                                if agg is not None:
                                    agg["sentence_count"] = agg.get("sentence_count", 0) + n_sent
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
                    speech_text = "\n".join(speech_line_texts)
                    speech_tokens = tokenize(speech_text)
                    speech_row = {
                        "speech_id": scene_id * 1000 + speech_idx,
                        "canonical_id": f"{scene_canonical_id}.S{speech_idx:03d}",
                        "scene_id": scene_id,
                        "play_id": play_id,
                        "play_title": title,
                        "play_abbr": play_abbr,
                        "genre": genre,
                        "act": act_sort,
                        "scene": scene_idx,
                        "speech_num": speech_idx,
                        "speaker": " / ".join(speakers),
                        "speakers": speakers,
                        "text": speech_text,
                        "first_line": speech_line_texts[0] if speech_line_texts else "",
                        "line_count": len(speech_line_texts),
                        "total_words": len(speech_tokens),
                        "sentence_count": count_sentences(speech_text),
                    }
                    if act_label: speech_row["act_label"] = act_label
                    if scene_label: speech_row["scene_label"] = scene_label
                    speech_rows.append(speech_row)
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
                scene_row = {"scene_id": scene_id, "canonical_id": scene_canonical_id, "play_id": play_id, "play_title": title, "genre": genre,
                               "act": act_sort, "scene": scene_idx, "heading": heading, "total_words": total_words,
                               "unique_words": unique_words, "num_speeches": num_speeches, "num_lines": num_lines,
                               "characters_present_count": len(char_set), "sentence_count": scene_sentences}
                if act_label: scene_row["act_label"] = act_label
                if scene_label: scene_row["scene_label"] = scene_label
                scenes.append(scene_row)
                lines_map[scene_id] = scene_lines
                for tok, cnt in scene_unigrams.items():
                    token_idx.setdefault(tok, []).append((scene_id, cnt))
                for key, cnt in scene_bigrams.items():
                    token2_idx.setdefault(key, []).append((scene_id, cnt))
                for key, cnt in scene_trigrams.items():
                    token3_idx.setdefault(key, []).append((scene_id, cnt))
            continue
        elif section_type in special_types:
            act_label = section_type.capitalize()
            if section_type == "epilogue":
                epilogue_idx += 1
                act_sort = act_total + epilogue_idx
            else:
                act_sort = 0
            special_scene_idx += 1
            scene_idx = special_scene_idx
            scene_label = act_label
            scs = [section]
        else:
            continue
        for scene in scs:
            scene_seq += 1
            scene_id = play_id * 1000 + scene_seq
            scene_canonical_id = f"{play_abbr}.{act_sort}.{scene_idx}"
            play_num_scenes += 1
            heading = None
            for h in scene:
                if localname(h.tag) in ("head","stage"):
                    heading = (text_of(h) or "").strip()
                    if heading: break
            if not heading:
                if scene_label:
                    heading = scene_label
                else:
                    heading = f"Act {act_sort}, Scene {scene_idx}"
            speeches = [e for e in scene.iter() if localname(e.tag) == "sp"]
            num_speeches = len(speeches); play_num_speeches += num_speeches
            num_lines = 0; char_set=set()
            scene_unigrams={}; scene_bigrams={}; scene_trigrams={}; scene_lines=[]; line_idx=0; scene_sentences=0
            for speech_idx, sp in enumerate(speeches, start=1):
                speaker_elems = [e for e in sp if localname(e.tag) == "speaker"]
                speakers = []
                for se in speaker_elems:
                    nm = re.sub(r"\s+", " ", text_of(se) or "").strip()
                    if nm: speakers.append(nm); char_set.add(nm)
                # ensure character aggregates exist for the speakers before counting lines
                if not speakers:
                    speakers = (
                        fallback_speakers_from_who(sp)
                        if uses_master_structure
                        else []
                    ) or ["UNKNOWN"]
                    char_set.update(speakers)
                for nm in speakers:
                    key = (play_id, nm)
                    if key not in characters:
                        characters[key] = {"character_id": None, "play_id": play_id, "play_title": title, "name": nm,
                                           "total_words_spoken": 0, "num_speeches": 0, "num_lines": 0, "scenes_appeared_in": set()}
                    # count this speech for each named speaker
                    characters[key]["num_speeches"] += 1

                raw_speech_line_texts = list(iter_sp_line_texts(sp))
                speech_line_texts = [
                    re.sub(r"\s+", " ", text).strip()
                    for text in raw_speech_line_texts
                    if text and text.strip()
                ]
                for t in raw_speech_line_texts:
                    line_idx += 1
                    line_canonical_id = f"{play_abbr}.{act_sort}.{scene_idx}.{line_idx}"
                    line_row = {"line_id": line_idx, "canonical_id": line_canonical_id, "speaker": (speakers[0] if speakers else "UNKNOWN") or "UNKNOWN", "text": t}
                    if act_label: line_row["act_label"] = act_label
                    if scene_label: line_row["scene_label"] = scene_label
                    scene_lines.append(line_row)
                    num_lines += 1
                    toks = tokenize(t)
                    play_tokens.extend(toks)
                    n_sent = count_sentences(t)
                    scene_sentences += n_sent
                    if n_sent:
                        for nm in speakers:
                            agg = characters.get((play_id, nm))
                            if agg is not None:
                                agg["sentence_count"] = agg.get("sentence_count", 0) + n_sent
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
                speech_text = "\n".join(speech_line_texts)
                speech_tokens = tokenize(speech_text)
                speech_row = {
                    "speech_id": scene_id * 1000 + speech_idx,
                    "canonical_id": f"{scene_canonical_id}.S{speech_idx:03d}",
                    "scene_id": scene_id,
                    "play_id": play_id,
                    "play_title": title,
                    "play_abbr": play_abbr,
                    "genre": genre,
                    "act": act_sort,
                    "scene": scene_idx,
                    "speech_num": speech_idx,
                    "speaker": " / ".join(speakers),
                    "speakers": speakers,
                    "text": speech_text,
                    "first_line": speech_line_texts[0] if speech_line_texts else "",
                    "line_count": len(speech_line_texts),
                    "total_words": len(speech_tokens),
                    "sentence_count": count_sentences(speech_text),
                }
                if act_label: speech_row["act_label"] = act_label
                if scene_label: speech_row["scene_label"] = scene_label
                speech_rows.append(speech_row)
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
            scene_row = {"scene_id": scene_id, "canonical_id": scene_canonical_id, "play_id": play_id, "play_title": title, "genre": genre,
                           "act": act_sort, "scene": scene_idx, "heading": heading, "total_words": total_words,
                           "unique_words": unique_words, "num_speeches": num_speeches, "num_lines": num_lines,
                           "characters_present_count": len(char_set), "sentence_count": scene_sentences}
            if act_label: scene_row["act_label"] = act_label
            if scene_label: scene_row["scene_label"] = scene_label
            scenes.append(scene_row)
            lines_map[scene_id] = scene_lines
            for tok, cnt in scene_unigrams.items():
                token_idx.setdefault(tok, []).append((scene_id, cnt))
            for key, cnt in scene_bigrams.items():
                token2_idx.setdefault(key, []).append((scene_id, cnt))
            for key, cnt in scene_trigrams.items():
                token3_idx.setdefault(key, []).append((scene_id, cnt))
    play_row = {"play_id": play_id, "title": title, "abbr": play_abbr, "genre": genre, "first_performance_year": first_year,
                "num_acts": act_total, "num_scenes": play_num_scenes, "num_speeches": play_num_speeches,
                "total_words": play_total_words, "total_lines": play_total_lines,
                "mattr_50": round(mattr(play_tokens), 3)}
    return scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, tokens_char2_tmp, tokens_char3_tmp, speech_rows, play_row

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

    # Load optional character metadata (e.g., gender) keyed by (play_id, name)
    char_meta_path = Path(__file__).parent / "character_metadata.json"
    def _norm_name(s: str) -> str:
        return re.sub(r"\s+", " ", (s or "").upper().strip())
    character_meta_map = {}
    if char_meta_path.exists():
        try:
            with open(char_meta_path, 'r', encoding='utf-8') as f:
                meta_json = json.load(f)
                for rec in meta_json.get("characters", []):
                    pid = rec.get("play_id")
                    nm = rec.get("name")
                    # Support either 'gender' or legacy 'sex' in metadata
                    g = rec.get("gender") if rec.get("gender") is not None else rec.get("sex")
                    if pid is None or not nm or not g: continue
                    up = str(g).upper()
                    if up in ("U","UNKNOWN"): up = "A"  # normalize unknown to ambiguous
                    character_meta_map[(int(pid), _norm_name(nm))] = up
        except Exception:
            character_meta_map = {}
    
    source_plays = []
    seen_play_ids = set()
    for path in tei_dir.glob("*.xml"):
        metadata = play_metadata_map.get(path.name)
        if metadata is None:
            raise ValueError(f"Missing play metadata for TEI source {path.name}")
        play_id = metadata.get("play_id")
        if not isinstance(play_id, int) or isinstance(play_id, bool) or play_id < 1:
            raise ValueError(f"Invalid play_id for {path.name}: {play_id!r}")
        if play_id in seen_play_ids:
            raise ValueError(f"Duplicate play_id {play_id} in play metadata")
        seen_play_ids.add(play_id)
        source_plays.append((play_id, path, metadata))
    source_plays.sort(key=lambda item: item[0])

    plays=[]; scenes_all=[]; speech_rows_all=[]; token_idx_all={}; token2_idx_all={}; token3_idx_all={}; characters_rows=[]; tokens_char_idx={}; tokens_char2_idx={}; tokens_char3_idx={}
    all_lines = []  # Collect all lines from all plays with global metadata
    for play_id, path, metadata in source_plays:
        scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, tokens_char2_tmp, tokens_char3_tmp, speech_rows, play_row = parse_play(path, play_id, metadata)
        # Attach play_abbr to each scene for easier joins by abbr
        for sc in scenes:
            sc.setdefault("play_abbr", play_row.get("abbr"))
        scenes_all.extend(scenes)
        
        # Save per-scene line files and collect all lines for global file
        global_line_num = 0
        for scene in scenes:
            sid = scene["scene_id"]
            act = scene["act"]
            scene_num = scene["scene"]
            act_label = scene.get("act_label")
            scene_label = scene.get("scene_label")
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
                if act_label:
                    all_lines[-1]["act_label"] = act_label
                if scene_label:
                    all_lines[-1]["scene_label"] = scene_label
        for dsrc, ddst in ((token_idx, token_idx_all),(token2_idx, token2_idx_all),(token3_idx, token3_idx_all)):
            for tok, lst in dsrc.items(): ddst.setdefault(tok, []).extend(lst)
        # finalize characters: assign ids and convert sets to lists
        char_id_seq=0; name_to_id={}
        for (pid, nm), agg in sorted(characters.items(), key=lambda x: x[0][1]):
            char_id_seq += 1
            cid = pid * 10000 + char_id_seq
            name_to_id[(pid, nm)] = cid
            agg["character_id"] = cid
            agg["play_abbr"] = play_row.get("abbr")
            # convert scenes_appeared_in set -> sorted list
            agg["scenes_appeared_in"] = sorted(list(agg.get("scenes_appeared_in", set())))
            characters_rows.append(agg)
        for speech in speech_rows:
            speech["character_ids"] = [
                name_to_id[(play_id, nm)]
                for nm in speech.get("speakers", [])
                if (play_id, nm) in name_to_id
            ]
            # These values are available through play_id or are trivially
            # derived from text. Keep the published speech file compact
            # because it is loaded on demand in the browser.
            for redundant_key in ("play_title", "play_abbr", "genre", "speakers", "first_line"):
                speech.pop(redundant_key, None)
            speech_rows_all.append(speech)
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
        plays.append(play_row)
    # Attach gender to characters using metadata and heuristics
    def _heuristic_gender_from_name(name: str) -> str:
        n = _norm_name(name)
        n2 = re.sub(r"[^A-Z\s]", " ", n)
        # Strong female role/title cues
        female_words = [
            "QUEEN","LADY","PRINCESS","MISTRESS","GENTLEWOMAN","WOMAN","NURSE","MAID",
            "MOTHER","WITCH","COUNTESS","DUCHESS","WIFE","DAUGHTER","PRIESTESS","HOSTESS","ABBESS"
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
        # Names ending with ESS are typically female (DUCHESS, COUNTESS, PRINCESS, HOSTESS, ABBESS)
        # Exception: CAITHNESS is a male character
        if re.search(r"\bESS$", n) and n != "CAITHNESS":
            return 'F'
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
            return 'A'  # Ambiguous
        # Default fallback: ambiguous rather than forcing male
        return 'A'
    # Build lookup for abbr by play_id for metadata joins
    id_to_abbr = {p.get("play_id"): p.get("abbr") for p in plays}

    # Support metadata keyed by either play_id or abbr
    character_meta_by_pid = {}
    character_meta_by_abbr = {}
    for (pid, nm), sx in list(character_meta_map.items()):
        # Existing map is keyed by pid; leave it in by_pid
        character_meta_by_pid[(pid, nm)] = sx
    # Also read abbr-based entries if present in metadata file (optional)
    try:
        with open(char_meta_path, 'r', encoding='utf-8') as f:
            meta_json = json.load(f)
            for rec in meta_json.get("characters", []):
                ab = rec.get("abbr") or rec.get("play_abbr")
                nm = rec.get("name")
                gx = rec.get("gender") if rec.get("gender") is not None else rec.get("sex")
                if ab and nm and gx:
                    up = str(gx).upper()
                    if up in ("U","UNKNOWN"): up = "A"
                    character_meta_by_abbr[(ab.upper(), _norm_name(nm))] = up
    except Exception:
        pass

    for ch in characters_rows:
        pid = ch.get("play_id"); nm = ch.get("name")
        ab = ch.get("play_abbr") or id_to_abbr.get(pid)
        gender = None
        if pid is not None:
            gender = character_meta_by_pid.get((pid, _norm_name(nm)))
        if gender is None and ab:
            gender = character_meta_by_abbr.get((ab.upper(), _norm_name(nm)))
        # Apply heuristic if missing
        if not gender:
            gender = _heuristic_gender_from_name(nm)
        else:
            # If metadata says Male but heuristic strongly suggests Female, override to F
            h = _heuristic_gender_from_name(nm)
            if gender == 'M' and h == 'F':
                gender = 'F'
        ch["gender"] = gender

    # Additive metric fields (char_count, rarity_sum) per scene and character.
    # The UI derives ratio metrics (mean word length, lexical rarity) at any
    # aggregation level by summing these and dividing by total words.
    corpus_freq = {tok: sum(c for _, c in postings) for tok, postings in token_idx_all.items()}
    corpus_total = sum(corpus_freq.values()) or 1
    tok_rarity = {tok: -math.log10(f / corpus_total) for tok, f in corpus_freq.items()}
    scene_chars = {}; scene_rarity = {}
    for tok, postings in token_idx_all.items():
        L = len(tok); r = tok_rarity[tok]
        for sid, c in postings:
            scene_chars[sid] = scene_chars.get(sid, 0) + L * c
            scene_rarity[sid] = scene_rarity.get(sid, 0.0) + r * c
    for sc in scenes_all:
        sid = sc["scene_id"]
        sc["char_count"] = scene_chars.get(sid, 0)
        sc["rarity_sum"] = round(scene_rarity.get(sid, 0.0), 3)
    char_chars = {}; char_rarity = {}
    for tok, postings in tokens_char_idx.items():
        L = len(tok); r = tok_rarity[tok]
        for cid, c in postings:
            char_chars[cid] = char_chars.get(cid, 0) + L * c
            char_rarity[cid] = char_rarity.get(cid, 0.0) + r * c
    for ch in characters_rows:
        cid = ch["character_id"]
        ch.setdefault("sentence_count", 0)
        ch["char_count"] = char_chars.get(cid, 0)
        ch["rarity_sum"] = round(char_rarity.get(cid, 0.0), 3)
    for speech in speech_rows_all:
        speech_tokens = tokenize(speech.get("text", ""))
        speech["char_count"] = sum(len(tok) for tok in speech_tokens)
        speech["rarity_sum"] = round(sum(tok_rarity.get(tok, 0.0) for tok in speech_tokens), 3)

    # Hapax legomena (words appearing exactly once in the corpus), counted
    # per scene and per character so % Hapax works at every granularity.
    hapax_words = {tok for tok, f in corpus_freq.items() if f == 1}
    scene_hapax = {}
    for tok in hapax_words:
        sid = token_idx_all[tok][0][0]
        scene_hapax[sid] = scene_hapax.get(sid, 0) + 1
    for sc in scenes_all:
        sc["hapax_count"] = scene_hapax.get(sc["scene_id"], 0)
    char_hapax = {}
    for tok, postings in tokens_char_idx.items():
        if tok in hapax_words:
            for cid, c in postings:
                char_hapax[cid] = char_hapax.get(cid, 0) + 1
    for ch in characters_rows:
        ch["hapax_count"] = char_hapax.get(ch["character_id"], 0)
    for speech in speech_rows_all:
        speech["hapax_count"] = sum(1 for tok in tokenize(speech.get("text", "")) if tok in hapax_words)

    # Lines actually spoken by each character (num_lines counts the lines of
    # the scenes a character appears in, which is a different thing).
    spoken_lines = {}
    for ln in all_lines:
        k = (ln["play_id"], ln["speaker"])
        spoken_lines[k] = spoken_lines.get(k, 0) + 1
    for ch in characters_rows:
        ch["line_count"] = spoken_lines.get((ch["play_id"], ch["name"]), 0)

    # Publish instance metadata for the contabulate.org hub: curated fields
    # from instance-meta.json merged with computed corpus stats.
    instance_meta_path = Path(__file__).parent / "instance-meta.json"
    instance_meta = json.loads(instance_meta_path.read_text(encoding="utf-8")) if instance_meta_path.exists() else {}
    instance_payload = {
        "schema": 1,
        **instance_meta,
        "updated": datetime.date.today().isoformat(),
        "stats": {
            "texts": len(plays),
            "text_label": instance_meta.get("text_label", "plays"),
            "segments": len(all_lines),
            "segment_label": instance_meta.get("segment_label", "lines"),
            "words": sum(p.get("total_words", 0) for p in plays),
            "distinct_words": len(token_idx_all),
            "commentaries": 0,
            "comments": 0,
        },
    }
    instance_payload.pop("text_label", None)
    instance_payload.pop("segment_label", None)
    (out_dir / "instance.json").write_text(
        json.dumps(instance_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    (data_dir / "plays.json").write_text(json.dumps(plays, ensure_ascii=False), encoding="utf-8")
    (data_dir / "chunks.json").write_text(json.dumps(scenes_all, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (data_dir / "characters.json").write_text(json.dumps(characters_rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (data_dir / "speeches.json").write_text(json.dumps(speech_rows_all, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (data_dir / "tokens.json").write_text(json.dumps(token_idx_all, ensure_ascii=False), encoding="utf-8")
    (data_dir / "tokens2.json").write_text(json.dumps(token2_idx_all, ensure_ascii=False), encoding="utf-8")
    (data_dir / "tokens3.json").write_text(json.dumps(token3_idx_all, ensure_ascii=False), encoding="utf-8")
    (data_dir / "tokens_char.json").write_text(json.dumps(tokens_char_idx, ensure_ascii=False), encoding="utf-8")
    (data_dir / "tokens_char2.json").write_text(json.dumps(tokens_char2_idx, ensure_ascii=False), encoding="utf-8")
    (data_dir / "tokens_char3.json").write_text(json.dumps(tokens_char3_idx, ensure_ascii=False), encoding="utf-8")
    
    # Write consolidated all_lines.json file
    (lines_dir / "all_lines.json").write_text(json.dumps(all_lines, ensure_ascii=False), encoding="utf-8")

    # Remove stale per-scene files left behind when scene ids change between
    # builds. all_lines.json is the one intentional non-scene file here.
    current_scene_ids = {str(scene["scene_id"]) for scene in scenes_all}
    for line_path in lines_dir.glob("*.json"):
        if line_path.name == "all_lines.json":
            continue
        if line_path.stem.isdigit() and line_path.stem not in current_scene_ids:
            line_path.unlink()
    
    return {"play_count": len(plays), "scene_count": len(scenes_all), "speech_count": len(speech_rows_all), "line_count": len(all_lines)}


if __name__ == '__main__':
    import sys
    base = Path(__file__).parent
    tei_dir = base / 'tei'
    out_dir = base / 'docs'
    print(f"Building from {tei_dir} -> {out_dir}")
    res = build(tei_dir, out_dir)
    print(f"Done: {res['play_count']} plays, {res['scene_count']} scenes, {res['speech_count']} speeches, {res['line_count']} lines written to {out_dir}/data and {out_dir}/lines")
