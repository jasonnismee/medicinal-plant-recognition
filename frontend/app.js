const $ = id => document.getElementById(id);
let selected = null;
let previewUrl = null;
let sourceMode = "phone";
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function selectFile(file) {
  if (!file || !file.type.startsWith('image/')) { $('status').textContent = 'Vui lòng chọn tệp ảnh.'; return; }
  selected = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  $('preview').src = previewUrl;
  $('preview').hidden = false;
  $('submit').disabled = false;
  $('status').textContent = 'Đã chọn ảnh. Bấm Nhận diện để bắt đầu.';
  $('result').textContent = 'Chưa có kết quả.';
}
function setSource(mode) {
  sourceMode = mode;
  $('drop').hidden = mode !== 'phone';
  $('esp32-tools').hidden = mode !== 'esp32';
  $('mode-phone').classList.toggle('source-active', mode === 'phone');
  $('mode-esp32').classList.toggle('source-active', mode === 'esp32');
  $('mode-phone').setAttribute('aria-pressed', String(mode === 'phone'));
  $('mode-esp32').setAttribute('aria-pressed', String(mode === 'esp32'));
  selected = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $('preview').src = '';
  $('preview').hidden = true;
  $('submit').disabled = true;
  $('status').textContent = mode === 'esp32' ? 'Nhấn Chụp ảnh bằng ESP32-CAM.' : 'Chọn ảnh từ thiết bị của bạn.';
  $('result').textContent = 'Chưa có kết quả.';
}
$('mode-phone').addEventListener('click', () => setSource('phone'));
$('mode-esp32').addEventListener('click', () => setSource('esp32'));
$('capture-esp32').addEventListener('click', async () => {
  const btn = $('capture-esp32');
  btn.disabled = true;
  $('submit').disabled = true;
  selected = null;
  $('preview').hidden = true;
  $('result').textContent = 'Chưa có kết quả.';
  $('status').textContent = 'Đang chụp ảnh từ ESP32-CAM...';
  try {
    const response = await fetch('/api/esp32/capture', {cache:'no-store'});
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.detail || 'Không lấy được ảnh từ ESP32-CAM.');
    }
    const blob = await response.blob();
    const file = new File([blob], 'esp32-capture.jpg', {type:'image/jpeg'});
    if (sourceMode === 'esp32') selectFile(file);
  } catch (error) {
    $('status').textContent = error.message;
  } finally { btn.disabled = false; }
});
$('file').addEventListener('change', e => selectFile(e.target.files?.[0]));
$('drop').addEventListener('dragover', e => e.preventDefault());
$('drop').addEventListener('drop', e => {e.preventDefault(); selectFile(e.dataTransfer.files?.[0]);});
$('submit').addEventListener('click', async () => {
  if (!selected) return;
  $('submit').disabled = true;
  $('status').textContent = 'Đang nhận diện... Lần đầu khởi động model có thể mất vài phút trên máy 8 GB RAM.';
  const form = new FormData(); form.append('file', selected);
  try {
    const response = await fetch('/api/predict', {method:'POST', body:form, headers:{'X-Source': sourceMode === 'esp32' ? 'esp32' : 'web'}});
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Không thể nhận diện ảnh.');
    let html = '';
    if (data.status === 'recognized') {
      html += `<h3 class="winner">${safe(data.predicted_class)}</h3>`;
      html += `<p class="scientific"><em>${safe(data.scientific_name)}</em></p>`;
      const info = data.medicinal_info || {};
      if (info.description) html += `<p>${safe(info.description)}</p>`;
      if (info.parts_used) html += `<p><strong>Bộ phận thường được sử dụng:</strong> ${safe(info.parts_used)}</p>`;
      if (info.traditional_use) html += `<p><strong>Ứng dụng theo kinh nghiệm dân gian:</strong> ${safe(info.traditional_use)}</p>`;
      if (!Object.keys(info).length) html += '<p>Chưa có thông tin dược liệu được biên tập cho loài này.</p>';
    } else if (data.status === 'uncertain') {
      html = '<h3 class="winner">Chưa chắc chắn</h3><p>Ảnh có thể giống nhiều loài. Vui lòng chụp rõ hơn hoặc thay góc chụp.</p>';
    } else {
      html = '<h3 class="winner">Không xác định</h3><p>Chưa nhận diện được cây trong danh sách hỗ trợ.</p>';
    }
    $('result').innerHTML = html;
    $('status').textContent = 'Hoàn tất';
  } catch (err) { $('status').textContent = err.message; $('result').textContent = 'Không thể xử lý ảnh.'; }
  finally { $('submit').disabled = false; }
});
