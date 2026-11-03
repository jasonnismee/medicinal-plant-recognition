const $ = id => document.getElementById(id);
let selected = null;
let previewUrl = null;
let sourceMode = "phone";

const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

function hideBottomNotification() {
  const notify = $('bottom-notification');
  if (notify) {
    notify.classList.remove('show');
    notify.hidden = true;
  }
}

function showBottomNotification({ status, badge, title, subtitle, icon }) {
  const notify = $('bottom-notification');
  if (!notify) return;

  notify.className = `bottom-notification status-${status}`;
  $('notify-icon').textContent = icon || (status === 'success' ? '✅' : status === 'warning' ? '⚠️' : status === 'error' ? '❌' : '❓');
  $('notify-badge').textContent = badge;
  $('notify-title').textContent = title;
  $('notify-subtitle').textContent = subtitle;

  notify.hidden = false;
  requestAnimationFrame(() => {
    notify.classList.add('show');
  });
}

function scrollToResult() {
  const resultCard = $('result-section');
  if (resultCard) {
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    resultCard.classList.remove('highlight-pulse');
    void resultCard.offsetWidth; // Force reflow
    resultCard.classList.add('highlight-pulse');
  }
}

function selectFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    $('status').textContent = 'Vui lòng chọn tệp ảnh hợp lệ.';
    return;
  }
  selected = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);

  const preview = $('preview');
  preview.src = previewUrl;
  $('preview-container').hidden = false;
  $('submit').disabled = false;
  $('status').textContent = 'Đã chọn ảnh. Bấm Nhận diện để bắt đầu.';
  $('result').innerHTML = '<div class="placeholder">Chưa có kết quả.</div>';
  hideBottomNotification();
}

function setSource(mode) {
  sourceMode = mode;
  $('phone-tools').hidden = mode !== 'phone';
  $('esp32-tools').hidden = mode !== 'esp32';
  $('mode-phone').classList.toggle('source-active', mode === 'phone');
  $('mode-esp32').classList.toggle('source-active', mode === 'esp32');
  $('mode-phone').setAttribute('aria-pressed', String(mode === 'phone'));
  $('mode-esp32').setAttribute('aria-pressed', String(mode === 'esp32'));

  selected = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;

  $('preview').src = '';
  $('preview-container').hidden = true;
  $('submit').disabled = true;
  $('status').textContent = mode === 'esp32' ? 'Nhấn Chụp ảnh bằng ESP32-CAM.' : 'Chọn ảnh từ thiết bị của bạn.';
  $('result').innerHTML = '<div class="placeholder">Chưa có kết quả.</div>';
  hideBottomNotification();
}

// Mode toggle listeners
$('mode-phone').addEventListener('click', () => setSource('phone'));
$('mode-esp32').addEventListener('click', () => setSource('esp32'));

// Mobile quick action triggers
$('btn-camera')?.addEventListener('click', () => {
  const input = $('file-camera');
  if (input) { input.value = ''; input.click(); }
});
$('btn-gallery')?.addEventListener('click', () => {
  const input = $('file-gallery');
  if (input) { input.value = ''; input.click(); }
});
$('file-camera')?.addEventListener('change', e => selectFile(e.target.files?.[0]));
$('file-gallery')?.addEventListener('change', e => selectFile(e.target.files?.[0]));

// ESP32 Capture
$('capture-esp32').addEventListener('click', async () => {
  const btn = $('capture-esp32');
  btn.disabled = true;
  $('submit').disabled = true;
  selected = null;
  $('preview-container').hidden = true;
  $('result').innerHTML = '<div class="placeholder">Chưa có kết quả.</div>';
  $('status').textContent = 'Đang chụp ảnh từ ESP32-CAM...';
  hideBottomNotification();

  try {
    const response = await fetch('/api/esp32/capture', { cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.detail || 'Không lấy được ảnh từ ESP32-CAM.');
    }
    const blob = await response.blob();
    const file = new File([blob], 'esp32-capture.jpg', { type: 'image/jpeg' });
    if (sourceMode === 'esp32') selectFile(file);
  } catch (error) {
    $('status').textContent = error.message;
    showBottomNotification({
      status: 'error',
      badge: 'Lỗi chụp ESP32',
      title: 'Không thể chụp ảnh',
      subtitle: error.message,
      icon: '❌'
    });
  } finally {
    btn.disabled = false;
  }
});

// Bottom notification listeners
$('notify-title')?.parentElement?.addEventListener('click', scrollToResult);
$('notify-close')?.addEventListener('click', hideBottomNotification);

