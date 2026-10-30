# Nhận diện cây dược liệu bằng BioCLIP 2 (prototype)

Kiến trúc: **ESP32-CAM (gửi JPEG) → FastAPI → BioCLIP 2 trên server → JSON → Web / LED (sau này)**. ESP32-CAM **không chạy AI**.

## Chức năng đã viết
- Nhận diện zero-shot **20 cây** (`species.json`), gồm nguyệt quế *Murraya paniculata*, bỏ ngải cứu.
- Dùng đúng prompt đã thử trên Kaggle: `a photo of the plant {scientific_name}`.
- Tải BioCLIP 2 **một lần** từ Hugging Face; cache embedding văn bản của 20 lớp.
- `POST /api/predict` cho web và mô phỏng ESP32-CAM; `GET /api/species`, `/api/health`, `/api/history`.
- Giao diện web hiển thị ảnh, Top-5, điểm tương đối, thời gian infer, lịch sử SQLite.
- Simulator gửi ảnh resize/nén JPEG bằng cùng giao thức HTTP dự định dùng trên ESP32-CAM.

## Cài trên Windows / Linux (khuyến nghị Python 3.11)

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Vào **http://localhost:8000**. Lần đầu dự đoán có thể tải checkpoint khoảng 1.71 GB và mất nhiều thời gian. Nếu máy có CUDA và phiên bản PyTorch GPU tương thích, model sẽ sử dụng GPU; không thì chạy CPU (rất chậm). Để cài torch GPU đúng phiên bản CUDA, xem https://pytorch.org/get-started/locally/ .

### Thử không cần camera

```bash
python scripts/simulate_esp32.py --image /duong/dan/anh.jpg
# Có thể chỉ định server từ máy khác:
python scripts/simulate_esp32.py --image /duong/dan/anh.jpg --url http://IP_SERVER:8000/api/predict
```

### Docker (CPU mặc định)

```bash
cp .env.example .env
# Trên Windows có thể copy .env.example .env
# Chỉnh DEVICE_API_KEY nếu cần thiết
# docker compose phiên bản mới hỗ trợ `required:false` trong env_file
docker compose up --build
```

Docker mẫu chạy CPU; GPU Docker cần cấu hình NVIDIA Container Toolkit và CUDA torch riêng. Để test hiệu năng gần Kaggle cần máy chủ có GPU.

### API
`POST /api/predict` multipart/form-data field `file`, có thể gửi header `X-Source: web|simulator|esp32`. Nếu `X-Source: esp32` và đặt `DEVICE_API_KEY`, phải gửi `X-Device-Key` tương ứng. Kết quả gồm `predictions` Top-5, `inference_ms`, `processing_ms`, `device`. Health check tại `/api/health`.

Cảnh báo: API mẫu không có đăng nhập và không nên để public Internet. Khi triển khai thực tế hãy dùng HTTPS qua reverse proxy, xác thực tất cả nguồn và giới hạn tốc độ. Nếu chọn chấp hành LED, ESP32 có thể nhận JSON, chỉ bật LED sau khi kiểm tra nhãn và ngưỡng phù hợp; chưa có mã ESP32 thật vì chưa chốt loại chân/camera.

## Lưu ý kỹ thuật và độ tin cậy
- Các tỷ lệ phần trăm là **softmax tương đối giữa 20 cây**, không phải độ tin cậy đã hiệu chuẩn. Model không có nhãn `unknown` đáng tin cậy; ảnh ngoài danh sách vẫn bị gán một trong 20 loài.
- Danh pháp hương nhu, chó đẻ, mã đề, bạc hà, nguyệt quế cần kiểm chứng theo cây thật. Đây là danh sách thử nghiệm, không phải xác nhận thực vật học.
- Ảnh đầu vào do người dùng gửi không được lưu; cơ sở dữ liệu chỉ lưu metadata. SQLite dùng cho demo, không phù hợp nhiều worker ghi đồng thời nếu chưa điều chỉnh.
- Tính đúng đắn của inference cần kiểm tra trên môi trường server thực vì chưa tải checkpoint và chạy GPU trong môi trường tạo mã nguồn.

Model tham khảo: https://huggingface.co/imageomics/bioclip-2 (MIT).
