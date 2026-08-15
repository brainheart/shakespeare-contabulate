"""Sanity checks on build output (docs/data/*.json).
Run with: python3 -m pytest tests/test_build_output.py -v
Or:       python3 -m unittest tests.test_build_output -v
"""
import unittest
import json
from pathlib import Path
import xml.etree.ElementTree as ET

DATA_DIR = Path(__file__).parent.parent / 'docs' / 'data'
LINES_DIR = Path(__file__).parent.parent / 'docs' / 'lines'
TEI_DIR = Path(__file__).parent.parent / 'tei'
PLAY_METADATA = Path(__file__).parent.parent / 'play_metadata.json'


def localname(tag):
    return tag.rsplit('}', 1)[-1]


class TestBuildOutputExists(unittest.TestCase):
    """Verify all expected data files exist."""

    EXPECTED_FILES = [
        'plays.json', 'chunks.json', 'characters.json',
        'speeches.json',
        'tokens.json', 'tokens2.json', 'tokens3.json',
        'tokens_char.json', 'tokens_char2.json', 'tokens_char3.json',
        'character_name_filter_config.json',
    ]

    def test_all_data_files_exist(self):
        for f in self.EXPECTED_FILES:
            self.assertTrue((DATA_DIR / f).exists(), f'{f} must exist in docs/data/')

    def test_lines_file_exists(self):
        self.assertTrue((LINES_DIR / 'all_lines.json').exists(), 'all_lines.json must exist')

    def test_name_filter_is_explicitly_enabled(self):
        config = json.loads((DATA_DIR / 'character_name_filter_config.json').read_text())
        self.assertIs(config.get('enabled'), True)
        self.assertTrue(config.get('source'))


