const $ = id => document.getElementById(id);
let selected = null;
let previewUrl = null;
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
$('file').addEventListener('change', e => selectFile(e.target.files?.[0]));
$('drop').addEventListener('dragover', e => e.preventDefault());
$('drop').addEventListener('drop', e => {e.preventDefault(); selectFile(e.dataTransfer.files?.[0]);});
$('submit').addEventListener('click', async () => {
  if (!selected) return;
  $('submit').disabled = true;
  $('status').textContent = 'Đang nhận diện... Lần đầu khởi động model có thể mất vài phút trên máy 8 GB RAM.';
  const form = new FormData(); form.append('file', selected);
  try {
    const response = await fetch('/api/predict', {method:'POST', body:form, headers:{'X-Source':'web'}});
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
