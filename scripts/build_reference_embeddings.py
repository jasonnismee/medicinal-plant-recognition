import json
import os
from pathlib import Path

import numpy as np
import open_clip
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPECIES_PATH = ROOT / "species.json"
REFERENCE_DIR = ROOT / "reference_images"
OUTPUT_PATH = ROOT / "reference_embeddings.npz"
MODEL_ID = os.getenv("MODEL_ID", f"local-dir:{ROOT / 'models' / 'bioclip-2'}")
EXTENSIONS = {".jpg", ".jpeg", ".png", ".jfif", ".webp", ".bmp", ".tif", ".tiff"}


def main():
    if not SPECIES_PATH.is_file():
        raise FileNotFoundError(f"Khong tim thay: {SPECIES_PATH}")
    species = json.loads(SPECIES_PATH.read_text(encoding="utf-8"))
    keys = [item["key"] for item in species]
    if not keys or len(set(keys)) != len(keys):
        raise ValueError("species.json rong hoac trung key")

    files_by_class = {}
    for key in keys:
        folder = REFERENCE_DIR / key
        files = sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS) if folder.is_dir() else []
        if not files:
            raise ValueError(f"Thieu anh tham chieu cho lop {key}: {folder}")
        files_by_class[key] = files
        print(f"{key}: {len(files)} anh", flush=True)

    print(f"\nNap checkpoint LOCAL: {MODEL_ID}", flush=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL_ID)
    model = model.to(device).eval()
    embeddings, image_keys, image_paths = [], [], []
    for key in keys:
        for path in files_by_class[key]:
            try:
                with Image.open(path) as im:
                    tensor = preprocess(im.convert("RGB")).unsqueeze(0).to(device)
                with torch.inference_mode():
                    vector = model.encode_image(tensor)
                    vector = torch.nn.functional.normalize(vector.float(), dim=-1)
                embeddings.append(vector[0].cpu().numpy())
                image_keys.append(key)
                image_paths.append(path.relative_to(ROOT).as_posix())
                print(f"[OK] {key}: {path.name}", flush=True)
            except Exception as exc:
                print(f"[LOI] {path}: {exc}", flush=True)
                raise RuntimeError("Dung lai de kiem tra anh loi, khong xuat bo embedding thieu") from exc

    image_embeddings = np.asarray(embeddings, dtype=np.float32)
    prototypes = []
    for key in keys:
        vectors = image_embeddings[np.asarray(image_keys) == key]
        center = vectors.mean(axis=0)
        center /= max(np.linalg.norm(center), 1e-12)
        prototypes.append(center)

    np.savez_compressed(
        OUTPUT_PATH,
        class_keys=np.asarray(keys, dtype=str),
        image_keys=np.asarray(image_keys, dtype=str),
        image_paths=np.asarray(image_paths, dtype=str),
        image_embeddings=image_embeddings,
        prototypes=np.asarray(prototypes, dtype=np.float32),
        model_id=np.asarray(MODEL_ID),
    )
    print(f"\nXONG: {OUTPUT_PATH}")
    print(f"{len(keys)} loai; {len(image_keys)} anh; embedding dim={image_embeddings.shape[1]}")
    print("Luu y: chua hieu chinh nguong unknown bang du lieu test.")


if __name__ == "__main__":
    main()
