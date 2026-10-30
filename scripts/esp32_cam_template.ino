// TEMPLATE ONLY - ESP32-CAM AI Thinker + OV2640; verify pin layout before flashing.
// Uses native HTTP POST image/jpeg, which FastAPI endpoint /api/esp32-jpeg does NOT exist.
// For the provided backend use multipart/form-data at /api/predict instead.
// See Python simulator scripts/simulate_esp32.py for the exact request contract.
// Hardware integration will be added after choosing board, Wi-Fi and LED pin.
