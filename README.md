# Nhận diện cây dược liệu Việt Nam bằng BioCLIP 2

Prototype nhận diện **20 loài cây** bằng BioCLIP 2 chạy **trên laptop/server local**, kết hợp zero-shot (văn bản) và ảnh tham chiếu (Reference Verification). ESP32-CAM chỉ chụp ảnh; **không chạy BioCLIP 2**.

## Kiến trúc đang hoạt động

- **Điện thoại / Tải ảnh:** Chọn hoặc chụp ảnh qua trình duyệt → `POST /api/predict` → hiển thị tên cây và thông tin dược liệu.
- **ESP32-CAM:** Giữ nguyên firmware **CameraWebServer** và các setting tại trang của camera. Trên web nhận diện, chọn **ESP32-CAM → Chụp ảnh** → FastAPI lấy JPEG từ `/capture` → hiển thị ảnh xem trước → nhấn **Nhận diện** → `POST /api/predict`.
- **AI:** BioCLIP 2 local → so sánh zero-shot + ảnh tham chiếu → `recognized` / `uncertain` / `unknown`.

Hiện **không dùng MQTT**; **LED chưa triển khai**. CameraWebServer vẫn dùng để chỉnh độ phân giải, JPEG Quality, v.v. Web nhận diện không thay các setting này.

## Các file chính

| Đường dẫn | Mục đích |
| --- | --- |
| `backend/main.py` | FastAPI, lấy ảnh ESP32-CAM, API nhận diện |
| `backend/model.py` | BioCLIP 2 + Reference Verification |
| `frontend/` | Web chọn nguồn ảnh, xem trước và hiển thị kết quả |
| `species.json` | 20 loài đang hỗ trợ |
| `medicinal_info.json` | Thông tin dược liệu hiển thị |
| `unknown_config.json` | Ngưỡng heuristics để từ chối/đánh dấu chưa chắc chắn |
| `scripts/build_reference_embeddings.py` | Tạo lại embeddings từ ảnh tham chiếu khi cần |
| `scripts/test_esp32_camera.py` | Kiểm thử chụp và gửi ảnh từ camera bằng Python |
| `scripts/simulate_esp32.py` | Mô phỏng yêu cầu gửi ảnh JPEG bằng Python |
| `tests/test_contract.py` | Kiểm tra cơ bản cho danh sách loài |
| `download_model.py` | Tải checkpoint nếu thiết lập trên máy mới |

Các file **không lưu trên GitHub**: `models/`, `.venv/`, `reference_images/`, `reference_embeddings.npz`, `data/` (SQLite runtime), ảnh chụp kiểm thử. Không xóa các file này trên máy đang chạy.

## Chạy trên Windows (máy đang dùng)

Yêu cầu: Python cùng môi trường đã cài dependencies; ESP32-CAM và laptop có thể truy cập nhau qua LAN.

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

- Trên laptop: `http://127.0.0.1:8000`
- Trên điện thoại cùng LAN: `http://<IP_LAPTOP>:8000` (xem IP bằng `ipconfig`).
- CameraWebServer: ví dụ `http://192.168.1.153/`, ảnh JPEG tại `http://192.168.1.153/capture`. **IP chỉ là ví dụ từ lần kiểm thử, có thể thay đổi.**

FastAPI mặc định lấy ảnh tại `http://192.168.1.153/capture`. Nếu ESP32-CAM đổi IP, thiết lập URL **trước khi khởi chạy FastAPI**:

```powershell
$env:ESP32_CAPTURE_URL = "http://192.168.1.153/capture"
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

`ESP32_CAPTURE_URL` phải là địa chỉ IPv4 private trong LAN, dùng HTTP và đường dẫn `/capture`. Khi thử chụp từ web, nên dừng video stream để tránh tranh chấp tài nguyên camera.

## Thiết lập trên máy mới

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe download_model.py
```

Lệnh trên tạo thư mục checkpoint `models/bioclip-2/`. Code `backend/model.py` mặc định trỏ tới checkpoint local này qua `MODEL_ID=local-dir:<ROOT>/models/bioclip-2`.

**Cần có bộ ảnh tham chiếu ở `reference_images/<species_key>/`** tương ứng với toàn bộ `species.json`. Bộ ảnh này không có trong GitHub; cần chuẩn bị từ bản backup được phép sử dụng. Không thay thế hoặc xóa bộ ảnh trên máy đang chạy.

Sau khi có checkpoint và ảnh tham chiếu hợp lệ, chạy (chỉ khi thiết lập mới hoặc đổi ảnh/model/danh sách loài):

```powershell
.\.venv\Scripts\python.exe scripts/build_reference_embeddings.py
```

Lệnh tạo `reference_embeddings.npz`. **Trên laptop hiện tại file này đã có; không cần chạy lại** nếu không thay nguồn dữ liệu, model hoặc danh sách loài. Bất kỳ thay đổi nào đối với `species.json` phải đồng bộ với embeddings.

Biến môi trường tùy chọn xem `.env.example`. File `.env` **không tự được đọc** nếu không có công cụ nạp env; trên PowerShell có thể thiết lập các biến bằng `$env:TEN_BIEN = "gia-tri"`.

## API

| Đường dẫn | Chức năng |
| --- | --- |
| `GET /` | Web nhận diện |
| `GET /api/esp32/capture` | FastAPI truy cập camera /capture và trả ảnh JPEG |
| `POST /api/predict` | Nhận `multipart/form-data`, trường `file`; trả JSON kết quả |
| `GET /api/species` | Danh sách 20 loài |
| `GET /api/health` | Trạng thái backend/model |
| `GET /api/history` | Metadata kết quả xử lý (không hiển thị trong giao diện hiện tại) |

Web gọi `/api/predict` với `X-Source: web`. Nếu ứng dụng/thiết bị tự gửi `X-Source: esp32` và server có thiết lập `DEVICE_API_KEY`, cần thêm `X-Device-Key`. Đường lấy ảnh `/api/esp32/capture` sử dụng server làm trung gian; không yêu cầu browser điện thoại truy cập trực tiếp camera.

## Kiểm thử

```powershell
.\.venv\Scripts\python.exe -m pytest tests
```

Nếu chưa có pytest, cài vào môi trường bằng `.\.venv\Scripts\python.exe -m pip install pytest`; `pytest` hiện chưa nằm trong `requirements.txt`.

Để chạy script test camera, sửa `CAMERA_URL` trong `scripts/test_esp32_camera.py` theo IP thực tế, rồi chạy script trong lúc FastAPI đang mở.

## Giới hạn và lưu ý

- `unknown` và `uncertain` là **heuristics** dựa trên cosine similarity và margin, chưa phải xác suất tin cậy đã hiệu chuẩn. Cần đánh giá trên dữ liệu ngoài danh sách.
- Một số tên/thuộc tính cây cần xác minh bằng nguồn thực vật học đáng tin cậy. Thông tin dược liệu chỉ tham khảo, không thay thế lời khuyên chuyên môn.
- ESP32-CAM AI Thinker chỉ dùng Wi-Fi 2,4 GHz. Điện thoại/laptop có thể dùng 5 GHz nếu cùng mạng LAN.
- Đây là prototype trong mạng LAN tin cậy; không mở trực tiếp FastAPI hoặc CameraWebServer ra Internet khi chưa bổ sung xác thực và các biện pháp bảo mật thích hợp.
- Model tham khảo: https://huggingface.co/imageomics/bioclip-2
