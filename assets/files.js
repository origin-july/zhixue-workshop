/* =========================================================
   文件库
   - 文件本体存 IndexedDB（突破 localStorage 5MB 限制，几十 MB 的 PDF/PPT 也能留）
   - 元信息（名称/大小/类型）随 project.materials 存 localStorage
   - 提供 blob URL 给阅读器，URL 缓存在内存里
   - docx / pptx / xlsx 用 JSZip 解包抽文字，供出题使用
   ========================================================= */
(function (global) {
  'use strict';

  var DB_NAME = 'zx_files_v1';
  var DB_VER = 1;
  var STORE = 'files';

  var dbPromise = null;
  var urlCache = {};       // id -> objectURL
  var memCache = {};       // id -> record（避免反复读库）

  /* ---------- 类型判断 ---------- */
  var KIND_MAP = {
    pdf:  { kind: 'pdf',  label: 'PDF',  cls: 'pdf',   reader: 'pdf' },
    ppt:  { kind: 'ppt',  label: 'PPT',  cls: 'ppt',   reader: 'office' },
    pptx: { kind: 'ppt',  label: 'PPT',  cls: 'ppt',   reader: 'office' },
    doc:  { kind: 'doc',  label: 'DOC',  cls: 'doc',   reader: 'office' },
    docx: { kind: 'doc',  label: 'DOC',  cls: 'doc',   reader: 'office' },
    xls:  { kind: 'xls',  label: 'XLS',  cls: 'xls',   reader: 'office' },
    xlsx: { kind: 'xls',  label: 'XLS',  cls: 'xls',   reader: 'office' },
    csv:  { kind: 'txt',  label: 'CSV',  cls: 'txt',   reader: 'text' },
    txt:  { kind: 'txt',  label: 'TXT',  cls: 'txt',   reader: 'text' },
    md:   { kind: 'txt',  label: 'MD',   cls: 'txt',   reader: 'text' },
    markdown: { kind: 'txt', label: 'MD', cls: 'txt',  reader: 'text' },
    png:  { kind: 'img',  label: 'PNG',  cls: 'img',   reader: 'image' },
    jpg:  { kind: 'img',  label: 'JPG',  cls: 'img',   reader: 'image' },
    jpeg: { kind: 'img',  label: 'JPG',  cls: 'img',   reader: 'image' },
    gif:  { kind: 'img',  label: 'GIF',  cls: 'img',   reader: 'image' },
    webp: { kind: 'img',  label: 'WEBP', cls: 'img',   reader: 'image' },
    bmp:  { kind: 'img',  label: 'BMP',  cls: 'img',   reader: 'image' },
    svg:  { kind: 'img',  label: 'SVG',  cls: 'img',   reader: 'image' },
    mp4:  { kind: 'video', label: 'MP4', cls: 'video', reader: 'video' },
    webm: { kind: 'video', label: 'WEBM', cls: 'video', reader: 'video' },
    mov:  { kind: 'video', label: 'MOV', cls: 'video', reader: 'video' },
    m4v:  { kind: 'video', label: 'M4V', cls: 'video', reader: 'video' },
    ogv:  { kind: 'video', label: 'OGV', cls: 'video', reader: 'video' }
  };

  var ACCEPT = '.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mov,.m4v';

  /** 浏览器能直接播的容器 */
  var PLAYABLE = ['mp4', 'webm', 'm4v', 'ogv'];

  function extOf(name) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function infoOf(name) {
    var e = extOf(name);
    return KIND_MAP[e] || { kind: 'other', label: (e || '文件').toUpperCase().slice(0, 4), cls: 'txt', reader: 'none' };
  }

  function fmtSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /* ---------- IndexedDB ---------- */
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('浏览器不支持 IndexedDB')); return; }
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('打开文件库失败')); };
    });
    return dbPromise;
  }

  function run(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var os = t.objectStore(STORE);
        var out;
        try { out = fn(os); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('事务中断')); };
      });
    });
  }

  /* ---------- 文本解码：兼容 GBK ---------- */
  function decodeBuffer(buf) {
    var txt = '';
    try {
      txt = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    } catch (e) {
      txt = '';
    }
    var bad = (txt.match(/\uFFFD/g) || []).length;
    if (bad > 2) {
      try {
        var gbk = new TextDecoder('gbk').decode(buf);
        if ((gbk.match(/\uFFFD/g) || []).length < bad) return gbk;
      } catch (e2) { /* 有些浏览器不支持 gbk */ }
    }
    return txt;
  }

  function readAsText(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { resolve(decodeBuffer(fr.result)); };
      fr.onerror = function () { resolve(''); };
      try { fr.readAsArrayBuffer(file); } catch (e) { resolve(''); }
    });
  }

  /* ---------- XML → 纯文本 ---------- */
  function unescapeXml(s) {
    return String(s || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
      .replace(/&amp;/g, '&');
  }

  function xmlToText(xml) {
    var s = String(xml || '');
    if (!s) return '';
    // 段落 / 换行 / 制表 转成可读分隔
    s = s.replace(/<w:tab\s*\/>|<a:tab\s*\/>/g, '\t');
    s = s.replace(/<w:br\s*\/?>|<a:br\s*\/?>|<w:cr\s*\/?>/g, '\n');
    s = s.replace(/<\/w:p>|<\/a:p>|<\/w:tr>/g, '\n');
    // 单元格之间用制表符分开（xlsx）
    s = s.replace(/<\/w:tc>/g, '\t').replace(/<\/c>/g, '\t');
    // 去掉剩余标签
    s = s.replace(/<[^>]*>/g, '');
    s = unescapeXml(s);
    s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return s.trim();
  }

  function slideNo(path) {
    var m = String(path).match(/(\d+)\.xml$/);
    return m ? Number(m[1]) : 0;
  }

  function extractOffice(file, ext) {
    if (!global.JSZip) return Promise.resolve({ text: '', pages: 0 });
    return JSZip.loadAsync(file).then(function (zip) {
      if (ext === 'docx') {
        var docFile = zip.file('word/document.xml');
        if (!docFile) return { text: '', pages: 0 };
        return docFile.async('string').then(function (xml) {
          return { text: xmlToText(xml), pages: 0 };
        });
      }

      if (ext === 'pptx') {
        var slides = Object.keys(zip.files)
          .filter(function (p) { return /^ppt\/slides\/slide\d+\.xml$/.test(p); })
          .sort(function (a, b) { return slideNo(a) - slideNo(b); });
        return Promise.all(slides.map(function (p) {
          return zip.file(p).async('string').then(function (xml) {
            return '【第 ' + slideNo(p) + ' 页】\n' + xmlToText(xml);
          });
        })).then(function (arr) {
          return { text: arr.join('\n\n'), pages: arr.length };
        });
      }

      if (ext === 'xlsx') {
        var tasks = [];
        var shared = zip.file('xl/sharedStrings.xml');
        var sharedP = shared ? shared.async('string').then(function (xml) {
          // <si> 是一组，按顺序取
          var items = [];
          var re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
          var m;
          while ((m = re.exec(xml)) !== null) items.push(xmlToText(m[1]));
          return items;
        }) : Promise.resolve([]);

        var sheets = Object.keys(zip.files)
          .filter(function (p) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(p); })
          .sort(function (a, b) { return slideNo(a) - slideNo(b); });

        return sharedP.then(function (sharedList) {
          return Promise.all(sheets.map(function (p) {
            return zip.file(p).async('string').then(function (xml) {
              var lines = [];
              var rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
              var rm;
              while ((rm = rowRe.exec(xml)) !== null) {
                var cells = [];
                var cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
                var cm;
                while ((cm = cellRe.exec(rm[1])) !== null) {
                  var attrs = cm[1];
                  var body = cm[2];
                  var vM = body.match(/<v>([\s\S]*?)<\/v>/);
                  var tM = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
                  var val = '';
                  if (/t="s"/.test(attrs) && vM) {
                    val = sharedList[Number(vM[1])] || '';
                  } else if (tM) {
                    val = unescapeXml(tM[1]);
                  } else if (vM) {
                    val = unescapeXml(vM[1]);
                  }
                  cells.push(val.trim());
                }
                if (cells.join('').trim()) lines.push(cells.join('\t'));
              }
              return '【工作表 ' + slideNo(p) + '】\n' + lines.join('\n');
            });
          })).then(function (arr) {
            return { text: arr.join('\n\n'), pages: arr.length };
          });
        });
      }

      return { text: '', pages: 0 };
    })['catch'](function () {
      return { text: '', pages: 0 };
    });
  }

  /** 从文件抽可出题的文字，返回 { text, pages } */
  function extractText(file) {
    var ext = extOf(file.name);
    var kind = infoOf(file.name);

    if (kind.reader === 'text') {
      return readAsText(file).then(function (t) {
        return { text: t, pages: 0 };
      });
    }
    if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') {
      return extractOffice(file, ext);
    }
    // 老版 doc/ppt/xls 与 pdf 不抽文字
    return Promise.resolve({ text: '', pages: 0 });
  }

  /* ---------- 对外 API ---------- */
  function put(id, file, extra) {
    extra = extra || {};
    return extractText(file).then(function (extracted) {
      var rec = {
        id: id,
        name: file.name || (extra.name || '未命名'),
        size: file.size || 0,
        mime: file.type || '',
        ext: extOf(file.name),
        kind: infoOf(file.name).kind,
        blob: file,
        text: extracted.text || '',
        pages: extracted.pages || 0,
        addedAt: Date.now()
      };
      return run('readwrite', function (os) { os.put(rec); }).then(function () {
        memCache[id] = rec;
        return { text: rec.text, pages: rec.pages, chars: rec.text.length };
      });
    });
  }

  function get(id) {
    if (memCache[id]) return Promise.resolve(memCache[id]);
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction(STORE, 'readonly');
        var req = t.objectStore(STORE).get(id);
        req.onsuccess = function () {
          var rec = req.result || null;
          if (rec) memCache[id] = rec;
          resolve(rec);
        };
        req.onerror = function () { resolve(null); };
      });
    })['catch'](function () { return null; });
  }

  function remove(id) {
    dropUrl(id);
    delete memCache[id];
    return run('readwrite', function (os) { os.delete(id); })['catch'](function () { });
  }

  function has(id) {
    return get(id).then(function (r) { return !!(r && r.blob); });
  }

  /** 拿 blob URL，用于 iframe / img */
  function url(id) {
    if (urlCache[id]) return Promise.resolve(urlCache[id]);
    return get(id).then(function (rec) {
      if (!rec || !rec.blob) return null;
      var u = URL.createObjectURL(rec.blob);
      urlCache[id] = u;
      return u;
    });
  }

  function dropUrl(id) {
    if (urlCache[id]) {
      try { URL.revokeObjectURL(urlCache[id]); } catch (e) { }
      delete urlCache[id];
    }
  }

  /** 取材料文字（出题用） */
  function text(id) {
    return get(id).then(function (rec) { return rec ? (rec.text || '') : ''; });
  }

  /** 下载原文件 */
  function download(id) {
    return get(id).then(function (rec) {
      if (!rec || !rec.blob) return false;
      var u = URL.createObjectURL(rec.blob);
      var a = document.createElement('a');
      a.href = u;
      a.download = rec.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      return true;
    });
  }

  /** 统计占用 */
  function usage() {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var box = { total: 0, count: 0 };
        var t = db.transaction(STORE, 'readonly');
        var req = t.objectStore(STORE).openCursor();
        req.onsuccess = function () {
          var c = req.result;
          if (c) {
            box.count++;
            box.total += (c.value && c.value.size) || 0;
            c['continue']();
          } else {
            resolve(box);
          }
        };
        req.onerror = function () { resolve(box); };
      });
    })['catch'](function () { return { total: 0, count: 0 }; });
  }

  function clearAll() {
    Object.keys(urlCache).forEach(function (k) { dropUrl(k); });
    memCache = {};
    return run('readwrite', function (os) { os.clear(); })['catch'](function () { });
  }

  global.Files = {
    extOf: extOf,
    infoOf: infoOf,
    fmtSize: fmtSize,
    extractText: extractText,
    put: put,
    get: get,
    has: has,
    url: url,
    text: text,
    remove: remove,
    dropUrl: dropUrl,
    download: download,
    usage: usage,
    clearAll: clearAll,
    ACCEPT: ACCEPT
  };
})(window);
