import unittest
import tempfile
import contextlib
import io
from pathlib import Path
import build

class ParsePlaySmokeTest(unittest.TestCase):
    def test_hamlet_parse(self):
        tei = Path(__file__).parent / 'tei' / 'hamlet_TEIsimple_FolgerShakespeare.xml'
        self.assertTrue(tei.exists(), 'hamlet TEI must exist for smoke test')
        scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, tokens_char2_tmp, tokens_char3_tmp, speeches, play_row = build.parse_play(tei, 1)
        # basic shape checks
        self.assertIsInstance(scenes, list)
        self.assertGreater(len(scenes), 0)
        self.assertIsInstance(lines_map, dict)
        self.assertIsInstance(token_idx, dict)
        self.assertGreater(len(speeches), 0)
        self.assertTrue({'speech_id', 'speakers', 'text', 'first_line', 'line_count', 'total_words'}.issubset(speeches[0]))
        self.assertIsInstance(play_row, dict)
        self.assertIn('title', play_row)

    def test_henry_v_includes_prologue_epilogue(self):
        tei = Path(__file__).parent / 'tei' / 'henry-v_TEIsimple_FolgerShakespeare.xml'
        self.assertTrue(tei.exists(), 'henry-v TEI must exist for prologue test')
        scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, tokens_char2_tmp, tokens_char3_tmp, speeches, play_row = build.parse_play(tei, 1)
        labels = {s.get("act_label") for s in scenes if s.get("act_label")}
        self.assertIn("Prologue", labels)
        self.assertIn("Epilogue", labels)

    def test_as_you_like_it_includes_epilogue(self):
        tei = Path(__file__).parent / 'tei' / 'as-you-like-it_TEIsimple_FolgerShakespeare.xml'
        self.assertTrue(tei.exists(), 'as-you-like-it TEI must exist for epilogue test')
        scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, tokens_char2_tmp, tokens_char3_tmp, speeches, play_row = build.parse_play(tei, 1)
        labels = {s.get("act_label") for s in scenes if s.get("act_label")}
        self.assertIn("Epilogue", labels)

    def test_prose_lb_counts_as_lines(self):
        xml = '''<TEI><text><body><div type="act"><div type="scene"><sp><speaker>Test</speaker><p>One<lb/>Two<lb/>Three</p></sp></div></div></body></text></TEI>'''
        with tempfile.NamedTemporaryFile(mode="w", suffix=".xml", delete=False) as tmp:
            tmp.write(xml)
            tmp_path = Path(tmp.name)
        try:
            scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, tokens_char2_tmp, tokens_char3_tmp, speeches, play_row = build.parse_play(tmp_path, 1)
            self.assertEqual(len(scenes), 1)
            scene_id = scenes[0]["scene_id"]
            scene_lines = lines_map.get(scene_id, [])
            self.assertEqual(len(scene_lines), 3)
            self.assertEqual(scene_lines[0]["text"], "One")
            self.assertEqual(scene_lines[1]["text"], "Two")
            self.assertEqual(scene_lines[2]["text"], "Three")
            self.assertEqual(len(speeches), 1)
            self.assertEqual(speeches[0]["text"], "One\nTwo\nThree")
            self.assertEqual(speeches[0]["first_line"], "One")
            self.assertEqual(speeches[0]["line_count"], 3)
            self.assertEqual(speeches[0]["total_words"], 3)
        finally:
            tmp_path.unlink(missing_ok=True)

    def test_folger_master_xml_divisions_and_ftln_lines(self):
        xml = '''<TEI><text><body>
        <div1 type="prologue" n="PRO"><sp who="#Prologue_TNK"><speaker>PROLOGUE</speaker>
          <ab><milestone unit="ftln" n="PRO.1"/><w>First</w><c> </c><w>line</w><pc>.</pc>
          <lb/><milestone unit="ftln" n="PRO.2"/><w>Second</w><c> </c><w>line</w><pc>.</pc></ab>
        </sp></div1>
        <div1 type="act" n="1"><div2 type="scene" n="1"><sp who="#Boy_TNK">
          <ab><milestone unit="ftln" n="1.1.1"/><w>Song</w><pc>!</pc></ab>
        </sp></div2></div1>
        </body></text></TEI>'''
        with tempfile.NamedTemporaryFile(mode="w", suffix=".xml", delete=False) as tmp:
            tmp.write(xml)
            tmp_path = Path(tmp.name)
        try:
            scenes, lines_map, *_, speeches, play_row = build.parse_play(
                tmp_path,
                38,
                {'title': 'The Two Noble Kinsmen', 'abbr': 'TNK', 'genre': 'romance'},
            )
            self.assertEqual(play_row['num_acts'], 1)
            self.assertEqual(play_row['num_scenes'], 2)
            self.assertEqual(play_row['total_lines'], 3)
            self.assertEqual([scene['canonical_id'] for scene in scenes], ['TNK.0.1', 'TNK.1.1'])
            self.assertEqual(
                [line['text'] for scene_lines in lines_map.values() for line in scene_lines],
                ['First line.', 'Second line.', 'Song!'],
            )
            self.assertEqual(speeches[-1]['speaker'], 'BOY')
        finally:
            tmp_path.unlink(missing_ok=True)

    def test_mistyped_scene_with_speeches_is_kept_and_tei_numbers_win(self):
        xml = '''<TEI><text><body><div type="act" n="4">
        <div type="scene" n="1"><sp><speaker>A</speaker><p>One</p></sp></div>
        <div type="act" n="4"><sp><speaker>B</speaker><p>Recovered</p></sp></div>
        <div type="scene" n="5"><sp><speaker>C</speaker><p>Five</p></sp></div>
        </div></body></text></TEI>'''
        with tempfile.NamedTemporaryFile(mode="w", suffix=".xml", delete=False) as tmp:
            tmp.write(xml)
            tmp_path = Path(tmp.name)
        try:
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                scenes, *_ = build.parse_play(tmp_path, 1)
            self.assertEqual([scene["scene"] for scene in scenes], [1, 4, 5])
            self.assertEqual([scene["num_speeches"] for scene in scenes], [1, 1, 1])
            self.assertIn("treating unrecognized", stderr.getvalue())
        finally:
            tmp_path.unlink(missing_ok=True)

if __name__ == '__main__':
    unittest.main()
