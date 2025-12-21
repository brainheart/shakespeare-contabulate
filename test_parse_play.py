import unittest
from pathlib import Path
import build

class ParsePlaySmokeTest(unittest.TestCase):
    def test_hamlet_parse(self):
        tei = Path(__file__).parent / 'tei' / 'hamlet_TEIsimple_FolgerShakespeare.xml'
        self.assertTrue(tei.exists(), 'hamlet TEI must exist for smoke test')
        scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, tokens_char2_tmp, tokens_char3_tmp, play_row = build.parse_play(tei, 1)
        # basic shape checks
        self.assertIsInstance(scenes, list)
        self.assertGreater(len(scenes), 0)
        self.assertIsInstance(lines_map, dict)
        self.assertIsInstance(token_idx, dict)
        self.assertIsInstance(play_row, dict)
        self.assertIn('title', play_row)

    def test_henry_v_includes_prologue_epilogue(self):
        tei = Path(__file__).parent / 'tei' / 'henry-v_TEIsimple_FolgerShakespeare.xml'
        self.assertTrue(tei.exists(), 'henry-v TEI must exist for prologue test')
        scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, tokens_char2_tmp, tokens_char3_tmp, play_row = build.parse_play(tei, 1)
        labels = {s.get("act_label") for s in scenes if s.get("act_label")}
        self.assertIn("Prologue", labels)
        self.assertIn("Epilogue", labels)

    def test_as_you_like_it_includes_epilogue(self):
        tei = Path(__file__).parent / 'tei' / 'as-you-like-it_TEIsimple_FolgerShakespeare.xml'
        self.assertTrue(tei.exists(), 'as-you-like-it TEI must exist for epilogue test')
        scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, tokens_char2_tmp, tokens_char3_tmp, play_row = build.parse_play(tei, 1)
        labels = {s.get("act_label") for s in scenes if s.get("act_label")}
        self.assertIn("Epilogue", labels)

if __name__ == '__main__':
    unittest.main()
