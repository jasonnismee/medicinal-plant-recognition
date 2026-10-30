
import io
import json
import time
from pathlib import Path

import requests
from PIL import Image

CAMERA_URL = "http://192.168.1.153/capture"
API_URL = "http://127.0.0.1:8000/api/predict"

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "esp32_test_images"
OUTPUT_DIR.mkdir(exist_ok=True)


def main():
    print("=== TEST ESP32-CAM -> BIOCLIP 2 ===")

    # 1. Lay anh JPEG tu camera
    print("\n[1] Dang chup anh tu ESP32-CAM...")

    start = time.perf_counter()

    response = requests.get(CAMERA_URL, timeout=30)
    response.raise_for_status()

    image_bytes = response.content

    # 2. Kiem tra anh JPEG
    if not image_bytes.startswith(b"\xff\xd8"):
        raise ValueError("Du lieu nhan duoc khong phai JPEG.")

    if not image_bytes.endswith(b"\xff\xd9"):
        raise ValueError("JPEG bi thieu du lieu o cuoi.")

    with Image.open(io.BytesIO(image_bytes)) as image:
        image.load()
        width, height = image.size

    # 3. Luu anh de kiem tra
    filename = (
        "esp32_"
        + time.strftime("%Y%m%d_%H%M%S")
        + ".jpg"
    )

    image_path = OUTPUT_DIR / filename
    image_path.write_bytes(image_bytes)

    print(f"[OK] Da chup: {image_path}")
    print(f"[OK] Resolution: {width}x{height}")
    print(f"[OK] JPEG size: {len(image_bytes)} bytes")
    print(f"[OK] Capture time: {time.perf_counter()-start:.2f}s")

    # 4. Gui anh den FastAPI
    print("\n[2] Dang gui anh den BioCLIP 2...")

    response = requests.post(
        API_URL,
        files={
            "file": (
                filename,
                image_bytes,
                "image/jpeg"
            )
        },
        headers={
            "X-Source": "esp32"
        },
        timeout=120
    )

    response.raise_for_status()

    # 5. Hien thi ket qua
    result = response.json()

    print("\n=== KET QUA NHAN DIEN ===")
    print(json.dumps(result, ensure_ascii=False, indent=2))

    print("\n=== TOM TAT ===")
    print("Status:", result.get("status"))
    print("Ten cay:", result.get("predicted_class"))
    print("Ten khoa hoc:", result.get("scientific_name"))
    print("Inference ms:", result.get("inference_ms"))


if __name__ == "__main__":
    try:
        main()
    except requests.exceptions.RequestException as exc:
        print("\n[NETWORK ERROR]", exc)
    except Exception as exc:
        print("\n[ERROR]", type(exc).__name__, str(exc))
