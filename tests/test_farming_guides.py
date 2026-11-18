"""Verify the complete farming document and combined frontend assets."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class FarmingGuideTests(unittest.TestCase):
    def test_every_source_section_is_preserved(self):
        source = (ROOT / 'docs/farming_guide_21_species.md').read_text(encoding='utf-8')
        catalog = json.loads((ROOT / 'medicinal_info.json').read_text(encoding='utf-8'))
        parts = re.split(r'(?=^# \d+\. )', source, flags=re.M)
        context = re.sub(r'\n---\s*$', '', parts[0]).strip()
        self.assertEqual(len(parts[1:]), 21)
        seen = set()
        for section in parts[1:]:
            name = re.match(r'# \d+\. (.*?) — ', section).group(1)
            with self.subTest(species=name):
                self.assertNotIn(name, seen)
                seen.add(name)
                self.assertEqual(catalog[name]['cultivation_guide'], re.sub(r'\n---\s*$', '', section).strip())
                self.assertEqual(catalog[name]['cultivation_context'], context)
                self.assertTrue(catalog[name]['usage_guide'].strip())
        self.assertEqual(seen, set(catalog))
        species = json.loads((ROOT / 'species.json').read_text(encoding='utf-8'))
        self.assertTrue(all(plant['scientific_name'] in seen for plant in species))

    def test_pages_use_both_guide_assets_in_order(self):
        for page in ('index.html', 'mobile.html'):
            html = (ROOT / 'frontend' / page).read_text(encoding='utf-8')
            self.assertIn('/assets/farming.js', html)
            self.assertIn('/assets/farming.css', html)
            self.assertIn('/assets/guides.js', html)
            self.assertIn('/assets/guides.css', html)
            app = '/assets/app.js' if page == 'index.html' else '/assets/mobile.js'
            self.assertLess(html.index('/assets/guides.js'), html.index('/assets/farming.js'))
            self.assertLess(html.index('/assets/farming.js'), html.index(app))


if __name__ == '__main__':
    unittest.main()