// Submit prediction
$('submit').addEventListener('click', async () => {
  if (!selected) return;

  const submitBtn = $('submit');
  const spinner = $('spinner');
  submitBtn.disabled = true;
  if (spinner) spinner.hidden = false;
  $('status').textContent = 'Đang nhận diện... Lần đầu khởi động model có thể mất vài phút trên máy 8 GB RAM.';
  hideBottomNotification();

  const form = new FormData();
  form.append('file', selected);

  try {
    const response = await fetch('/api/predict', {
      method: 'POST',
      body: form,
      headers: { 'X-Source': 'web' }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Không thể nhận diện ảnh.');

    let html = '';
    if (data.status === 'recognized') {
      html += `
        <div class="result-card-content">
          <div class="result-alert-box success">
            <span>🌿</span>
            <span>Nhận diện thành công</span>
          </div>
          <h3 class="winner">${safe(data.predicted_class)}</h3>
          <p class="scientific"><em>${safe(data.scientific_name)}</em></p>
          <div class="info-cards">
      `;
      const info = data.medicinal_info || {};
      if (info.description) {
        html += `
          <div class="info-item">
            <div class="info-item-label">📖 Mô tả</div>
            <p class="info-item-content">${safe(info.description)}</p>
          </div>
        `;
      }
      if (info.parts_used) {
        html += `
          <div class="info-item">
            <div class="info-item-label">🌿 Bộ phận thường dùng</div>
            <p class="info-item-content"><strong>Bộ phận thường được sử dụng:</strong> ${safe(info.parts_used)}</p>
          </div>
        `;
      }
      if (info.traditional_use) {
        html += `
          <div class="info-item">
            <div class="info-item-label">💊 Kinh nghiệm dân gian</div>
            <p class="info-item-content"><strong>Ứng dụng theo kinh nghiệm dân gian:</strong> ${safe(info.traditional_use)}</p>
          </div>
        `;
      }
      if (!Object.keys(info).length) {
        html += '<p class="muted">Chưa có thông tin dược liệu được biên tập cho loài này.</p>';
      }
      html += '</div></div>';

      // Pinned bottom success notification
      showBottomNotification({
        status: 'success',
        badge: 'Nhận diện thành công!',
        title: safe(data.predicted_class),
        subtitle: safe(data.scientific_name),
        icon: '✅'
      });

      // Haptic feedback
      if (navigator.vibrate) {
        try { navigator.vibrate([40, 60, 40]); } catch (e) {}
      }

      // Tự động lướt xuống kết quả chi tiết
      setTimeout(scrollToResult, 250);

    } else if (data.status === 'uncertain') {
      html = `
        <div class="result-card-content">
          <div class="result-alert-box warning">
            <span>⚠️</span>
            <span>Kết quả chưa chắc chắn</span>
          </div>
          <h3 class="winner">Chưa chắc chắn</h3>
          <p>Ảnh có thể giống nhiều loài. Vui lòng chụp rõ hơn hoặc thay góc chụp.</p>
        </div>
      `;
      showBottomNotification({
        status: 'warning',
        badge: 'Chưa chắc chắn kết quả',
        title: 'Chưa rõ loài cây',
        subtitle: 'Vui lòng chụp rõ hơn hoặc đổi góc',
        icon: '⚠️'
      });
      setTimeout(scrollToResult, 250);

    } else {
      html = `
        <div class="result-card-content">
          <div class="result-alert-box unknown">
            <span>❓</span>
            <span>Không xác định</span>
          </div>
          <h3 class="winner">Không xác định</h3>
          <p>Chưa nhận diện được cây trong danh sách hỗ trợ.</p>
        </div>
      `;
      showBottomNotification({
        status: 'unknown',
        badge: 'Không xác định',
        title: 'Chưa nhận diện được',
        subtitle: 'Cây ngoài danh mục 20 loài hỗ trợ',
        icon: '❓'
      });
      setTimeout(scrollToResult, 250);
    }

    $('result').innerHTML = html;
    $('status').textContent = 'Hoàn tất';
  } catch (err) {
    $('status').textContent = err.message;
    $('result').innerHTML = '<div class="placeholder">Không thể xử lý ảnh.</div>';
    showBottomNotification({
      status: 'error',
      badge: 'Lỗi nhận diện',
      title: 'Không thể xử lý ảnh',
      subtitle: err.message,
      icon: '❌'
    });
  } finally {
    submitBtn.disabled = false;
    if (spinner) spinner.hidden = true;
  }
});
