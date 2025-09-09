import unittest
from pathlib import Path
import build

class ParsePlaySmokeTest(unittest.TestCase):
    def test_hamlet_parse(self):
        tei = Path(__file__).parent / 'tei' / 'hamlet_TEIsimple_FolgerShakespeare.xml'
        self.assertTrue(tei.exists(), 'hamlet TEI must exist for smoke test')
        scenes, lines_map, token_idx, token2_idx, token3_idx, characters, tokens_char_tmp, play_row = build.parse_play(tei, 1)
        # basic shape checks
        self.assertIsInstance(scenes, list)
        self.assertGreater(len(scenes), 0)
        self.assertIsInstance(lines_map, dict)
        self.assertIsInstance(token_idx, dict)
        self.assertIsInstance(play_row, dict)
        self.assertIn('title', play_row)

if __name__ == '__main__':
    unittest.main()
