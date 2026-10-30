import json
from pathlib import Path

def test_species_contract():
    data=json.loads((Path(__file__).resolve().parents[1]/'species.json').read_text(encoding='utf-8'))
    assert len(data)==20
    assert len({x['key'] for x in data})==20
    assert any(x['scientific_name']=='Murraya paniculata' for x in data)
    assert all(x['scientific_name']!='Artemisia vulgaris' for x in data)
