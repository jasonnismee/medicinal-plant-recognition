import json
from pathlib import Path
from fastapi.testclient import TestClient
from backend.main import app

def test_mobile_detection_and_routes():
    client = TestClient(app)

    # 1. Desktop default access
    res = client.get('/', headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    assert res.status_code == 200
    assert 'Nhận diện cây dược liệu' in res.text
    assert 'app.js' in res.text
    # Web does not have bottom-notification
    assert 'id="bottom-notification"' not in res.text
    # Web does not have switch-to-mobile link
    assert 'Chuyển sang giao diện tối ưu cho điện thoại' not in res.text

    # 2. Mobile User-Agent access
    mobile_ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    res_mobile = client.get('/', headers={'User-Agent': mobile_ua})
    assert res_mobile.status_code == 200
    assert 'mobile.js' in res_mobile.text
    assert 'bottom-notification' in res_mobile.text
    # Mobile does not have switch-to-desktop link
    assert 'Chuyển sang giao diện máy tính' not in res_mobile.text

    # 3. Explicit /mobile endpoint
    res_explicit = client.get('/mobile')
    assert res_explicit.status_code == 200
    assert 'mobile.js' in res_explicit.text
    assert 'bottom-notification' in res_explicit.text

    # 4. Static files
    css = client.get('/assets/mobile.css')
    assert css.status_code == 200
    assert 'bottom-notification' in css.text

    js = client.get('/assets/mobile.js')
    assert js.status_code == 200
    assert 'showBottomNotification' in js.text


def test_mobile_html_elements_parity():
    mobile_html_path = Path(__file__).resolve().parents[1] / 'frontend' / 'mobile.html'
    content = mobile_html_path.read_text(encoding='utf-8')

    # Ensure required mobile elements exist
    required_ids = [
        'mode-phone',
        'mode-esp32',
        'esp32-tools',
        'capture-esp32',
        'btn-camera',
        'btn-gallery',
        'preview',
        'submit',
        'status',
        'result',
        'bottom-notification',
        'notify-icon',
        'notify-badge',
        'notify-title',
        'notify-subtitle',
        'notify-close'
    ]
    for element_id in required_ids:
        assert f'id="{element_id}"' in content, f'Missing ID in mobile.html: {element_id}'

    # Ensure removed items are not present
    assert 'Hoặc chạm vào đây để duyệt file ảnh' not in content
    assert 'Camera dùng thiết lập hiện tại tại trang' not in content
    assert 'btn-retake' not in content
    assert 'notify-view-btn' not in content
    assert 'Chuyển sang giao diện máy tính' not in content

    # Check disclaimer parity
    assert 'Thông tin mang tính tham khảo' in content
