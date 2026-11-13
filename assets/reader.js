/* =========================================================
   材料阅读器
   - PDF：交给浏览器原生阅读器（iframe + blob URL），保留翻页与缩放
   - 图片：直接铺满
   - txt / md：正文排版 + 自动分页
   - PPT / Word / Excel：用抽出的文字排版成分页预览，同时保留原文件下载
   ========================================================= */
(function (global) {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  var st = {
    on: false,
    matId: '',
    name: '',
    kind: '',
    reader: '',
    page: 0,
    total: 0,
    zoom: 1,
    onRead: null,
    mounted: false
  };

  /* ---------- 构建骨架（只建一次） ---------- */
  function ensure() {
    if (st.mounted) return;
    var el = document.createElement('div');
    el.className = 'reader';
    el.id = 'reader';
    el.innerHTML =
      '<div class="rd-bar">' +
        '<div class="rd-file">' +
          '<span class="rd-badge" id="rdBadge">PDF</span>' +
          '<div class="rd-info">' +
            '<div class="rd-name" id="rdName">—</div>' +
            '<div class="rd-meta" id="rdMeta">—</div>' +
          '</div>' +
        '</div>' +
        '<div class="rd-tools">' +
          '<div class="rd-pager" id="rdPager">' +
            '<button class="rd-btn" data-rd="prev" title="上一页">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>' +
            '</button>' +
            '<span class="rd-pnum" id="rdPnum">1 / 1</span>' +
            '<button class="rd-btn" data-rd="next" title="下一页">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
            '</button>' +
          '</div>' +
          '<button class="rd-btn wide" data-rd="download">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>' +
            '下载原文件' +
          '</button>' +
          '<button class="rd-btn close" data-rd="close" title="关闭">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="rd-body" id="rdBody"></div>' +
      '<div class="rd-foot"><div class="rd-prog"><i id="rdProg"></i></div><span id="rdProgText">—</span></div>';

    document.body.appendChild(el);
    st.mounted = true;

    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rd]');
      if (!b) {
        // 点空白不关闭，避免误触
        return;
      }
      var act = b.dataset.rd;
      if (act === 'close') close();
      else if (act === 'prev') go(st.page - 1);
      else if (act === 'next') go(st.page + 1);
      else if (act === 'download') {
        if (st.hasFile) global.Files.download(st.matId);
        else toast('这是示例材料，没有实际文件');
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!st.on) return;
      if (e.key === 'Escape') { close(); return; }
      if (st.reader === 'office' || st.reader === 'text') {
        if (e.key === 'ArrowLeft') go(st.page - 1);
        if (e.key === 'ArrowRight') go(st.page + 1);
      }
    });
  }

  function toast(msg) {
    var w = document.getElementById('toastWrap');
    if (!w) return;
    var d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    w.appendChild(d);
    setTimeout(function () { d.remove(); }, 2400);
  }

  /* ---------- 分页 ---------- */
  function paginate(text, perPage) {
    var t = String(text || '').replace(/\r\n?/g, '\n');
    if (!t.trim()) return [];
    // PPT 抽出时带【第 N 页】标记，优先按标记切
    if (/【第 \d+ 页】/.test(t)) {
      var parts = t.split(/【第 \d+ 页】/).map(function (s) { return s.trim(); }).filter(Boolean);
      return parts;
    }
    if (/【工作表 \d+】/.test(t)) {
      var sh = t.split(/【工作表 \d+】/).map(function (s) { return s.trim(); }).filter(Boolean);
      return sh;
    }
    var limit = perPage || 1800;
    var lines = t.split('\n');
    var pages = [];
    var buf = '';
    lines.forEach(function (ln) {
      if ((buf + ln).length > limit) {
        if (buf.trim()) pages.push(buf.trim());
        buf = ln;
      } else {
        buf += (buf ? '\n' : '') + ln;
      }
      // 单行超长时硬切
      while (buf.length > limit * 1.8) {
        pages.push(buf.slice(0, limit));
        buf = buf.slice(limit);
      }
    });
    if (buf.trim()) pages.push(buf.trim());
    return pages.length ? pages : [t];
  }

  function paraHtml(text) {
    var blocks = String(text || '').split(/\n{2,}/);
    if (blocks.length === 1) {
      // 没有空行分隔，按单换行切段
      blocks = String(text || '').split('\n');
    }
    return blocks.map(function (b) {
      var s = b.trim();
      if (!s) return '';
      if (/^[-•·*]\s/.test(s)) {
        return '<div class="rd-li">' + esc(s.replace(/^[-•·*]\s*/, '')) + '</div>';
      }
      if (/^\d+[.、)]\s?/.test(s)) {
        return '<div class="rd-li num">' + esc(s) + '</div>';
      }
      return '<p class="rd-p">' + esc(s).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  /* ---------- 渲染 ---------- */
  function renderBody() {
    var body = document.getElementById('rdBody');
    if (!body) return;

    if (st.reader === 'pdf') {
      body.className = 'rd-body is-pdf';
      body.innerHTML = '<iframe class="rd-frame" id="rdFrame" src="' + st.src + '#toolbar=1&navpanes=0&view=FitH"></iframe>';
      return;
    }

    if (st.reader === 'image') {
      body.className = 'rd-body is-image';
      body.innerHTML = '<img class="rd-img" src="' + st.src + '" alt="' + esc(st.name) + '">';
      return;
    }

    if (st.reader === 'video') {
      body.className = 'rd-body is-video';
      body.innerHTML = '<video class="rd-video" src="' + st.src + '" controls playsinline preload="metadata"></video>' +
        '<div class="rd-video-note">看完这一节才能进入下一个材料。' +
        (st.external ? '（外链视频，若无法播放请检查链接是否需要登录）' : '') + '</div>';
      return;
    }

    if (st.reader === 'text' || st.reader === 'office') {
      body.className = 'rd-body is-page';
      if (!st.pages.length) {
        body.innerHTML = '<div class="rd-empty">' +
          '<div class="rd-empty-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg></div>' +
          '<div class="rd-empty-t">这份文件没法直接在线预览</div>' +
          '<div class="rd-empty-d">' + (st.hasFile
            ? '老版 Office 格式（.doc / .ppt / .xls）浏览器读不了文字，请下载原文件查看，或另存为 PDF / docx / pptx 后重新上传。'
            : '这是示例材料，没有关联文件。') + '</div>' +
          (st.hasFile ? '<button class="btn btn-primary btn-sm" style="margin-top:14px" data-rd="download">下载原文件</button>' : '') +
          '</div>';
        return;
      }
      var pg = st.pages[st.page] || '';
      body.innerHTML = '<div class="rd-sheet">' +
        (st.reader === 'office' ? '<div class="rd-sheet-tag">第 ' + (st.page + 1) + ' / ' + st.pages.length + ' 页</div>' : '') +
        paraHtml(pg) +
      '</div>';
      body.scrollTop = 0;
      return;
    }

    body.className = 'rd-body';
    body.innerHTML = '<div class="rd-empty">' +
      '<div class="rd-empty-t">暂不支持预览这类文件</div>' +
      '<div class="rd-empty-d">可以下载后用本地软件打开。</div></div>';
  }

  function syncUI() {
    var info = global.Files.infoOf(st.name);
    var badge = document.getElementById('rdBadge');
    var nameEl = document.getElementById('rdName');
    var metaEl = document.getElementById('rdMeta');
    var pager = document.getElementById('rdPager');
    var pnum = document.getElementById('rdPnum');
    var prog = document.getElementById('rdProg');
    var progText = document.getElementById('rdProgText');

    if (badge) badge.textContent = info.label;
    if (badge) badge.className = 'rd-badge ' + info.cls;
    if (nameEl) nameEl.textContent = st.name;
    if (metaEl) metaEl.textContent = (st.sizeText || '') + (st.total > 1 ? ' · 共 ' + st.total + ' 页' : '');

    var paged = st.reader === 'text' || st.reader === 'office';
    if (pager) pager.style.display = paged && st.total > 1 ? '' : 'none';
    if (pnum) pnum.textContent = (st.page + 1) + ' / ' + Math.max(1, st.total);

    var pct = st.total > 1 ? Math.round((st.page + 1) / st.total * 100) : 100;
    if (prog) prog.style.width = pct + '%';
    if (progText) progText.textContent = paged && st.total > 1
      ? '阅读进度 ' + pct + '%（第 ' + (st.page + 1) + ' 页）'
      : (st.reader === 'pdf' ? 'PDF 在下方直接阅读，可翻页或缩放' : '已打开');
  }

  function go(p) {
    if (st.reader === 'pdf') {
      // PDF 交给原生阅读器，用 fragment 翻页
      var f = document.getElementById('rdFrame');
      if (f && st.total > 1) {
        var np = Math.min(Math.max(1, p + 1), st.total);
        st.page = np - 1;
        f.src = st.src + '#page=' + np + '&toolbar=1&navpanes=0';
        syncUI();
        fireRead();
      }
      return;
    }
    if (p < 0 || p >= st.total) return;
    st.page = p;
    renderBody();
    syncUI();
    fireRead();
  }

  function fireRead() {
    if (typeof st.onRead === 'function') {
      st.onRead({ matId: st.matId, page: st.page + 1, total: st.total });
    }
  }

  /* ---------- 打开 / 关闭 ---------- */
  function open(mat, opts) {
    opts = opts || {};
    ensure();

    var el = document.getElementById('reader');
    st.matId = mat.id;
    st.name = mat.name || '未命名';
    st.reader = (global.Files.infoOf(st.name)).reader;
    st.sizeText = mat.size || '';
    st.hasFile = mat.hasFile !== false;
    st.external = false;
    st.page = 0;
    st.total = 1;
    st.pages = [];
    st.src = '';
    st.onRead = opts.onRead || null;

    var el2 = el;
    el2.classList.add('is-on');
    st.on = true;

    // 显示 loading
    var body = document.getElementById('rdBody');
    body.className = 'rd-body';
    body.innerHTML = '<div class="rd-loading"><span class="spinner"></span>正在打开文件…</div>';
    syncUI();

    /* 外链视频：直接用地址渲染，不查 IndexedDB */
    if (mat.url) {
      st.reader = 'video';
      st.external = true;
      st.src = mat.url;
      st.sizeText = '外链';
      renderBody();
      syncUI();
      fireRead();
      return Promise.resolve();
    }

    if (!st.hasFile) {
      // 示例材料：有 preview 正文就按文本渲染，否则给占位说明
      var demo = mat.preview || ('【示例材料】' + st.name + '\n\n' +
        '这是演示用的材料条目，没有关联真实文件。\n' +
        '在「培训材料」里上传自己的 PDF 或 PPT，员工就能在这里在线阅读。');
      st.reader = 'text';
      st.pages = paginate(demo, 1600);
      st.total = st.pages.length || 1;
      renderBody();
      syncUI();
      fireRead();
      return Promise.resolve();
    }

    return global.Files.get(mat.id).then(function (rec) {
      if (!rec) {
        // 读不到文件时，有示例正文就降级显示，没有才报丢失
        if (mat.preview) {
          st.reader = 'text';
          st.pages = paginate(mat.preview, 1600);
          st.total = st.pages.length || 1;
          renderBody();
          syncUI();
          fireRead();
          return;
        }
        body.className = 'rd-body';
        body.innerHTML = '<div class="rd-empty"><div class="rd-empty-t">文件已丢失</div>' +
          '<div class="rd-empty-d">可能被浏览器清理过，请重新上传。</div></div>';
        return;
      }

      st.sizeText = global.Files.fmtSize(rec.size) || st.sizeText;

      if (st.reader === 'pdf' || st.reader === 'image') {
        return global.Files.url(mat.id).then(function (u) {
          if (!u) {
            body.innerHTML = '<div class="rd-empty"><div class="rd-empty-t">无法读取文件</div></div>';
            return;
          }
          st.src = u;
          st.total = st.reader === 'pdf' ? (rec.pageCount || 1) : 1;
          renderBody();
          syncUI();
          fireRead();
        });
      }

      // 文本类
      var txt = rec.text || '';
      if (!txt && st.reader === 'text') {
        st.reader = 'none';
        renderBody();
        syncUI();
        return;
      }
      st.pages = paginate(txt, 1600);
      st.total = st.pages.length || 1;
      if (!st.pages.length) st.reader = 'none';
      renderBody();
      syncUI();
      fireRead();
    })['catch'](function (err) {
      body.innerHTML = '<div class="rd-empty"><div class="rd-empty-t">打开失败</div>' +
        '<div class="rd-empty-d">' + esc(err && err.message || '未知错误') + '</div></div>';
    });
  }

  function close() {
    var el = document.getElementById('reader');
    if (el) el.classList.remove('is-on');
    st.on = false;
    st.onRead = null;
    var body = document.getElementById('rdBody');
    if (body) body.innerHTML = '';
  }

  global.Reader = {
    open: open,
    close: close,
    isOpen: function () { return st.on; }
  };
})(window);
