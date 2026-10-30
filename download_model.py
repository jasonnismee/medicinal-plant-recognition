
from pathlib import Path
from huggingface_hub import snapshot_download

TARGET = Path(__file__).resolve().parent / "models" / "bioclip-2"

snapshot_download(
    repo_id="imageomics/bioclip-2",
    local_dir=str(TARGET)
)

print("Da tai model ve:", TARGET)
