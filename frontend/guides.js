// Shared by desktop and mobile. Source Markdown is always escaped before formatting.
window.PlantGuides = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function inline(text) {
    return escape(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  // Support the headings, paragraphs, bullet lists and emphasis used by our guides.
  // HTML and other Markdown constructs remain plain text, never executable markup.
  function markdown(text) {
    return text.trim().split(/\r?\n\s*\r?\n/).map(block => {
      const lines = block.split(/\r?\n/);
      const renderLine = line => {
        if (/^### /.test(line)) return `<h4>${inline(line.slice(4))}</h4>`;
        if (/^\*\*[^*]+\*\*$/.test(line)) return `<h5>${inline(line.slice(2, -2))}</h5>`;
        return `<p>${inline(line)}</p>`;
      };
      let html = '', inList = false;
      for (const line of lines) {
        if (/^\* /.test(line)) {
          if (!inList) html += '<ul>';
          inList = true;
          html += `<li>${inline(line.slice(2))}</li>`;
        } else {
          if (inList) html += '</ul>';
          inList = false;
          html += renderLine(line);
        }
      }
      return html + (inList ? '</ul>' : '');
    }).join('');
  }

  function render(info) {
    const content = (key, empty) => typeof info[key] === 'string' && info[key].trim()
      ? markdown(info[key]) : `<p class="guide-empty">${empty}</p>`;
    return `<div class="plant-guides">
      <div class="guide-options" role="group" aria-label="Chọn nội dung hướng dẫn">
        <button type="button" data-guide="usage" aria-controls="guide-usage" aria-pressed="false">Hướng dẫn sử dụng</button>
        <button type="button" data-guide="cultivation" aria-controls="guide-cultivation" aria-pressed="false">Hướng dẫn canh tác</button>
      </div>
      <div id="guide-usage" class="guide-content" role="region" aria-label="Hướng dẫn sử dụng" hidden>
        <p class="guide-source">Nội dung từ tài liệu tổng hợp do người dùng cung cấp, mang tính tham khảo.</p>
        ${content('usage_guide', 'Chưa có hướng dẫn sử dụng cho loài này.')}
      </div>
      <div id="guide-cultivation" class="guide-content" role="region" aria-label="Hướng dẫn canh tác" hidden>
        ${content('cultivation_guide', 'Hướng dẫn canh tác cho loài này chưa được bổ sung.')}
      </div>
    </div>`;
  }

  // Delegate events so replacing a prediction also replaces all guide content/state.
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-guide]');
    if (!button) return;
    const container = button.closest('.plant-guides');
    if (!container) return;
    container.querySelectorAll('button[data-guide]').forEach(option => {
      option.setAttribute('aria-pressed', String(option === button));
    });
    container.querySelectorAll('.guide-content').forEach(panel => {
      panel.hidden = panel.id !== button.getAttribute('aria-controls');
    });
  });

  return { render };
})();