class TestPlays(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(DATA_DIR / 'plays.json') as f:
            cls.plays = json.load(f)

    def test_38_plays(self):
        self.assertEqual(len(self.plays), 38)

    def test_play_has_required_fields(self):
        required = {
            'play_id', 'title', 'abbr', 'genre', 'total_words', 'total_lines',
            'num_acts', 'num_scenes', 'num_characters'
        }
        for p in self.plays:
            self.assertTrue(required.issubset(p.keys()), f"Play {p.get('title', '?')} missing fields: {required - set(p.keys())}")

    def test_all_plays_have_5_acts(self):
        for p in self.plays:
            self.assertEqual(p['num_acts'], 5, f"{p['title']} has {p['num_acts']} acts, expected 5")

    def test_genres_are_valid(self):
        valid = {'comedy', 'tragedy', 'history', 'romance'}
        for p in self.plays:
            self.assertIn(p['genre'], valid, f"{p['title']} has unknown genre '{p['genre']}'")

    def test_troilus_is_a_tragedy_and_genre_counts_are_correct(self):
        troilus = next(p for p in self.plays if p['abbr'] == 'TRO')
        self.assertEqual(troilus['genre'], 'tragedy')
        counts = {}
        for play in self.plays:
            counts[play['genre']] = counts.get(play['genre'], 0) + 1
        self.assertEqual(counts, {'comedy': 12, 'tragedy': 11, 'history': 10, 'romance': 5})

    def test_two_noble_kinsmen_is_the_stable_38th_play(self):
        tnk = next(p for p in self.plays if p['abbr'] == 'TNK')
        self.assertEqual(
            {
                'play_id': tnk['play_id'],
                'title': tnk['title'],
                'genre': tnk['genre'],
                'num_acts': tnk['num_acts'],
                'num_scenes': tnk['num_scenes'],
                'num_speeches': tnk['num_speeches'],
                'total_lines': tnk['total_lines'],
            },
            {
                'play_id': 38,
                'title': 'The Two Noble Kinsmen',
                'genre': 'romance',
                'num_acts': 5,
                'num_scenes': 26,
                'num_speeches': 840,
                'total_lines': 3382,
            },
        )

    def test_generated_play_ids_match_metadata(self):
        metadata = json.loads(PLAY_METADATA.read_text())
        expected = {p['abbr']: p['play_id'] for p in metadata['plays']}
        actual = {p['abbr']: p['play_id'] for p in self.plays}
        self.assertEqual(actual, expected)
        self.assertEqual(
            {abbr: actual[abbr] for abbr in ('WT', 'TIM', 'TIT', 'TRO', 'TN', 'TNK')},
            {'WT': 33, 'TIM': 34, 'TIT': 35, 'TRO': 36, 'TN': 37, 'TNK': 38},
        )

    def test_unique_play_ids(self):
        ids = [p['play_id'] for p in self.plays]
        self.assertEqual(len(ids), len(set(ids)), 'play_ids must be unique')

    def test_unique_abbreviations(self):
        abbrs = [p['abbr'] for p in self.plays]
        self.assertEqual(len(abbrs), len(set(abbrs)), 'abbreviations must be unique')

    def test_character_counts_match_character_rows(self):
        characters = json.loads((DATA_DIR / 'characters.json').read_text())
        counts = {}
        for character in characters:
            play_id = character['play_id']
            counts[play_id] = counts.get(play_id, 0) + 1
        for play in self.plays:
            self.assertEqual(
                play['num_characters'],
                counts.get(play['play_id'], 0),
                f"Character count mismatch for {play['title']}"
            )
        hamlet = next(play for play in self.plays if play['abbr'] == 'HAM')
        self.assertEqual(hamlet['num_characters'], 39)


class TestChunks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(DATA_DIR / 'chunks.json') as f:
            cls.chunks = json.load(f)
        with open(DATA_DIR / 'plays.json') as f:
            cls.play_ids = {p['play_id'] for p in json.load(f)}

    def test_has_chunks(self):
        self.assertGreater(len(self.chunks), 700)

    def test_chunk_has_required_fields(self):
        required = {'scene_id', 'play_id', 'act', 'scene', 'total_words'}
        for c in self.chunks[:10]:
            self.assertTrue(required.issubset(c.keys()), f"Chunk {c.get('scene_id')} missing fields")

    def test_all_chunks_reference_valid_plays(self):
        for c in self.chunks:
            self.assertIn(c['play_id'], self.play_ids, f"Chunk {c['scene_id']} references unknown play_id {c['play_id']}")

    def test_unique_scene_ids(self):
        ids = [c['scene_id'] for c in self.chunks]
        self.assertEqual(len(ids), len(set(ids)), 'scene_ids must be unique')

    def test_king_lear_scene_structure_and_recovered_scene(self):
        lear = [c for c in self.chunks if c['play_id'] == 17]
        self.assertEqual(len(lear), 26)
        act_four = [c for c in lear if c['act'] == 4]
        self.assertEqual([c['scene'] for c in act_four], list(range(1, 8)))
        recovered = next(c for c in act_four if c['scene'] == 4)
        lines = json.loads((LINES_DIR / f"{recovered['scene_id']}.json").read_text())
        self.assertEqual({line['speaker'] for line in lines}, {'CORDELIA', 'DOCTOR', 'MESSENGER'})
        self.assertTrue(any('was met even now' in line['text'] for line in lines))
        reunion = next(c for c in act_four if c['scene'] == 7)
        reunion_lines = json.loads((LINES_DIR / f"{reunion['scene_id']}.json").read_text())
        self.assertTrue(any(line['speaker'] == 'LEAR' for line in reunion_lines))
        self.assertTrue(any(line['speaker'] == 'CORDELIA' for line in reunion_lines))

    def test_two_noble_kinsmen_source_structure_is_preserved(self):
        tnk = [c for c in self.chunks if c['play_id'] == 38]
        self.assertEqual(len(tnk), 26)
        self.assertEqual(sum(c['num_speeches'] for c in tnk), 840)
        self.assertEqual(sum(c['num_lines'] for c in tnk), 3382)
        self.assertEqual(tnk[0]['canonical_id'], 'TNK.0.1')
        self.assertEqual(tnk[0]['act_label'], 'Prologue')
        self.assertEqual(tnk[-1]['canonical_id'], 'TNK.6.2')
        self.assertEqual(tnk[-1]['act_label'], 'Epilogue')
        prologue = json.loads((LINES_DIR / f"{tnk[0]['scene_id']}.json").read_text())
        epilogue = json.loads((LINES_DIR / f"{tnk[-1]['scene_id']}.json").read_text())
        self.assertEqual(prologue[0]['text'], 'New plays and maidenheads are near akin:')
        self.assertEqual(epilogue[-1]['text'], 'Rest at your service. Gentlemen, good night.')

    def test_no_orphan_per_scene_line_files(self):
        expected = {f"{chunk['scene_id']}.json" for chunk in self.chunks}
        actual = {path.name for path in LINES_DIR.glob('*.json') if path.name != 'all_lines.json'}
        self.assertEqual(actual, expected)


class TestTokens(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(DATA_DIR / 'tokens.json') as f:
            cls.tokens = json.load(f)
        with open(DATA_DIR / 'tokens2.json') as f:
            cls.tokens2 = json.load(f)
        with open(DATA_DIR / 'tokens3.json') as f:
            cls.tokens3 = json.load(f)

    def test_unigrams_count(self):
        self.assertGreater(len(self.tokens), 20000)

    def test_bigrams_count(self):
        self.assertGreater(len(self.tokens2), 200000)

    def test_trigrams_count(self):
        self.assertGreater(len(self.tokens3), 400000)

    def test_common_words_present(self):
        for word in ['the', 'love', 'death', 'king', 'lord']:
            self.assertIn(word, self.tokens, f"'{word}' should be in unigrams")

    def test_posting_format(self):
        """Each posting should be [scene_id, count]."""
        for word in ['the', 'love']:
            postings = self.tokens[word]
            self.assertIsInstance(postings, list)
            self.assertGreater(len(postings), 0)
            for p in postings[:5]:
                self.assertIsInstance(p, list)
                self.assertEqual(len(p), 2)
                self.assertIsInstance(p[0], int)  # scene_id
                self.assertIsInstance(p[1], int)  # count

    def test_scene_unigram_postings_sum_to_scene_word_total(self):
        """The scene vocabulary door can be backed exactly by scene postings."""
        chunks = json.loads((DATA_DIR / 'chunks.json').read_text())
        scene = next(c for c in chunks if c['scene_id'] == 7002)
        posting_total = sum(
            count
            for postings in self.tokens.values()
            for scene_id, count in postings
            if scene_id == scene['scene_id']
        )
        self.assertEqual(posting_total, scene['total_words'])


class TestCharacters(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(DATA_DIR / 'characters.json') as f:
            cls.chars = json.load(f)

    def test_has_characters(self):
        self.assertGreater(len(self.chars), 1000)

    def test_character_has_required_fields(self):
        required = {'character_id', 'play_id', 'name', 'total_words_spoken'}
        for c in self.chars[:10]:
            self.assertTrue(required.issubset(c.keys()), f"Character {c.get('name')} missing fields")

    def test_hamlet_exists(self):
        hamlets = [c for c in self.chars if c['name'].upper() == 'HAMLET']
        self.assertGreater(len(hamlets), 0, 'Hamlet should exist as a character')

    def test_corrected_female_characters(self):
        expected = {
            ('AWW', 'HELEN'), ('AWW', 'MARIANA'), ('AWW', 'WIDOW'),
            ('MM', 'ISABELLA'), ('MM', 'MARIANA'),
            ('COR', 'VOLUMNIA'), ('COR', 'VIRGILIA'), ('COR', 'VALERIA'),
            ('TRO', 'CRESSIDA'), ('TRO', 'CASSANDRA'), ('TRO', 'HELEN'),
            ('1H6', 'PUCELLE'),
            ('WT', 'HERMIONE'), ('WT', 'DORCAS'), ('WT', 'MOPSA'),
            ('LLL', 'ROSALINE'), ('LLL', 'JAQUENETTA'),
            ('PER', 'MARINA'), ('PER', 'DIONYZA'), ('PER', 'THAISA'),
            ('MND', 'TITANIA'),
            ('ANT', 'CHARMIAN'), ('ANT', 'IRAS'),
            ('AYL', 'PHOEBE'), ('AYL', 'AUDREY'),
            ('2H4', 'DOLL'), ('JC', 'CALPHURNIA'), ('JN', 'BLANCHE'),
            ('ADO', 'URSULA'), ('ERR', 'LUCE'), ('TGV', 'LUCETTA'),
        }
        actual = {
            (character['play_abbr'], character['name'])
            for character in self.chars
            if character['gender'] == 'F'
        }
        self.assertTrue(expected.issubset(actual), f"Missing corrected female characters: {expected - actual}")

    def test_female_share_of_labelled_words_is_plausible(self):
        labelled = [character for character in self.chars if character['gender'] in {'F', 'M'}]
        female_words = sum(character['total_words_spoken'] for character in labelled if character['gender'] == 'F')
        labelled_words = sum(character['total_words_spoken'] for character in labelled)
        self.assertGreaterEqual(female_words / labelled_words, 0.16)
        self.assertLessEqual(female_words / labelled_words, 0.18)

    def test_character_unigram_postings_sum_to_spoken_word_total(self):
        """The main-table character vocabulary uses a complete token index."""
        hamlet = next(
            c for c in self.chars
            if c['name'].upper() == 'HAMLET' and c['play_title'] == 'Hamlet'
        )
        tokens_char = json.loads((DATA_DIR / 'tokens_char.json').read_text())
        posting_total = sum(
            count
            for postings in tokens_char.values()
            for character_id, count in postings
            if character_id == hamlet['character_id']
        )
        self.assertEqual(posting_total, hamlet['total_words_spoken'])


class TestSpeeches(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.speeches = json.loads((DATA_DIR / 'speeches.json').read_text())
        cls.characters = json.loads((DATA_DIR / 'characters.json').read_text())

    def test_speech_rows_are_complete_and_unique(self):
        self.assertEqual(len(self.speeches), 31906)
        required = {
            'speech_id', 'canonical_id', 'scene_id', 'play_id', 'act', 'scene',
            'speech_num', 'speaker', 'character_ids', 'text',
            'line_count', 'total_words'
        }
        for speech in self.speeches:
            self.assertTrue(required.issubset(speech), f"Speech {speech.get('speech_id')} missing fields")
            self.assertEqual(speech['line_count'], len(speech['text'].splitlines()))
        speech_ids = [speech['speech_id'] for speech in self.speeches]
        self.assertEqual(len(speech_ids), len(set(speech_ids)))

    def test_speech_count_matches_folger_tei(self):
        source_speech_count = 0
        for path in TEI_DIR.glob('*.xml'):
            root = ET.parse(path).getroot()
            source_speech_count += sum(1 for elem in root.iter() if localname(elem.tag) == 'sp')
        self.assertEqual(source_speech_count, len(self.speeches))

    def test_character_speech_counts_match_speech_membership(self):
        membership_counts = {}
        for speech in self.speeches:
            for character_id in speech['character_ids']:
                membership_counts[character_id] = membership_counts.get(character_id, 0) + 1
        for character in self.characters:
            self.assertEqual(
                membership_counts.get(character['character_id'], 0),
                character['num_speeches'],
                f"Speech membership mismatch for {character['play_title']} / {character['name']}"
            )

    def test_hamlet_speech_count_is_358(self):
        hamlet = next(
            character for character in self.characters
            if character['name'] == 'HAMLET' and character['play_title'] == 'Hamlet'
        )
        matching = [
            speech for speech in self.speeches
            if hamlet['character_id'] in speech['character_ids']
        ]
        self.assertEqual(hamlet['num_speeches'], 358)
        self.assertEqual(len(matching), hamlet['num_speeches'])


class TestLocationWidths(unittest.TestCase):
    """Keep the compact browser location format collision-free."""

    @classmethod
    def setUpClass(cls):
        cls.chunks = json.loads((DATA_DIR / 'chunks.json').read_text())
        cls.speeches = json.loads((DATA_DIR / 'speeches.json').read_text())
        cls.lines = json.loads((LINES_DIR / 'all_lines.json').read_text())

    def test_compact_location_component_bounds(self):
        self.assertEqual(max(chunk['act'] for chunk in self.chunks), 6)
        self.assertEqual(max(chunk['scene'] for chunk in self.chunks), 15)
        self.assertEqual(max(speech['speech_num'] for speech in self.speeches), 407)
        self.assertEqual(max(line['line_num'] for line in self.lines), 4068)

        self.assertLess(max(chunk['act'] for chunk in self.chunks), 10)
        self.assertLess(max(chunk['scene'] for chunk in self.chunks), 100)
        self.assertLess(max(speech['speech_num'] for speech in self.speeches), 1000)
        self.assertLess(max(line['line_num'] for line in self.lines), 10000)


class TestPublishedMetadata(unittest.TestCase):
    def test_no_commentary_data_ships(self):
        self.assertFalse((DATA_DIR / 'commentary_interest.json').exists())

    def test_hapax_counts(self):
        chunks = json.loads((DATA_DIR / 'chunks.json').read_text())
        self.assertIn('hapax_count', chunks[0])
        self.assertGreater(sum(c['hapax_count'] for c in chunks), 5000)
        chars = json.loads((DATA_DIR / 'characters.json').read_text())
        self.assertIn('hapax_count', chars[0])
        # Every corpus hapax spoken by a character is attributed to one
        total_char_hapax = sum(c['hapax_count'] for c in chars)
        total_scene_hapax = sum(c['hapax_count'] for c in chunks)
        self.assertLessEqual(total_char_hapax, total_scene_hapax)

    def test_instance_json_published(self):
        instance = json.loads((DATA_DIR.parent / 'instance.json').read_text())
        self.assertEqual(instance['id'], 'shakespeare')
        self.assertEqual(instance['created'], '2025-09-09')
        self.assertEqual(instance['stats']['texts'], 38)
        self.assertEqual(instance['stats']['segments'], 112537)
        self.assertEqual(instance['stats']['segment_label'], 'lines')
        self.assertEqual(instance['stats']['commentaries'], 0)
        self.assertEqual(instance['stats']['comments'], 0)
        self.assertEqual(len(instance['sample_queries']), 1)

    def test_recovered_lear_phrases_occur_once(self):
        lines = json.loads((LINES_DIR / 'all_lines.json').read_text())
        texts = [line['text'].lower() for line in lines]
        for phrase in ('was met even now', 'century send forth', 'aidant and remediate'):
            self.assertEqual(sum(phrase in text for text in texts), 1, phrase)


class TestSpokenTextHygiene(unittest.TestCase):
    """Stage directions and TEI pretty-printing must not leak into published text."""

    @classmethod
    def setUpClass(cls):
        cls.lines = json.loads((LINES_DIR / 'all_lines.json').read_text())
        with open(DATA_DIR / 'characters.json') as f:
            cls.chars = json.load(f)

    def test_no_raw_whitespace_in_names_speakers_or_text(self):
        import re
        messy = re.compile(r'\s{2,}|[\n\t]')
        self.assertEqual([c['name'] for c in self.chars if messy.search(c['name'])], [])
        self.assertEqual([l['canonical_id'] for l in self.lines if messy.search(l['speaker'])], [])
        self.assertEqual([l['canonical_id'] for l in self.lines if messy.search(l['text'])], [])

    def test_known_stage_direction_leaks_are_clean(self):
        by_id = {l['canonical_id']: l['text'] for l in self.lines}
        # TEIsimple inline stage: was "…out of the air. Aside . How…"
        self.assertNotIn('Aside', by_id['HAM.2.2.222'])
        # TNK master format inline stage: was "…the gods.Enter Valerius."
        self.assertEqual(by_id['TNK.1.2.93'], 'Due audience of the gods.')
        # Read-aloud letters must not start with the "reads" cue
        self.assertEqual([l['canonical_id'] for l in self.lines
                          if l['text'].lower().startswith('reads ')], [])
        # Stage cues must not survive as standalone "lines" (e.g. PER 5.1 "sings")
        cues = {'sings', 'aside', 'exits', 'exeunt', 'reads', 'sings a song'}
        self.assertEqual([l['canonical_id'] for l in self.lines
                          if l['text'].strip(' .').lower() in cues], [])

    def test_dialogue_exit_lines_survive(self):
        # Jaques' "they have their exits and their entrances" is dialogue, not
        # a stage direction, and must remain searchable.
        self.assertTrue(any('their exits and their entrances' in l['text'] for l in self.lines))


if __name__ == '__main__':
    unittest.main()
