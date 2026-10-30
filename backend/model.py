import json
import os
import threading
import time
from pathlib import Path

import numpy as np
import open_clip
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = os.getenv("MODEL_ID", f"local-dir:{ROOT / 'models' / 'bioclip-2'}")


class BioCLIPService:
    def __init__(self):
        self.species = json.loads((ROOT / "species.json").read_text(encoding="utf-8"))
        self.keys = [item["key"] for item in self.species]
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = None
        self.preprocess = None
        self.embeddings = None
        self.ref_vectors = None
        self.ref_keys = None
        self.ref_prototypes = None
        self.lock = threading.Lock()
        self.error = None

    def _load_refs(self):
        path = ROOT / "reference_embeddings.npz"
        if not path.is_file():
            raise FileNotFoundError(
                f"Chua co {path}. Chay scripts/build_reference_embeddings.py truoc."
            )
        with np.load(path, allow_pickle=False) as data:
            class_keys = data["class_keys"].tolist()
            image_keys = data["image_keys"].tolist()
            vectors = data["image_embeddings"].astype(np.float32)
            prototypes = data["prototypes"].astype(np.float32)
            saved_model_id = str(data["model_id"].item())

        if class_keys != self.keys:
            raise ValueError("reference_embeddings.npz khong khop thu tu/key species.json; hay build lai")
        if saved_model_id != MODEL_ID:
            raise ValueError("Checkpoint/reference khong trung MODEL_ID; hay build lai embedding")
        if len(image_keys) != len(vectors) or prototypes.shape[0] != len(self.keys):
            raise ValueError("Du lieu reference_embeddings.npz khong hop le")
        if not all(key in image_keys for key in self.keys):
            raise ValueError("Reference thieu anh cua it nhat mot loai")
        if vectors.shape[1] != self.embeddings.shape[1]:
            raise ValueError("Chieu embedding image-text khong khop")
        self.ref_vectors = vectors
        self.ref_keys = np.asarray(image_keys)
        self.ref_prototypes = prototypes

    def load(self):
        if self.model is not None:
            return
        with self.lock:
            if self.model is not None:
                return
            try:
                model, _, prep = open_clip.create_model_and_transforms(MODEL_ID)
                model = model.to(self.device).eval()
                tokenizer = open_clip.get_tokenizer(MODEL_ID)
                prompts = [f'a photo of the plant {s["scientific_name"]}' for s in self.species]
                tokens = tokenizer(prompts).to(self.device)
                with torch.inference_mode():
                    vecs = model.encode_text(tokens)
                    vecs = torch.nn.functional.normalize(vecs.float(), dim=-1)
                self.embeddings = vecs
                self._load_refs()
                self.model = model
                self.preprocess = prep
                self.error = None
                print(f"[OK] BioCLIP 2 LOCAL + {len(self.ref_keys)} anh tham chieu")
            except Exception as exc:
                self.error = f"{type(exc).__name__}: {exc}"
                raise

    def predict(self, image: Image.Image, top_k=5):
        self.load()
        started = time.perf_counter()
        tensor = self.preprocess(image.convert("RGB")).unsqueeze(0).to(self.device)
        with self.lock, torch.inference_mode():
            if self.device == "cuda":
                torch.cuda.synchronize()
            t0 = time.perf_counter()
            emb = self.model.encode_image(tensor)
            emb = torch.nn.functional.normalize(emb.float(), dim=-1)
            text_sims = (emb @ self.embeddings.T).flatten()
            relative_scores = torch.softmax(text_sims * 100.0, dim=0)
            if self.device == "cuda":
                torch.cuda.synchronize()
            infer_ms = (time.perf_counter() - t0) * 1000

        order = torch.argsort(text_sims, descending=True).tolist()
        predictions = [
            dict(**self.species[i],
                 cosine_similarity=round(float(text_sims[i].item()), 6),
                 relative_score=round(float(relative_scores[i].item()), 6))
            for i in order[:min(top_k, len(order))]
        ]
        top1 = float(text_sims[order[0]].item())
        top2 = float(text_sims[order[1]].item())
        margin = top1 - top2
        score_gap = float(relative_scores[order[0]].item() - relative_scores[order[1]].item())

        query = emb[0].detach().cpu().numpy().astype(np.float32)
        class_ref_scores = []
        for i, key in enumerate(self.keys):
            members = self.ref_vectors[self.ref_keys == key]
            similarities = members @ query
            best = np.sort(similarities)[::-1][:min(3, len(similarities))]
            knn = float(best.mean())
            proto = float(self.ref_prototypes[i] @ query)
            class_ref_scores.append(0.5 * knn + 0.5 * proto)
        class_ref_scores = np.asarray(class_ref_scores, dtype=np.float32)
        ref_order = np.argsort(-class_ref_scores).tolist()
        ref_winner = ref_order[0]
        ref_top1 = float(class_ref_scores[ref_winner])
        ref_margin = float(class_ref_scores[ref_order[0]] - class_ref_scores[ref_order[1]])

        config_path = ROOT / "unknown_config.json"
        cfg = json.loads(config_path.read_text(encoding="utf-8")) if config_path.is_file() else {}
        text_min = float(os.getenv("TEXT_MIN", cfg.get("text_min", 0.60)))
        ref_min = float(os.getenv("REF_MIN", cfg.get("ref_min", 0.75)))
        text_margin_min = float(os.getenv("TEXT_MARGIN_MIN", cfg.get("text_margin_min", 0.03)))
        ref_margin_min = float(os.getenv("REF_MARGIN_MIN", cfg.get("ref_margin_min", 0.02)))

        # Heuristic ban dau. Can hieu chinh bang anh trong va ngoai danh sach doc lap.
        if top1 < text_min and ref_top1 < ref_min:
            status = "unknown"
            message = "Khong xac dinh duoc loai cay phu hop trong danh sach ho tro."
        elif order[0] != ref_winner:
            status = "uncertain"
            message = "Chua the xac dinh chinh xac loai cay."
        elif top1 < text_min or ref_top1 < ref_min:
            status = "uncertain"
            message = "Chua the xac dinh chinh xac loai cay."
        elif margin < text_margin_min or ref_margin < ref_margin_min:
            status = "uncertain"
            message = "Chua the xac dinh chinh xac loai cay."
        else:
            status = "recognized"
            message = "Da nhan dien duoc loai cay."

        winner = self.species[order[0]]
        catalog_path = ROOT / "medicinal_info.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.is_file() else {}
        info = catalog.get(winner["scientific_name"], {}) if status == "recognized" else None

        return {
            "status": status,
            "message": message,
            "predicted_class": winner["name_vi"] if status == "recognized" else None,
            "scientific_name": winner["scientific_name"] if status == "recognized" else None,
            "medicinal_info": info,
            "top1_cosine": round(top1, 6),
            "margin": round(margin, 6),
            "score_gap": round(score_gap, 6),
            "reference_score": round(ref_top1, 6),
            "reference_margin": round(ref_margin, 6),
            "reference_top1_key": self.keys[ref_winner],
            "zero_shot_top1_key": self.keys[order[0]],
            "thresholds": {
                "text_min": text_min,
                "ref_min": ref_min,
                "text_margin_min": text_margin_min,
                "ref_margin_min": ref_margin_min,
            },
            "predictions": predictions,
            "inference_ms": round(infer_ms, 2),
            "processing_ms": round((time.perf_counter() - started) * 1000, 2),
            "device": self.device,
            "model": "BioCLIP 2 + Reference Verification (local)",
        }


service = BioCLIPService()
