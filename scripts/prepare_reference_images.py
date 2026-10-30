import shutil
import zipfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ZIP_PATH = ROOT / "DataCheck.zip"
EXTRACT_DIR = ROOT / "_tmp_reference_extract"
OUT_DIR = ROOT / "reference_images"

VN_TO_KEY = {
    "Đinh lăng": "Dinh_lang",
    "Chùm ngây": "Chum_ngay",
    "Nha đam": "Nha_dam",
    "Dâm bụt": "Dam_but",
    "Đu đủ": "Du_du",
    "Sài đất": "Sai_dat",
    "Xương sông": "Xuong_song",
    "Mùi tàu": "Mui_tau",
    "Rau răm": "Rau_ram",
    "Lá mơ lông": "La_mo",
    "Sả": "Sa",
    "Rau má": "Rau_ma",
    "Mã đề": "Ma_de",
    "Chó đẻ": "Cho_de",
    "Đơn lá đỏ": "Don_la_do",
    "Trầu không": "Trau_khong",
    "Lá bỏng": "La_bong",
    "Dâu tằm": "Dau_tam",
    "Nguyệt quế": "Nguyet_que",
    "Cây si": "Cay_si",
}

VALID_EXTS = {".jpg", ".jpeg", ".png", ".jfif", ".webp", ".bmp", ".tif", ".tiff"}

def is_valid_image(path: Path) -> bool:
    try:
        with Image.open(path) as img:
            img.verify()
        return True
    except Exception:
        return False

def main():
    if not ZIP_PATH.exists():
        raise FileNotFoundError(f"Không thấy file: {ZIP_PATH}")

    if EXTRACT_DIR.exists():
        shutil.rmtree(EXTRACT_DIR)
    EXTRACT_DIR.mkdir(parents=True, exist_ok=True)

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        zf.extractall(EXTRACT_DIR)

    root_candidates = [p for p in EXTRACT_DIR.iterdir() if p.is_dir()]
    if not root_candidates:
        raise RuntimeError("Không tìm thấy thư mục ảnh sau khi giải nén.")
    data_root = root_candidates[0]

    copied = 0

    for vn_name, key in VN_TO_KEY.items():
        src_dir = data_root / vn_name
        dst_dir = OUT_DIR / key
        dst_dir.mkdir(parents=True, exist_ok=True)

        if not src_dir.exists():
            print(f"[WARN] Không thấy thư mục: {src_dir}")
            continue

        idx = 1
        for f in sorted(src_dir.iterdir()):
            if not f.is_file():
                continue
            if f.suffix.lower() not in VALID_EXTS:
                continue
            if not is_valid_image(f):
                print(f"[SKIP] Ảnh lỗi: {f.name}")
                continue

            new_name = f"{key}_{idx:02d}.jpg"
            out_path = dst_dir / new_name

            try:
                with Image.open(f) as img:
                    img = img.convert("RGB")
                    img.save(out_path, format="JPEG", quality=95)
                copied += 1
                idx += 1
            except Exception as e:
                print(f"[SKIP] Không chuyển được {f.name}: {e}")

    print(f"\nHoàn tất. Đã tạo thư mục: {OUT_DIR}")
    print(f"Tổng ảnh hợp lệ: {copied}")

if __name__ == "__main__":
    main()