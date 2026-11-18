// Standalone farming viewer shared by desktop and mobile.
window.PlantFarming = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function inline(text) {
    // Only these Markdown tokens become HTML; source HTML always stays text.
    const tokens = /\[([^\]]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))*)\)|\*\*(.+?)\*\*|\*([^*]+)\*/g;
    let html = '', start = 0;
    for (const match of text.matchAll(tokens)) {
      html += escape(text.slice(start, match.index));
      if (match[1] !== undefined) {
        html += `<a href="${escape(match[2])}" target="_blank" rel="noopener noreferrer">${inline(match[1])}</a>`;
      } else if (match[3] !== undefined) {
        html += `<strong>${inline(match[3])}</strong>`;
      } else {
        html += `<em>${escape(match[4])}</em>`;
      }
      start = match.index + match[0].length;
    }
    return html + escape(text.slice(start));
  }

  function markdown(text) {
    let html = '', list = '', paragraph = [];
    const flushParagraph = () => {
      if (paragraph.length) html += `<p>${paragraph.map(line => inline(line.trim())).join('<br>')}</p>`;
      paragraph = [];
    };
    const closeList = () => { if (list) html += `</${list}>`; list = ''; };
    for (const line of text.split(/\r?\n/)) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      const item = /^\s*(?:([-*]) |(\d+)\. )(.+)$/.exec(line);
      if (heading) {
        flushParagraph(); closeList();
        const level = Math.min(heading[1].length + 2, 6);
        // Keep subsection numbers, remove only the ordinal before a plant name.
        const title = heading[1].length === 1 ? heading[2].replace(/^\d+\.\s+/, '') : heading[2];
        html += `<h${level}>${inline(title)}</h${level}>`;
      } else if (item) {
        flushParagraph();
        const type = item[1] ? 'ul' : 'ol';
        if (list !== type) { closeList(); html += `<${type}>`; list = type; }
        html += `<li>${inline(item[3])}</li>`;
      } else if (!line.trim()) {
        flushParagraph();
      } else if (/^---\s*$/.test(line)) {
        flushParagraph(); closeList(); html += '<hr>';
      } else {
        closeList(); paragraph.push(line);
      }
    }
    flushParagraph(); closeList();
    return html;
  }

  function render(info) {
    const guide = typeof info.cultivation_guide === 'string' && info.cultivation_guide.trim()
      ? markdown(info.cultivation_guide) : '<p>Hướng dẫn canh tác cho loài này chưa được bổ sung.</p>';
    const context = typeof info.cultivation_context === 'string' && info.cultivation_context.trim()
      ? `<details class="farming-context"><summary>Phạm vi và nguyên tắc chung</summary>${markdown(info.cultivation_context)}</details>` : '';
    return `<div class="plant-farming">
      <button type="button" class="farming-open" aria-haspopup="dialog" aria-controls="farming-dialog">Xem hướng dẫn canh tác</button>
      <dialog id="farming-dialog" class="farming-dialog" aria-labelledby="farming-title">
        <div class="farming-header">
          <h2 id="farming-title">Hướng dẫn canh tác</h2>
          <button type="button" class="farming-close" aria-label="Đóng hướng dẫn canh tác">Đóng ×</button>
        </div>
        <div class="farming-body" tabindex="0">${context}<div class="farming-document">${guide}</div></div>
      </dialog>
    </div>`;
  }

  document.addEventListener('click', event => {
    const open = event.target.closest('.farming-open');
    if (open) {
      const dialog = open.closest('.plant-farming').querySelector('dialog');
      dialog.showModal();
      document.body.classList.add('farming-modal-open');
      dialog.querySelector('.farming-body').scrollTop = 0;
      dialog.querySelector('.farming-close').focus();
      dialog.addEventListener('close', () => {
        document.body.classList.remove('farming-modal-open');
        if (open.isConnected) open.focus();
      }, { once: true });
    }
    const close = event.target.closest('.farming-close');
    if (close) close.closest('dialog').close();
    // Native dialogs handle Escape; also allow backdrop dismissal.
    if (event.target.matches('dialog.farming-dialog')) {
      const rect = event.target.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        event.target.close();
      }
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const dialog = event.target.closest('dialog.farming-dialog[open]');
    if (!dialog) return;
    const controls = [...dialog.querySelectorAll('button, a[href], summary, [tabindex="0"]')]
      .filter(control => !control.disabled && control.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });

  return { render };
})();
