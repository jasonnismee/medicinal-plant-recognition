"""Check imports against the supplied document, including every safety paragraph."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class UsageGuideTests(unittest.TestCase):
    def test_all_source_sections_are_preserved_exactly(self):
        source = (ROOT / 'docs/usage_guide_21_species.md').read_text(encoding='utf-8')
        catalog = json.loads((ROOT / 'medicinal_info.json').read_text(encoding='utf-8'))
        sections = re.split(r'(?=^### \d+\. )', source, flags=re.M)[1:]
        self.assertEqual(len(sections), 21)
        names = set()
        for section in sections:
            name = re.match(r'### \d+\. (.*?) — ', section).group(1)
            with self.subTest(species=name):
                self.assertNotIn(name, names)
                names.add(name)
                expected = re.sub(r'\n---\s*$', '', section).strip()
                self.assertEqual(catalog[name]['usage_guide'], expected)
                self.assertIn('**Lưu ý an toàn & Thận trọng**', expected)
        self.assertEqual(names, set(catalog))

    def test_every_recognizable_species_has_a_guide(self):
        species = json.loads((ROOT / 'species.json').read_text(encoding='utf-8'))
        catalog = json.loads((ROOT / 'medicinal_info.json').read_text(encoding='utf-8'))
        for plant in species:
            with self.subTest(species=plant['scientific_name']):
                self.assertTrue(catalog[plant['scientific_name']]['usage_guide'].strip())


if __name__ == '__main__':
    unittest.main()
