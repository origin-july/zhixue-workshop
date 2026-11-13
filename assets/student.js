/* =========================================================
   学员中心
   三层结构：学习台 → 培训学习页（左侧小节导航）→ 考试 / 成绩
   - 材料内嵌阅读，不再弹全屏遮罩，学习流不断
   - 掌握度由 Learning 引擎算，逐知识点反馈
   - 预览模式（管理员审查）不写任何数据
   ========================================================= */
(function (global) {
  'use strict';

  var C = global.Core, TD = global.TrainData;
  var L = global.Learning;

  var st = {
    container: null,
    opts: {},
    mode: 'self',        // self | preview
    personId: '',
    projectId: '',
    view: 'home',        // home | course | exam | result
    sec: '',             // 当前小节：材料 id 或 '__exam'
    exam: null,
    lastResult: null,
    matHtml: '',
    timer: null,
    onChange: null
  };

  var previewRead = {};
  var previewEvents = [];

  function esc(s) { return C.esc(s); }
  function now() { return Date.now(); }

  /* =========================================================
     数据
     ========================================================= */
  function projects() {
    var S = global.App && global.App.state;
    return (S && S.projects) ? S.projects : [];
  }

  function projectById(id) {
    return projects().filter(function (p) { return p.id === id; })[0] || null;
  }

  function personOf(pid) { return TD.personById(pid) || null; }

  function myProjects(pid) {
    return projects().filter(function (p) {
      if (p.status === 'draft') return false;
      if (p.people.indexOf(pid) >= 0) return true;
      return !!recOf(p, pid);
    });
  }

  function recOf(p, pid) {
    if (!p || !p.records) return null;
    return p.records.filter(function (r) { return r.pid === pid; })[0] || null;
  }

  function blankRec(pid) {
    return {
      pid: pid, status: 'pending', score: null, used: null,
      submitAt: null, tries: 0, answers: null, read: {}, events: []
    };
  }

  function totalScore(p) {
    return (p.questions || []).reduce(function (s, q) { return s + (Number(q.score) || 0); }, 0);
  }

  function passLine(p) {
    var total = totalScore(p);
    if (!total) return p.passScore || 60;
    return Math.round((p.passScore || 60) / 100 * total);
  }

  function daysLeft(due) {
    if (!due) return null;
    var d = new Date(String(due).replace(/-/g, '/') + ' 23:59:59');
    if (isNaN(d.getTime())) return null;
    return Math.ceil((d.getTime() - now()) / 86400000);
  }

  function readMapOf(rec) {
    var base = (rec && rec.read) || {};
    if (st.mode !== 'preview') return base;
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(previewRead).forEach(function (k) { out[k] = 1; });
    return out;
  }

  function eventsOf(rec) {
    var base = (rec && rec.events) || [];
    if (st.mode !== 'preview' || !previewEvents.length) return base;
    return base.concat(previewEvents);
  }

  function masteryOf(rec) {
    return L.masteryOf({ events: eventsOf(rec) }, now());
  }

  function sectionsOf(p) {
    var out = [];
    (p.materials || []).forEach(function (m) {
      out.push({ type: 'material', id: m.id, mat: m });
    });
    if ((p.questions || []).length) out.push({ type: 'exam', id: '__exam' });
    return out;
  }

  function secState(p, rec, sec) {
    if (sec.type === 'material') {
      return readMapOf(rec)[sec.id] ? 'done' : 'todo';
    }
    if (rec && rec.status === 'done') return 'done';
    if (rec && rec.tries > 0) return 'doing';
    return 'todo';
  }

  function progressOf(p, rec) {
    var secs = sectionsOf(p);
    if (!secs.length) return 0;
    var done = secs.filter(function (s) { return secState(p, rec, s) === 'done'; }).length;
    return Math.round(done / secs.length * 100);
  }

  function projStatus(p, pid) {
    var rec = recOf(p, pid);
    if (rec && rec.status === 'done') return 'done';
    if (rec && (rec.status === 'doing' || progressOf(p, rec) > 0)) return 'doing';
    return 'pending';
  }

  var PROJ_ST = {
    done:    { name: '已完成', cls: 'ss-done' },
    doing:   { name: '进行中', cls: 'ss-doing' },
    pending: { name: '未开始', cls: 'ss-new' }
  };

  /* =========================================================
     挂载
     ========================================================= */
  function mount(container, opts) {
    if (!container) return { projects: 0 };
    st.container = container;
    st.opts = opts || {};
    st.mode = st.opts.mode || 'self';
    st.personId = st.opts.personId || st.personId || '';
    st.onChange = st.opts.onChange || null;

    st.view = 'home';
    st.projectId = '';
    st.sec = '';
    st.exam = null;
    st.lastResult = null;
    previewRead = {};
    previewEvents = [];
    stopTimer();

    render();
    return { projects: myProjects(st.personId).length };
  }

  function setPerson(pid) {
    st.personId = pid;
    st.view = 'home';
    st.projectId = '';
    st.sec = '';
    st.exam = null;
    st.lastResult = null;
    previewRead = {};
    previewEvents = [];
    stopTimer();
    render();
  }

  function refresh() {
    if (st.container && document.body.contains(st.container)) render();
  }

  function go(view, projectId, sec) {
    st.view = view;
    if (projectId) st.projectId = projectId;
    if (sec != null) st.sec = sec;
    render();
  }

  function notify() {
    if (typeof st.onChange === 'function') st.onChange();
  }

  function persist() {
    if (st.mode === 'preview') return;
    if (global.App && global.App.state) C.Store.save(global.App.state);
  }

  /* =========================================================
     渲染入口
     ========================================================= */
  function render() {
    if (!st.container || !document.body.contains(st.container)) return;

    var p = projectById(st.projectId);
    var person = personOf(st.personId);
    var html = '';

    if (st.view === 'exam' && p) html = viewExam(p, person);
    else if (st.view === 'result' && p) html = viewResult(p, person);
    else if (st.view === 'course' && p) html = viewCourse(p, person);
    else html = viewHome(person);

    st.container.innerHTML = html;

    // 学习页 / 考试页需要撑满高度，学习台按内容流式排布
    st.container.classList.toggle('is-course', st.view === 'course' || st.view === 'exam');

    if (st.view === 'course' && st.matHtml) {
      var host = document.getElementById('matHost');
      if (host) host.innerHTML = st.matHtml;
    }

    var sc = st.container.closest('.learn-scroll');
    if (sc) sc.scrollTop = 0;
    notify();
  }

  /* =========================================================
     视图 1：学习台
     ========================================================= */
  function viewHome(person) {
    var list = myProjects(st.personId);
    var recs = list.map(function (p) { return { p: p, rec: recOf(p, st.personId) || {} }; });

    var done = recs.filter(function (x) { return x.rec.status === 'done'; }).length;
    var doing = recs.filter(function (x) {
      return x.rec.status !== 'done' && progressOf(x.p, x.rec) > 0;
    }).length;

    var h = '<div class="lw">';

    h += '<div class="lw-hero">' +
      '<div class="lw-hero-l">' +
        '<div class="lw-hi">' + (person ? esc(person.name) : '同学') + '，' +
          (list.length - done > 0 ? '还有 ' + (list.length - done) + ' 个培训等你' : '任务都完成了') + '</div>' +
        '<div class="lw-sub">' + (person ? esc(person.dept) + ' · ' + esc(person.role) : '欢迎回来') + '</div>' +
      '</div>' +
      '<div class="lw-hero-r">' +
        '<div class="lw-stat"><b>' + list.length + '</b><span>培训</span></div>' +
        '<div class="lw-stat"><b>' + doing + '</b><span>进行中</span></div>' +
        '<div class="lw-stat"><b>' + done + '</b><span>已完成</span></div>' +
      '</div>' +
    '</div>';

    if (!list.length) {
      h += '<div class="lw-empty">' +
        '<div class="lw-empty-ic">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M8 8h7M8 11.5h5"/></svg></div>' +
        '<div class="lw-empty-t">还没有分配给你的培训</div>' +
        '<div class="lw-empty-d">等管理员分发后，这里会出现你的学习任务。</div></div></div>';
      return h;
    }

    var focus = pickFocus(recs);
    if (focus) h += focusCard(focus);

    h += '<div class="lw-sec">' +
      '<div class="lw-sec-h">我的培训<span class="lw-sec-n">' + list.length + '</span></div>' +
      '<div class="lw-list">';

    recs.forEach(function (x) { h += courseRow(x.p, x.rec); });

    h += '</div></div>';

    var allM = [];
    recs.forEach(function (x) {
      masteryOf(x.rec).list.forEach(function (s) { allM.push(s); });
    });
    if (allM.length) h += masteryBoard(allM, '我的掌握情况');

    h += '</div>';
    return h;
  }

  function pickFocus(recs) {
    var cands = recs.filter(function (x) { return x.rec.status !== 'done'; });
    if (!cands.length) cands = recs;
    cands.sort(function (a, b) {
      var la = daysLeft(a.p.dueAt), lb = daysLeft(b.p.dueAt);
      if (la == null) la = 999;
      if (lb == null) lb = 999;
      return la - lb;
    });
    return cands[0] || null;
  }

  function focusCard(x) {
    var p = x.p, rec = x.rec;
    var pct = progressOf(p, rec);
    var done = rec.status === 'done';
    var evs = eventsOf(rec);
    var act = L.nextAction({ events: evs }, now());

    // 已交卷的培训不该再提示「先看材料」
    if (done && act.type === 'learn') {
      act = { type: 'exam', title: '再考一次', desc: '已经考过了，再答一次能看出掌握度的变化' };
    }
    if (done && act.type === 'done') {
      act = { type: 'done', title: '这块已经稳了', desc: '知识点都到熟练了，到期前不用再花时间' };
    }

    var secs = sectionsOf(p);
    // 有未完成的就落在第一个未完成；全做完了从第一份材料开始复习
    var nextSec = secs.filter(function (s) { return secState(p, rec, s) !== 'done'; })[0] || secs[0];
    var left = daysLeft(p.dueAt);

    return '<div class="lw-focus' + (done ? ' is-review' : '') + '" data-focus="' + p.id + '" data-sec="' + (nextSec ? nextSec.id : '') + '">' +
      '<div class="lwf-l">' +
        '<div class="lwf-tag">' + (done ? '复习巩固' : '继续学习') + '</div>' +
        '<div class="lwf-title">' + esc(p.title) + '</div>' +
        '<div class="lwf-act">' + esc(act.title) + ' · ' + esc(act.desc) + '</div>' +
        '<div class="lwf-meta">' +
          '<span>' + pct + '% 完成</span>' +
          (left != null ? '<span class="' + (left <= 3 ? 'urgent' : '') + '">' +
            (left < 0 ? '已逾期' : '还剩 ' + left + ' 天') + '</span>' : '') +
        '</div>' +
        '<div class="lwf-btn">' + (done ? '打开看看' : pct > 0 ? '接着学' : '开始学') +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
        '</div>' +
      '</div>' +
      '<div class="lwf-r">' + ring(pct, 96) + '</div>' +
    '</div>';
  }

  function ring(pct, size) {
    size = size || 54;
    var r = (size - 8) / 2;
    var c = 2 * Math.PI * r;
    var off = c * (1 - pct / 100);
    return '<svg class="lw-ring" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="6"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#fff" stroke-width="6" ' +
        'stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" ' +
        'transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '<text x="' + size / 2 + '" y="' + (size / 2 + 1) + '" text-anchor="middle" dominant-baseline="central" ' +
        'font-size="' + Math.round(size / 5) + '" font-weight="700" fill="#fff">' + pct + '%</text>' +
    '</svg>';
  }

  function courseRow(p, rec) {
    var s = PROJ_ST[projStatus(p, st.personId)];
    var pct = progressOf(p, rec);
    var left = daysLeft(p.dueAt);
    var line = passLine(p);
    var m = masteryOf(rec);
    var mats = (p.materials || []).length;
    var read = (p.materials || []).filter(function (x) { return readMapOf(rec)[x.id]; }).length;
    var qn = (p.questions || []).length;

    return '<button class="lw-row" data-open="' + p.id + '">' +
      '<div class="lwr-main">' +
        '<div class="lwr-top">' +
          '<span class="lwr-badge ' + s.cls + '">' + s.name + '</span>' +
          (left != null ? '<span class="lwr-due' + (left <= 3 ? ' urgent' : '') + '">' +
            (left < 0 ? '已逾期' : left === 0 ? '今天截止' : '剩 ' + left + ' 天') + '</span>' : '') +
        '</div>' +
        '<div class="lwr-title">' + esc(p.title) + '</div>' +
        '<div class="lwr-meta">' +
          '<span>' + read + '/' + mats + ' 材料</span>' +
          '<span>' + qn + ' 题</span>' +
          (rec.score != null ? '<span class="' + (rec.score >= line ? 'ok' : 'bad') + '">' + rec.score + ' 分</span>' : '') +
          (m.scored ? '<span>' + m.scored + ' 个知识点</span>' : '') +
        '</div>' +
        '<div class="lwr-bar"><i style="width:' + pct + '%"></i></div>' +
      '</div>' +
      '<div class="lwr-pct">' + pct + '%</div>' +
    '</button>';
  }

  /* =========================================================
     掌握度面板
     ========================================================= */
  function masteryBoard(list, title) {
    var sorted = list.slice().sort(function (a, b) {
      var sa = a.score == null ? 2 : a.p;
      var sb = b.score == null ? 2 : b.p;
      return sa - sb;
    });

    var scored = sorted.filter(function (s) { return s.score != null; });
    var avg = scored.length
      ? scored.reduce(function (a, s) { return a + s.score; }, 0) / scored.length : null;

    var h = '<div class="lw-sec">' +
      '<div class="lw-sec-h">' + esc(title) +
        (avg != null ? '<span class="lw-avg">平均 ' + Math.round(avg * 100) + '%</span>' : '') +
      '</div>';

    h += '<div class="lw-mb">';
    sorted.forEach(function (s) {
      var info = L.levelInfo(s.level);
      // 条宽用「学会程度」，等级也用同一个数，视觉与文字才对得上
      var pct = s.score != null ? Math.round(s.p * 100) : 0;
      var due = s.score != null && (s.needReview || s.overdue);
      h += '<div class="lw-mrow">' +
        '<div class="lw-mname" title="' + esc(s.point) + '">' + esc(s.point) + '</div>' +
        '<div class="lw-mbar"><i class="' + info.cls + '" style="width:' + pct + '%"></i></div>' +
        '<div class="lw-mlv ' + info.cls + '">' + info.name + '</div>' +
        '<div class="lw-mdue">' + (due ? '该复习' : '') + '</div>' +
      '</div>';
    });
    h += '</div>';

    h += '<div class="lw-mnote">等级看「当时学会没有」，答对 2 次以上才开始算。' +
      '右边标「该复习」表示这个知识点已经隔了一阵，记忆在往下掉——回去再看一眼就够。' +
      '一次都没答过的知识点会显示「数据不足」，那是没证据，不是没学会。</div>';

    h += '</div>';
    return h;
  }

  /* =========================================================
     视图 2：培训学习页
     ========================================================= */
  function viewCourse(p, person) {
    var rec = recOf(p, st.personId) || {};
    var secs = sectionsOf(p);
    var cur = secs.filter(function (s) { return s.id === st.sec; })[0] || secs[0];

    if (!cur) {
      return '<div class="lw"><div class="lw-empty">' +
        '<div class="lw-empty-t">这个培训还没有内容</div>' +
        '<div class="lw-empty-d">等管理员上传材料后就能开始学了。</div></div></div>';
    }
    st.sec = cur.id;

    var pct = progressOf(p, rec);

    var h = '<div class="lw-course">';

    h += '<div class="lwc-top">' +
      '<button class="lwc-back" data-home="1">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>' +
        '返回' +
      '</button>' +
      '<div class="lwc-title">' + esc(p.title) + '</div>' +
      '<div class="lwc-prog"><i style="width:' + pct + '%"></i></div>' +
      '<div class="lwc-pct">' + pct + '%</div>' +
    '</div>';

    h += '<div class="lwc-body">';

    /* 左：小节导航 */
    h += '<nav class="lwc-nav"><div class="lwcn-h">学习内容</div><div class="lwcn-list">';

    var matIdx = 0;
    secs.forEach(function (s) {
      var done = secState(p, rec, s) === 'done';
      var on = s.id === cur.id;

      if (s.type === 'material') {
        matIdx++;
        var info = global.Files ? global.Files.infoOf(s.mat.name) : { label: '资料' };
        h += '<button class="lwcn-item' + (on ? ' is-on' : '') + (done ? ' is-done' : '') +
            '" data-sec="' + s.id + '">' +
          '<span class="lwcn-tick">' + (done
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
            : String(matIdx)) + '</span>' +
          '<span class="lwcn-main">' +
            '<span class="lwcn-name">' + esc(s.mat.name) + '</span>' +
            '<span class="lwcn-meta">' + esc(info.label) + ' · ' + esc(s.mat.size || '') + '</span>' +
          '</span>' +
        '</button>';
      } else {
        h += '<button class="lwcn-item is-exam' + (on ? ' is-on' : '') + (done ? ' is-done' : '') +
            '" data-sec="' + s.id + '">' +
          '<span class="lwcn-tick">' + (done
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>') +
          '</span>' +
          '<span class="lwcn-main">' +
            '<span class="lwcn-name">考核</span>' +
            '<span class="lwcn-meta">' + (p.questions || []).length + ' 题 · ' +
              totalScore(p) + ' 分 · ' + p.duration + ' 分钟</span>' +
          '</span>' +
        '</button>';
      }
    });

    h += '</div>';

    var idx = secs.indexOf(cur);
    var next = secs[idx + 1];
    if (next) {
      h += '<div class="lwcn-foot"><button class="lwcn-next" data-sec="' + next.id + '">下一节' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button></div>';
    }

    h += '</nav>';

    /* 右：内容 */
    h += '<div class="lwc-content">';
    h += cur.type === 'material' ? materialPane(p, rec, cur.mat) : examPane(p, rec);
    h += '</div>';

    h += '</div></div>';
    return h;
  }

  function materialPane(p, rec, m) {
    var read = readMapOf(rec)[m.id];
    var isVideo = m.type === 'video' || !!m.url;
    var info = isVideo ? { label: '视频', reader: 'video' }
      : (global.Files ? global.Files.infoOf(m.name) : { label: '资料' });
    var isPdf = info.reader === 'pdf' || info.reader === 'image' || info.reader === 'video';

    st.matHtml = '';
    setTimeout(function () { loadMaterial(m); }, 20);

    return '<div class="lwm' + (isPdf ? ' is-media' : '') + '">' +
      '<div class="lwm-head">' +
        '<div class="lwm-info-wrap">' +
          '<div class="lwm-title">' + esc(m.name) + '</div>' +
          '<div class="lwm-info">' + esc(info.label) +
            (m.size ? ' · ' + esc(m.size) : '') +
            (m.pages ? ' · ' + m.pages + ' 页' : '') + '</div>' +
        '</div>' +
        '<div class="lwm-acts">' +
          (m.hasFile !== false && !isVideo ? '<button class="lwm-btn" data-dl="' + m.id + '">下载原件</button>' : '') +
          '<button class="lwm-btn is-done' + (read ? ' on' : '') + '" data-read="' + m.id + '">' +
            (read ? '✓ 已读' : '标记已读') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="lwm-body" id="matHost"><div class="lwm-loading">正在打开…</div></div>' +
    '</div>';
  }

  function paraHtml(text) {
    var blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    if (blocks.length === 1) blocks = String(text || '').split('\n');
    return blocks.map(function (b) {
      var s = b.trim();
      if (!s) return '';
      if (/^[-•·*]\s/.test(s)) return '<div class="lmp-li">' + esc(s.replace(/^[-•·*]\s*/, '')) + '</div>';
      if (/^\d+[.、)]\s?/.test(s)) return '<div class="lmp-li num">' + esc(s) + '</div>';
      if (/^(第[一二三四五六七八九十]+[章节]|[一二三四五六七八九十]+、)/.test(s)) {
        return '<h4 class="lmp-h">' + esc(s) + '</h4>';
      }
      return '<p class="lmp-p">' + esc(s).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function loadMaterial(m) {
    var isVideo = m.type === 'video' || !!m.url;
    var info = isVideo ? { reader: 'video' }
      : (global.Files ? global.Files.infoOf(m.name) : { reader: 'text' });

    function fill(html) {
      var h = document.getElementById('matHost');
      if (h) h.innerHTML = html;
      st.matHtml = html;
    }

    /* 外链视频：不走文件库 */
    if (isVideo) {
      fill('<div class="lmp-video-wrap">' +
        '<video class="lmp-video" src="' + esc(m.url) + '" controls playsinline preload="metadata"></video>' +
        '</div>' +
        '<div class="lmp-video-note">看完了点右上角「标记已读」，再进下一节。</div>');
      return;
    }

    if (m.hasFile === false || !global.Files) {
      fill('<div class="lmp-sheet">' + paraHtml(m.preview || '（这份材料还没有正文）') + '</div>');
      return;
    }

    global.Files.get(m.id).then(function (rec) {
      if (!rec) {
        fill('<div class="lmp-empty">文件读不到了，可能被浏览器清理过。请让管理员重新上传。</div>');
        return;
      }

      if (info.reader === 'pdf') {
        global.Files.url(m.id).then(function (u) {
          fill('<iframe class="lmp-pdf" src="' + u + '#toolbar=1&navpanes=0&view=FitH" title="' + esc(m.name) + '"></iframe>');
        });
        return;
      }

      if (info.reader === 'image') {
        global.Files.url(m.id).then(function (u) {
          fill('<div class="lmp-imgwrap"><img class="lmp-img" src="' + u + '" alt="' + esc(m.name) + '"></div>');
        });
        return;
      }

      var txt = rec.text || '';
      if (!txt) {
        fill('<div class="lmp-empty">这份文件的文字提取不出来（老版 Office 格式常见）。' +
          '可以点右上角「下载原件」用本地软件打开。</div>');
        return;
      }

      var pages = /【第 \d+ 页】/.test(txt)
        ? txt.split(/【第 \d+ 页】/).map(function (s) { return s.trim(); }).filter(Boolean)
        : null;

      var inner;
      if (pages && pages.length > 1) {
        inner = pages.map(function (pg, i) {
          return '<div class="lmp-page"><div class="lmp-pageno">第 ' + (i + 1) + ' 页</div>' + paraHtml(pg) + '</div>';
        }).join('');
      } else {
        inner = paraHtml(txt);
      }
      fill('<div class="lmp-sheet">' + inner + '</div>');
    })['catch'](function () {
      fill('<div class="lmp-empty">打开失败，请下载原件查看。</div>');
    });
  }

  function examPane(p, rec) {
    var line = passLine(p);
    var total = totalScore(p);
    var m = masteryOf(rec);
    var tries = rec.tries || 0;

    var h = '<div class="lwe">' +
      '<div class="lwe-card">' +
        '<div class="lwe-badge">考核</div>' +
        '<h3 class="lwe-title">' + esc(p.title) + '</h3>' +
        '<div class="lwe-desc">' + esc(p.desc || '') + '</div>' +
        '<div class="lwe-grid">' +
          '<div class="lwe-cell"><b>' + (p.questions || []).length + '</b><span>题</span></div>' +
          '<div class="lwe-cell"><b>' + total + '</b><span>满分</span></div>' +
          '<div class="lwe-cell"><b>' + line + '</b><span>及格</span></div>' +
          '<div class="lwe-cell"><b>' + p.duration + '</b><span>分钟</span></div>' +
        '</div>' +
        (rec.score != null
          ? '<div class="lwe-last">上次得分 <b class="' + (rec.score >= line ? 'ok' : 'bad') + '">' +
            rec.score + '</b> / ' + total + ' · 已考 ' + tries + ' 次</div>'
          : '') +
        '<button class="lwe-start" data-start="1">' + (tries ? '再考一次' : '开始考核') +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>' +
        '</button>' +
        '<div class="lwe-tip">提交后立刻出分，并给出每个知识点的掌握情况</div>' +
      '</div>';

    if (m.list.length) {
      h += '<div class="lwe-mastery">' + masteryBoard(m.list, '这次考核的掌握情况') + '</div>';
    }

    h += '</div>';
    return h;
  }

  /* =========================================================
     视图 3：考试
     ========================================================= */
  function startExam() {
    var p = projectById(st.projectId);
    if (!p || !(p.questions || []).length) { toast('这个培训还没有配置试卷', 'err'); return; }

    var order = { single: 0, multi: 1, judge: 2, blank: 3, essay: 4 };
    var qs = p.questions.slice().sort(function (a, b) {
      return (order[a.type] || 0) - (order[b.type] || 0);
    });

    st.exam = {
      qs: qs,
      idx: 0,
      answers: {},
      flags: {},
      left: (Number(p.duration) || 60) * 60,
      startAt: now()
    };
    st.view = 'exam';
    render();
    runTimer();
  }

  function runTimer() {
    stopTimer();
    st.timer = setInterval(function () {
      if (!st.exam) { stopTimer(); return; }
      st.exam.left -= 1;
      var el = document.getElementById('lxClock');
      if (el) {
        el.textContent = fmtClock(st.exam.left);
        el.className = 'lx-clock' + (st.exam.left <= 60 ? ' is-danger' : st.exam.left <= 300 ? ' is-warn' : '');
      }
      if (st.exam.left <= 0) { stopTimer(); submit(true); }
    }, 1000);
  }

  function stopTimer() {
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
  }

  function fmtClock(sec) {
    if (sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function answered(q) {
    var a = st.exam.answers[q.id];
    if (q.type === 'multi') return Array.isArray(a) && a.length > 0;
    return a != null && String(a).trim() !== '';
  }

  function viewExam(p, person) {
    var ex = st.exam;
    if (!ex) { setTimeout(startExam, 0); return '<div class="lw"></div>'; }

    var q = ex.qs[ex.idx];
    var t = C.TYPE_MAP[q.type];
    var total = ex.qs.length;
    var doneCount = ex.qs.filter(answered).length;

    var h = '<div class="lx">';

    h += '<div class="lx-top">' +
      '<div class="lx-top-l">' +
        '<div class="lx-title">' + esc(p.title) + '</div>' +
        '<div class="lx-sub">' + total + ' 题 · 满分 ' + totalScore(p) + ' 分 · 及格 ' + passLine(p) + ' 分</div>' +
      '</div>' +
      '<div class="lx-clock" id="lxClock">' + fmtClock(ex.left) + '</div>' +
      '<button class="lx-quit" data-quit="1">退出</button>' +
      '<button class="lx-submit" data-submit="1">交卷</button>' +
    '</div>';

    h += '<div class="lx-strip">';
    ex.qs.forEach(function (qq, i) {
      var cls = 'lx-dot';
      if (ex.flags[qq.id]) cls += ' is-flag';
      else if (answered(qq)) cls += ' is-done';
      if (i === ex.idx) cls += ' is-cur';
      h += '<button class="' + cls + '" data-jump="' + i + '">' + (i + 1) + '</button>';
    });
    h += '</div>';

    h += '<div class="lx-body"><div class="lx-q">' +
      '<div class="lx-qhead">' +
        '<span class="lx-qno">第 ' + (ex.idx + 1) + ' 题 / 共 ' + total + '</span>' +
        '<span class="lx-qtype qt-' + q.type + '">' + t.name + '</span>' +
        '<span class="lx-qscore">' + q.score + ' 分</span>' +
        (q.point ? '<span class="lx-qpoint">' + esc(q.point) + '</span>' : '') +
        (ex.flags[q.id] ? '<span class="lx-qflag">待定</span>' : '') +
      '</div>' +
      '<div class="lx-stem">' + stemHtml(q.stem) + '</div>' +
      '<div class="lx-opts">' + optionsHtml(q) + '</div>' +
    '</div></div>';

    /* 底部只放导航：上一题在左，下一题在右，中间是进度与标记 */
    h += '<div class="lx-foot">' +
      '<button class="lx-nav" data-nav="prev"' + (ex.idx === 0 ? ' disabled' : '') + '>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>上一题' +
      '</button>' +
      '<div class="lx-mid">' +
        '<span class="lx-prog">已答 <b>' + doneCount + '</b> / ' + total + '</span>' +
        '<button class="lx-flag-btn' + (ex.flags[q.id] ? ' on' : '') + '" data-flag="1">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a2 2 0 0 1 2-2h11l-2 4 2 4H6"/></svg>' +
          (ex.flags[q.id] ? '取消待定' : '待定') +
        '</button>' +
      '</div>' +
      (ex.idx === total - 1
        ? '<button class="lx-nav" disabled>最后一题</button>'
        : '<button class="lx-nav is-next" data-nav="next">下一题' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>') +
    '</div>';

    h += '</div>';
    return h;
  }

  function stemHtml(s) {
    return esc(s).replace(/_{3,}/g, '<span class="lx-blank"></span>');
  }

  function optionsHtml(q) {
    var ans = st.exam.answers[q.id];

    if (q.type === 'single' || q.type === 'multi') {
      return (q.options || []).map(function (o) {
        var on = q.type === 'multi'
          ? (Array.isArray(ans) && ans.indexOf(o.key) >= 0)
          : ans === o.key;
        return '<button class="lx-opt' + (on ? ' is-on' : '') + '" data-opt="' + o.key + '">' +
          '<span class="lx-key">' + o.key + '</span>' +
          '<span class="lx-otext">' + esc(o.text) + '</span>' +
        '</button>';
      }).join('');
    }

    if (q.type === 'judge') {
      return ['正确', '错误'].map(function (v) {
        return '<button class="lx-opt' + (ans === v ? ' is-on' : '') + '" data-judge="' + v + '">' +
          '<span class="lx-key">' + (v === '正确' ? '√' : '×') + '</span>' +
          '<span class="lx-otext">' + v + '</span>' +
        '</button>';
      }).join('');
    }

    if (q.type === 'blank') {
      return '<input class="lx-input" id="lxBlank" placeholder="填写答案" value="' +
        esc(ans || '') + '" autocomplete="off">' +
        '<div class="lx-hint">多个空用 / 分隔</div>';
    }

    return '<textarea class="lx-textarea" id="lxEssay" placeholder="写下你的答案">' +
      esc(ans || '') + '</textarea>' +
      '<div class="lx-hint">按要点给分，写清关键做法即可</div>';
  }

  /* =========================================================
     判分
     ========================================================= */
  function normText(s) {
    return String(s == null ? '' : s)
      .replace(/\s/g, '')
      .replace(/[，。；、,.;:：！？!?"'"'（）()【】\[\]]/g, '')
      .toLowerCase();
  }

  function judgeAnswer(q, ans) {
    if (ans == null) return false;

    if (q.type === 'single') {
      return String(ans).trim().toUpperCase() === String(q.answer).trim().toUpperCase();
    }

    if (q.type === 'multi') {
      var a = (Array.isArray(ans) ? ans : []).map(function (x) { return String(x).toUpperCase(); }).sort();
      var b = (Array.isArray(q.answer) ? q.answer : [q.answer]).map(function (x) { return String(x).toUpperCase(); }).sort();
      return a.length === b.length && a.join(',') === b.join(',');
    }

    if (q.type === 'judge') {
      var v = String(ans).trim();
      var mine = /^(正确|对|true|t|√|a)$/i.test(v);
      var ref = /^(正确|对|true|t|√|a)$/i.test(String(q.answer).trim());
      return mine === ref;
    }

    if (q.type === 'blank') {
      var ua = String(ans).split(/[\/|｜]/).map(normText).filter(Boolean);
      var ra = String(q.answer).split(/[\/|｜]/).map(normText).filter(Boolean);
      if (!ra.length) return false;
      var hit = ra.filter(function (r) {
        return ua.some(function (u) { return u.indexOf(r) >= 0 || r.indexOf(u) >= 0; });
      }).length;
      return hit / ra.length >= 0.8;
    }

    var refs = String(q.answer).split(/\n|；|;/).map(normText).filter(function (x) { return x.length > 3; });
    if (!refs.length) return String(ans).trim().length > 10;
    return essayRatio(refs, ans) >= 0.5;
  }

  function essayRatio(refs, ans) {
    var u = normText(ans);
    var found = refs.filter(function (r) {
      var core = r.slice(0, Math.min(8, r.length));
      return u.indexOf(core) >= 0;
    }).length;
    return refs.length ? found / refs.length : 0;
  }

  function grade(p, qs, answers) {
    var detail = [];
    var got = 0, full = 0;

    qs.forEach(function (q) {
      var ans = answers[q.id];
      var fullScore = Number(q.score) || 0;
      full += fullScore;

      var ok = judgeAnswer(q, ans);
      var earned = ok ? fullScore : 0;

      // 简答题按要点命中率给部分分
      if (q.type === 'essay' && ans) {
        var refs = String(q.answer).split(/\n|；|;/).map(normText).filter(function (x) { return x.length > 3; });
        if (refs.length) {
          var ratio = essayRatio(refs, ans);
          if (ratio > 0 && ratio < 1) earned = Math.round(fullScore * ratio * 0.8);
        }
      }

      got += earned;
      detail.push({ q: q, ok: ok, earned: earned, answer: ans == null ? '' : ans });
    });

    return { got: got, full: full, detail: detail, line: passLine(p) };
  }

  /* =========================================================
     视图 4：成绩 + 掌握度
     ========================================================= */
  function submit(auto) {
    var p = projectById(st.projectId);
    var ex = st.exam;
    if (!p || !ex) return;

    stopTimer();

    var res = grade(p, ex.qs, ex.answers);
    var used = Math.max(1, Math.round((now() - ex.startAt) / 60000));
    var passed = res.got >= res.line;
    var evs = L.eventsFromAttempt(res.detail, now());

    if (st.mode === 'preview') {
      previewEvents = previewEvents.concat(evs);
    } else {
      var rec = recOf(p, st.personId);
      if (!rec) { rec = blankRec(st.personId); p.records.push(rec); }
      L.appendEvents(rec, evs);
      rec.status = 'done';
      rec.score = res.got;
      rec.used = used;
      rec.tries = (rec.tries || 0) + 1;
      rec.submitAt = fmtNow();
      rec.answers = ex.answers;
      persist();
    }

    st.lastResult = { res: res, used: used, passed: passed, auto: !!auto };
    st.exam = null;
    st.view = 'result';
    render();
  }

  function fmtNow() {
    var d = new Date();
    function p2(n) { return n < 10 ? '0' + n : n; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  function viewResult(p, person) {
    var r = st.lastResult;
    if (!r) { setTimeout(function () { st.view = 'course'; render(); }, 0); return '<div class="lw"></div>'; }

    var rec = recOf(p, st.personId);
    var m = masteryOf(rec);
    var res = r.res;
    var pct = res.full ? Math.round(res.got / res.full * 100) : 0;
    var rightCount = res.detail.filter(function (d) { return d.ok; }).length;

    var h = '<div class="lw lr">';

    h += '<div class="lr-hero">' +
      '<div class="lr-score-wrap">' +
        '<div class="lr-score ' + (r.passed ? 'pass' : 'fail') + '">' + res.got +
          '<small>/' + res.full + '</small></div>' +
        '<div class="lr-badge ' + (r.passed ? 'pass' : 'fail') + '">' +
          (r.passed ? '通过' : '未通过') + '</div>' +
        (st.mode === 'preview' ? '<div class="lr-preview">预览模式，不计入成绩</div>' : '') +
      '</div>' +
      '<div class="lr-stats">' +
        '<div class="lr-stat"><b>' + rightCount + '/' + res.detail.length + '</b><span>答对</span></div>' +
        '<div class="lr-stat"><b>' + r.used + '</b><span>用时（分）</span></div>' +
        '<div class="lr-stat"><b>' + res.line + '</b><span>及格线</span></div>' +
        '<div class="lr-stat"><b>' + pct + '%</b><span>得分率</span></div>' +
      '</div>' +
    '</div>';

    if (m.list.length) {
      h += masteryBoard(m.list, '知识点掌握情况');
      var act = L.nextAction(rec || {}, now());
      h += '<div class="lr-next">' +
        '<div class="lr-next-t">建议下一步</div>' +
        '<div class="lr-next-d">' + esc(act.title) + ' · ' + esc(act.desc) + '</div>' +
      '</div>';
    }

    h += '<div class="lw-sec"><div class="lw-sec-h">逐题回顾</div><div class="lr-list">';

    res.detail.forEach(function (d, i) {
      var q = d.q;
      var t = C.TYPE_MAP[q.type];
      h += '<div class="lr-item ' + (d.ok ? 'ok' : 'no') + '">' +
        '<div class="lr-mark">' + (d.ok ? '✓' : '✕') + '</div>' +
        '<div class="lr-main">' +
          '<div class="lr-qhead">' +
            '<span class="lr-no">' + (i + 1) + '</span>' +
            '<span class="lx-qtype qt-' + q.type + '">' + t.name + '</span>' +
            (q.point ? '<span class="lr-point">' + esc(q.point) + '</span>' : '') +
            '<span class="lr-earn">' + d.earned + '/' + q.score + '</span>' +
          '</div>' +
          '<div class="lr-stem">' + esc(q.stem) + '</div>' +
          '<div class="lr-ans">' +
            '你的答案：<i>' + esc(fmtAnswer(q, d.answer) || '（空）') + '</i>' +
            ' · 正确答案：<b>' + esc(fmtAnswer(q, q.answer)) + '</b>' +
          '</div>' +
          (q.analysis ? '<div class="lr-analysis">' + esc(q.analysis) + '</div>' : '') +
        '</div>' +
      '</div>';
    });

    h += '</div></div>';

    h += '<div class="lr-acts">' +
      '<button class="lr-btn" data-home="1">回到学习台</button>' +
      '<button class="lr-btn is-primary" data-back-course="1">回到培训</button>' +
    '</div>';

    h += '</div>';
    return h;
  }

  function fmtAnswer(q, a) {
    if (a == null || a === '') return '';
    if (q.type === 'multi') return (Array.isArray(a) ? a : [a]).join('、');
    return String(a);
  }

  /* =========================================================
     交互
     ========================================================= */
  function markRead(p, matId) {
    if (st.mode === 'preview') {
      if (!previewRead[matId]) { previewRead[matId] = 1; render(); }
      return;
    }
    var rec = recOf(p, st.personId);
    if (!rec) { rec = blankRec(st.personId); p.records.push(rec); }
    if (!rec.read) rec.read = {};
    rec.read[matId] = now();
    if (rec.status === 'pending') rec.status = 'doing';
    persist();
    render();
  }

  function toast(msg, type) {
    if (global.App && global.App.toast) global.App.toast(msg, type);
  }

  function saveInputs() {
    if (!st.exam) return;
    var el = document.getElementById('lxBlank') || document.getElementById('lxEssay');
    if (!el) return;
    var q = st.exam.qs[st.exam.idx];
    if (q) st.exam.answers[q.id] = el.value;
  }

  function bindEvents() {
    document.addEventListener('click', function (e) {
      if (!st.container || !st.container.contains(e.target)) return;

      var focus = e.target.closest('[data-focus]');
      if (focus) {
        st.projectId = focus.dataset.focus;
        st.sec = focus.dataset.sec || '';
        st.view = 'course';
        render();
        return;
      }

      var open = e.target.closest('[data-open]');
      if (open) {
        st.projectId = open.dataset.open;
        var p0 = projectById(st.projectId);
        var rec0 = recOf(p0, st.personId) || {};
        var secs0 = sectionsOf(p0);
        var todo0 = secs0.filter(function (s) { return secState(p0, rec0, s) !== 'done'; })[0];
        st.sec = todo0 ? todo0.id : (secs0[0] ? secs0[0].id : '');
        st.view = 'course';
        render();
        return;
      }

      if (e.target.closest('[data-home]')) {
        st.view = 'home';
        st.projectId = '';
        st.sec = '';
        st.exam = null;
        st.lastResult = null;
        stopTimer();
        render();
        return;
      }

      if (e.target.closest('[data-back-course]')) {
        st.view = 'course';
        st.lastResult = null;
        render();
        return;
      }

      var secBtn = e.target.closest('[data-sec]');
      if (secBtn && st.view === 'course') {
        st.sec = secBtn.dataset.sec;
        render();
        return;
      }

      var dl = e.target.closest('[data-dl]');
      if (dl) {
        if (global.Files) global.Files.download(dl.dataset.dl).then(function (ok) {
          if (!ok) toast('这份材料没有关联文件', 'err');
        });
        return;
      }

      var rd = e.target.closest('[data-read]');
      if (rd) { markRead(projectById(st.projectId), rd.dataset.read); return; }

      if (e.target.closest('[data-start]')) { startExam(); return; }

      if (st.view === 'exam' && st.exam) {
        var opt = e.target.closest('[data-opt]');
        if (opt) {
          var q = st.exam.qs[st.exam.idx];
          var t = C.TYPE_MAP[q.type];
          if (t.multi) {
            var arr = Array.isArray(st.exam.answers[q.id]) ? st.exam.answers[q.id].slice() : [];
            var i = arr.indexOf(opt.dataset.opt);
            if (i >= 0) arr.splice(i, 1); else arr.push(opt.dataset.opt);
            st.exam.answers[q.id] = arr.sort();
          } else {
            st.exam.answers[q.id] = opt.dataset.opt;
          }
          render();
          return;
        }

        var jd = e.target.closest('[data-judge]');
        if (jd) {
          var q2 = st.exam.qs[st.exam.idx];
          st.exam.answers[q2.id] = jd.dataset.judge;
          render();
          return;
        }

        var jump = e.target.closest('[data-jump]');
        if (jump) {
          saveInputs();
          st.exam.idx = Number(jump.dataset.jump);
          render();
          return;
        }

        var nav = e.target.closest('[data-nav]');
        if (nav) {
          saveInputs();
          if (nav.dataset.nav === 'prev') st.exam.idx = Math.max(0, st.exam.idx - 1);
          else st.exam.idx = Math.min(st.exam.qs.length - 1, st.exam.idx + 1);
          render();
          return;
        }

        var flag = e.target.closest('[data-flag]');
        if (flag) {
          var q3 = st.exam.qs[st.exam.idx];
          st.exam.flags[q3.id] = !st.exam.flags[q3.id];
          render();
          return;
        }

        if (e.target.closest('[data-submit]')) {
          saveInputs();
          var left = st.exam.qs.filter(function (x) { return !answered(x); }).length;
          if (left && !confirm('还有 ' + left + ' 题没答，确定交卷？')) return;
          submit(false);
          return;
        }

        if (e.target.closest('[data-quit]')) {
          if (!confirm('退出后本次作答不保存，确定？')) return;
          stopTimer();
          st.exam = null;
          st.view = 'course';
          render();
          return;
        }
      }
    });

    document.addEventListener('input', function (e) {
      if (!st.container || !st.container.contains(e.target)) return;
      if (st.view !== 'exam' || !st.exam) return;
      var el = e.target;
      if (el.id !== 'lxBlank' && el.id !== 'lxEssay') return;

      var q = st.exam.qs[st.exam.idx];
      if (!q) return;
      st.exam.answers[q.id] = el.value;

      // 题号条即时反馈，让人知道这题记上了
      var dot = st.container.querySelector('.lx-dot[data-jump="' + st.exam.idx + '"]');
      if (dot) {
        dot.classList.toggle('is-done', String(el.value).trim() !== '');
        dot.classList.remove('is-flag');
      }
      var prog = st.container.querySelector('.lx-prog');
      if (prog) {
        var dn = st.exam.qs.filter(answered).length;
        prog.textContent = '已答 ' + dn + '/' + st.exam.qs.length;
      }
    });
  }

  var bound = false;
  function ensureBound() {
    if (bound) return;
    bound = true;
    bindEvents();
  }

  global.Student = {
    mount: function (container, opts) { ensureBound(); return mount(container, opts); },
    setPerson: setPerson,
    refresh: refresh,
    go: go,
    grade: grade,
    unmount: function () {
      stopTimer();
      st.container = null;
      st.exam = null;
      st.lastResult = null;
      previewRead = {};
      previewEvents = [];
    },
    current: function () {
      return {
        view: st.view,
        projectId: st.projectId,
        personId: st.personId,
        sec: st.sec,
        mode: st.mode
      };
    }
  };
})(window);
