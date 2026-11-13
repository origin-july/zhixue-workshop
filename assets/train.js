/* =========================================================
   train.js — 员工培训模块
   ========================================================= */
(function (global) {
  'use strict';

  var C = global.Core, E = global.Engine, X = global.Exporter, TD = global.TrainData;

  var S = null;                 // 由 App 注入（共享状态）
  var project = null;           // 当前培训项目
  var docPick = {};             // 出题选中的材料 id
  var trainSrcMode = 'material';
  var trainPasteText = '';
  var trainFileText = '';
  var trainFileName = '';
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return C.esc(s); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function toast(msg, type) {
    var wrap = $('toastWrap');
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    var icon = type === 'err'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    el.innerHTML = icon + '<span>' + esc(msg) + '</span>';
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 240);
    }, type === 'err' ? 4200 : 2600);
  }

  function persist() { if (S) C.Store.save(S); }

  /* =========================================================
     数据初始化
     ========================================================= */
  function ensureProjects() {
    if (!S.projects || !Array.isArray(S.projects) || !S.projects.length) {
      S.projects = TD.defaultProjects();
    }
    // 补齐老数据缺失的字段
    S.projects.forEach(function (p) {
      if (!p.rules) p.rules = TD.defaultRules();
      if (!p.templates) p.templates = TD.defaultTemplates();
      if (!p.materials) p.materials = [];
      if (!p.questions) p.questions = [];
      if (!p.records) p.records = [];
      if (!p.people) p.people = [];
      if (!p.mailLog) p.mailLog = [];
      if (p.retake == null) p.retake = 1;
      if (p.passScore == null) p.passScore = 60;
      if (p.duration == null) p.duration = 45;
    });
    if (!S.activeProjectId || !S.projects.some(function (p) { return p.id === S.activeProjectId; })) {
      S.activeProjectId = S.projects[0].id;
    }
    project = S.projects.find(function (p) { return p.id === S.activeProjectId; });
  }

  /* ---------- 统计 ---------- */
  function stats(p) {
    var n = p.people.length;
    var done = p.records.filter(function (r) { return r.status === 'done'; }).length;
    var doing = p.records.filter(function (r) { return r.status === 'doing'; }).length;
    var scores = p.records.filter(function (r) { return r.status === 'done' && r.score != null; }).map(function (r) { return r.score; });
    var avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : 0;
    var line = passLine(p);
    var pass = scores.filter(function (s) { return s >= line; }).length;

    // 材料阅读情况
    var matTotal = (p.materials || []).length;
    var readSlots = 0, readerCount = 0;
    p.records.forEach(function (r) {
      var c = r.read ? Object.keys(r.read).length : 0;
      if (c) readerCount++;
      readSlots += Math.min(c, matTotal);
    });
    var readRate = (matTotal && n) ? Math.round(readSlots / (matTotal * n) * 100) : 0;

    return {
      total: n,
      done: done,
      doing: doing,
      pending: n - done - doing,
      undone: n - done,
      rate: n ? Math.round(done / n * 100) : 0,
      avg: avg,
      pass: pass,
      passRate: scores.length ? Math.round(pass / scores.length * 100) : 0,
      scores: scores,
      matTotal: matTotal,
      readSlots: readSlots,
      readerCount: readerCount,
      readRate: readRate
    };
  }

  /** 某人读完了几份材料 */
  function readCountOf(rec, p) {
    if (!rec || !rec.read) return 0;
    return Math.min(Object.keys(rec.read).length, (p.materials || []).length);
  }

  function totalScore(p) {
    return p.questions.reduce(function (s, q) { return s + (Number(q.score) || 0); }, 0);
  }

  /** 及格线：passScore 是百分制，试卷满分不是 100 时按比例折算 */
  function passLine(p) {
    var total = totalScore(p);
    if (!total) return p.passScore || 60;
    return Math.round((p.passScore || 60) / 100 * total);
  }

  /** 及格线描述，说明折算关系 */
  function passDesc(p) {
    var total = totalScore(p);
    var line = passLine(p);
    if (!total || total === 100) return line + ' 分';
    return line + ' 分（' + (p.passScore || 60) + '% × 满分 ' + total + '）';
  }

  /* =========================================================
     左栏：项目列表
     ========================================================= */
  function renderProjectList() {
    var all = S.projects;
    var active = all.filter(function (p) { return p.status === 'active'; }).length;
    var totalPeople = all.reduce(function (s, p) { return s + p.people.length; }, 0);

    $('tpSummary').innerHTML =
      '<div class="tps-item"><span class="tps-num">' + active + '</span><span class="tps-label">进行中</span></div>' +
      '<div class="tps-div"></div>' +
      '<div class="tps-item"><span class="tps-num">' + all.length + '</span><span class="tps-label">全部项目</span></div>' +
      '<div class="tps-div"></div>' +
      '<div class="tps-item"><span class="tps-num">' + totalPeople + '</span><span class="tps-label">覆盖人次</span></div>';

    $('tpList').innerHTML = all.map(function (p) {
      var st = stats(p);
      var s = TD.status[p.status] || TD.status.draft;
      var on = p.id === S.activeProjectId;
      return '<button class="tp-item' + (on ? ' is-on' : '') + '" data-proj="' + p.id + '">' +
        '<div class="tpi-top">' +
          '<span class="tpi-st ' + s.cls + '">' + s.name + '</span>' +
          '<span class="tpi-type">' + esc(p.type) + '</span>' +
          '<span class="tpi-dept">' + esc(p.dept) + '</span>' +
        '</div>' +
        '<div class="tpi-title">' + esc(p.title) + '</div>' +
        '<div class="tpi-foot">' +
          '<div class="tpi-bar"><i style="width:' + st.rate + '%"></i></div>' +
          '<span class="tpi-pct">' + st.rate + '%</span>' +
        '</div>' +
        '<div class="tpi-meta">' + st.done + '/' + st.total + ' 人完成 · 截止 ' + esc(p.dueAt) + '</div>' +
      '</button>';
    }).join('');
  }

  /* =========================================================
     中栏：项目头部
     ========================================================= */
  function daysLeft(due) {
    var d = new Date(due + 'T23:59:59');
    var now = new Date();
    return Math.ceil((d - now) / 86400000);
  }

  function renderHead() {
    var p = project;
    var st = stats(p);
    var s = TD.status[p.status] || TD.status.draft;
    var left = daysLeft(p.dueAt);

    $('thTags').innerHTML =
      '<span class="tpi-st ' + s.cls + '">' + s.name + '</span>' +
      '<span class="th-dept">' + esc(p.dept) + '</span>';

    $('thTitle').textContent = p.title;

    var dueText = left > 0 ? ('剩 ' + left + ' 天') : (left === 0 ? '今天截止' : '已逾期 ' + Math.abs(left) + ' 天');
    $('thMeta').innerHTML =
      '<span class="mi">截止 <b>' + esc(p.dueAt) + '</b> · ' + dueText + '</span>' +
      '<span class="mi">' + st.total + ' 人参加</span>' +
      '<span class="mi">' + p.questions.length + ' 题 / ' + totalScore(p) + ' 分 · 限时 ' + p.duration + ' 分钟</span>' +
      '<span class="mi">负责人 <b>' + esc(p.owner) + '</b></span>';

    $('tnMaterial').textContent = p.materials.length;
    $('tnPaper').textContent = p.questions.length;
    $('tnPeople').textContent = p.people.length;

    var pub = $('btnPublishLabel');
    if (pub) pub.textContent = p.people.length ? '分派' : '选人分派';

    $$('#trainTabs .ttab').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.tab === (S.trainTab || 'board'));
    });
  }

  /* =========================================================
     中栏：看板
     管理员每天只看一页：整体怎么样、谁要催、全部明细
     ========================================================= */
  function recOf(personId) {
    return project.records.find(function (r) { return r.pid === personId; }) || null;
  }

  /** 按状态把参训人分组，附带记录 */
  function boardRows() {
    var p = project;
    var rows = p.people.map(function (id) {
      var person = TD.personById(id);
      if (!person) return null;
      var rec = recOf(id);
      var status = rec ? rec.status : 'pending';
      return {
        person: person,
        rec: rec,
        status: status,
        read: readCountOf(rec, p),
        score: rec && rec.score != null ? rec.score : null,
        used: rec && rec.used != null ? rec.used : null,
        submitAt: rec ? rec.submitAt : null
      };
    }).filter(Boolean);
    return rows;
  }

  /** 逐题正确率：优先用学习引擎记下的逐题事件，没有事件就用存档答案重判。两者皆无则不出这个区块。 */
  function qStats(p) {
    var done = p.records.filter(function (r) { return r.status === 'done'; });
    if (!done.length || !p.questions.length) return null;

    return p.questions.map(function (q) {
      var n = 0, ok = 0;
      done.forEach(function (r) {
        var evs = (r.events || []).filter(function (e) {
          return e && e.qid === q.id && e.kind === 'attempt';
        });
        if (evs.length) {
          n++;
          if (evs[evs.length - 1].correct) ok++;
          return;
        }
        if (r.answers && Object.prototype.hasOwnProperty.call(r.answers, q.id) && global.Student) {
          var one = {};
          one[q.id] = r.answers[q.id];
          var res = global.Student.grade(p, [q], one);
          var d = res && res.detail && res.detail[0];
          if (!d) return;
          n++;
          if (d.ok) ok++;
        }
      });
      return { q: q, n: n, ok: ok, pct: n ? Math.round(ok / n * 100) : null };
    }).filter(function (x) { return x.n > 0; });
  }

  function scoreBuckets(p) {
    var line = passLine(p);
    var b = [
      { label: '不及格', min: -1, max: line - 1, n: 0, fail: true },
      { label: line + '~' + Math.round((line + 100) / 2 - 1), min: line, max: Math.round((line + 100) / 2 - 1), n: 0 },
      { label: Math.round((line + 100) / 2) + '~100', min: Math.round((line + 100) / 2), max: 999, n: 0 }
    ];
    var scores = p.records.filter(function (r) { return r.status === 'done' && r.score != null; })
      .map(function (r) { return r.score; });
    b.forEach(function (x) {
      x.n = scores.filter(function (s) { return s >= x.min && s <= x.max; }).length;
    });
    return { buckets: b, scores: scores };
  }

  /* 看板的搜索词（不落库，切项目就清空） */
  var boardKw = '';

  /* 看板筛选：all 全部 | todo 待处理 | done 已完成 | fail 未通过 */
  var boardTab = 'all';
  var boardKw = '';

  function boardFilterRows(rows, p) {
    var line = passLine(p);
    return rows.filter(function (r) {
      if (boardTab === 'todo') return r.status !== 'done' || (r.score != null && r.score < line);
      if (boardTab === 'done') return r.status === 'done';
      if (boardTab === 'fail') return r.score != null && r.score < line;
      return true;
    });
  }

  function renderBoard() {
    var p = project;
    var st = stats(p);
    var rows = boardRows();
    var line = passLine(p);
    var left = daysLeft(p.dueAt);
    var html = '';

    /* ---- 还没分派人：给准备清单 ---- */
    if (!p.people.length) {
      var steps = [
        { name: '上传培训材料', desc: p.materials.length ? p.materials.length + ' 份就绪' : '还没上传', done: p.materials.length > 0, tab: 'material', act: '去上传' },
        { name: '配置考核试卷', desc: p.questions.length ? p.questions.length + ' 题 · 满分 ' + totalScore(p) + ' 分' : '还没出题', done: p.questions.length > 0, tab: 'paper', act: '去出题' },
        { name: '选择参训成员', desc: '从员工库挑人', done: false, tab: 'assign', act: '去选人' }
      ];
      html += '<div class="bd-empty">' +
        '<div class="bde-title">还没有分派任何人</div>' +
        '<div class="bde-list">' + steps.map(function (s) {
          return '<div class="bde-row' + (s.done ? ' is-done' : '') + '">' +
            '<span class="bde-mark">' + (s.done ? '✓' : '') + '</span>' +
            '<span class="bde-main"><b>' + s.name + '</b><i>' + esc(s.desc) + '</i></span>' +
            (s.done ? '<span class="bde-ok">已完成</span>'
                    : '<button class="bde-go" data-goto="' + s.tab + '">' + s.act + '</button>') +
          '</div>';
        }).join('') + '</div>' +
      '</div>';
      $('trainBody').innerHTML = html;
      return;
    }

    var todoCount = rows.filter(function (r) {
      return r.status !== 'done' || (r.score != null && r.score < line);
    }).length;
    var failCount = rows.filter(function (r) { return r.score != null && r.score < line; }).length;
    var pct = function (n) { return st.total ? (n / st.total * 100) : 0; };

    /* ---- 一行摘要 + 进度带 ---- */
    html += '<div class="bd-sum">' +
      '<div class="bds-main">' +
        '<span class="bds-n">' + st.done + '<i>/' + st.total + '</i></span>' +
        '<span class="bds-t">已完成</span>' +
      '</div>' +
      '<div class="bds-bars">' +
        '<div class="bd-track">' +
          (st.done ? '<i class="seg done" style="width:' + pct(st.done) + '%"></i>' : '') +
          (st.doing ? '<i class="seg doing" style="width:' + pct(st.doing) + '%"></i>' : '') +
        '</div>' +
        '<div class="bds-legend">' +
          '<span><i class="dot done"></i>完成 ' + st.done + '</span>' +
          '<span><i class="dot doing"></i>进行中 ' + st.doing + '</span>' +
          '<span><i class="dot todo"></i>未开始 ' + st.pending + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="bds-stats">' +
        '<div class="bds-pair"><b>' + (st.scores.length ? st.avg : '—') + '</b><i>平均分</i></div>' +
        '<div class="bds-pair"><b>' + (st.scores.length ? st.passRate + '%' : '—') + '</b><i>通过率</i></div>' +
        '<div class="bds-pair"><b>' + line + '</b><i>及格线</i></div>' +
      '</div>' +
      (left < 0 ? '<span class="bds-late">逾期 ' + Math.abs(left) + ' 天</span>' : '') +
    '</div>';

    /* ---- 筛选 + 表格 ---- */
    html += '<div class="bd-toolbar">' +
      '<div class="bt-tabs">' +
        '<button class="bt-tab' + (boardTab === 'all' ? ' is-on' : '') + '" data-bt="all">全部 <b>' + st.total + '</b></button>' +
        '<button class="bt-tab' + (boardTab === 'todo' ? ' is-on' : '') + '" data-bt="todo">待处理 <b>' + todoCount + '</b></button>' +
        '<button class="bt-tab' + (boardTab === 'done' ? ' is-on' : '') + '" data-bt="done">已完成 <b>' + st.done + '</b></button>' +
        (failCount ? '<button class="bt-tab' + (boardTab === 'fail' ? ' is-on' : '') + '" data-bt="fail">未通过 <b>' + failCount + '</b></button>' : '') +
      '</div>' +
      '<div class="bt-right">' +
        '<input class="bd-search" id="bdSearch" placeholder="搜姓名或部门" value="' + esc(boardKw) + '">' +
        '<button class="btn btn-ghost btn-sm" id="btnExportCsv">导出成绩</button>' +
      '</div>' +
    '</div>';

    var kw = boardKw.trim().toLowerCase();
    var shown = boardFilterRows(rows, p).filter(function (r) {
      if (!kw) return true;
      return (r.person.name + r.person.dept + (r.person.role || '')).toLowerCase().indexOf(kw) >= 0;
    });

    var order = { done: 0, doing: 1, pending: 2 };
    shown.sort(function (a, b) {
      var oa = order[a.status] == null ? 3 : order[a.status];
      var ob = order[b.status] == null ? 3 : order[b.status];
      if (oa !== ob) return oa - ob;
      return (b.score || 0) - (a.score || 0);
    });

    html += '<div class="bd-table-wrap"><table class="bd-table"><thead><tr>' +
      '<th>姓名</th><th>部门 / 岗位</th><th>材料</th><th>状态</th>' +
      '<th class="num">得分</th><th class="num">用时</th><th>提交时间</th><th></th>' +
    '</tr></thead><tbody>';

    if (!shown.length) {
      html += '<tr><td colspan="8" class="bd-none">这个条件下没有人</td></tr>';
    }

    shown.forEach(function (r) {
      var rs = TD.recStatus[r.status] || TD.recStatus.pending;
      var readCell = !st.matTotal ? '<span class="bdm-muted">无材料</span>'
        : (r.read >= st.matTotal ? '<span class="bdm-read is-all">' + st.matTotal + '/' + st.matTotal + '</span>'
                                 : '<span class="bdm-read">' + r.read + '/' + st.matTotal + '</span>');
      var scoreHtml = '—';
      if (r.score != null) {
        var cls = r.score >= line ? 'pass' : 'fail';
        scoreHtml = '<span class="bdm-score ' + cls + '">' + r.score + '</span>' +
          (cls === 'fail' ? '<span class="bdm-gap">差 ' + (line - r.score) + '</span>' : '');
      }
      var needNudge = r.status !== 'done' || (r.score != null && r.score < line);

      html += '<tr>' +
        '<td><b class="bdm-name">' + esc(r.person.name) + '</b></td>' +
        '<td class="bdm-dim">' + esc(r.person.dept) + ' · ' + esc(r.person.role || '') + '</td>' +
        '<td>' + readCell + '</td>' +
        '<td><span class="bd-st is-' + r.status + '">' + rs.name + '</span></td>' +
        '<td class="num">' + scoreHtml + '</td>' +
        '<td class="num bdm-muted">' + (r.used != null ? r.used + '′' : '—') + '</td>' +
        '<td class="bdm-dim">' + (r.submitAt ? r.submitAt.slice(5) : '—') + '</td>' +
        '<td class="bdm-ops">' + (needNudge
          ? '<button class="qa-btn" data-nudge="' + r.person.id + '">催办</button>'
          : '') + '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';

    /* ---- 复盘：分布 + 错题，收在下面 ---- */
    var dist = scoreBuckets(p);
    var qs = qStats(p);
    if (dist.scores.length) {
      html += '<div class="bd-foot-grid">';

      var maxN = Math.max.apply(null, dist.buckets.map(function (b) { return b.n; })) || 1;
      html += '<div class="bd-block"><div class="bdb-h">分数分布<span>' + dist.scores.length + ' 份答卷</span></div>' +
        '<div class="bd-dist">' + dist.buckets.map(function (b) {
          var h = Math.round(b.n / maxN * 100);
          return '<div class="bdd-col">' +
            '<span class="bdd-n">' + b.n + '</span>' +
            '<span class="bdd-bar' + (b.fail ? ' fail' : '') + '" style="height:' + Math.max(3, h) + '%"></span>' +
            '<span class="bdd-l">' + b.label + '</span>' +
          '</div>';
        }).join('') + '</div></div>';

      if (qs && qs.length) {
        var low = qs.slice().sort(function (a, b) { return a.pct - b.pct; }).slice(0, 4);
        html += '<div class="bd-block"><div class="bdb-h">最常答错的题<span>按正确率排</span></div>' +
          '<div class="bd-qs">' + low.map(function (x) {
            var cls = x.pct >= 75 ? 'good' : (x.pct >= 50 ? 'mid' : 'low');
            return '<div class="bdq-row">' +
              '<span class="bdq-pct ' + cls + '">' + x.pct + '%</span>' +
              '<span class="bdq-stem">' + esc(x.q.stem) + '</span>' +
            '</div>';
          }).join('') + '</div></div>';
      }

      html += '</div>';
    }

    $('trainBody').innerHTML = html;
  }


  /* =========================================================
     中栏：材料
     ========================================================= */
  function matType(name) {
    if (global.Files) return global.Files.infoOf(name);
    var e = (name.split('.').pop() || '').toLowerCase();
    if (e === 'pdf') return { cls: 'pdf', label: 'PDF', kind: 'pdf', reader: 'pdf' };
    if (['ppt', 'pptx'].indexOf(e) >= 0) return { cls: 'ppt', label: 'PPT', kind: 'ppt', reader: 'office' };
    if (['doc', 'docx'].indexOf(e) >= 0) return { cls: 'doc', label: 'DOC', kind: 'doc', reader: 'office' };
    if (['xls', 'xlsx', 'csv'].indexOf(e) >= 0) return { cls: 'xls', label: 'XLS', kind: 'xls', reader: 'office' };
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].indexOf(e) >= 0) return { cls: 'img', label: 'IMG', kind: 'img', reader: 'image' };
    return { cls: 'txt', label: (e || 'FILE').toUpperCase().slice(0, 4), kind: 'txt', reader: 'text' };
  }

  function renderMaterial() {
    var p = project;
    var html = '';

    if (!p.materials.length) {
      html += '<div class="mini-empty" style="padding:26px"><div class="me-ic">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>' +
        '</div><div class="me-t">还没有培训材料</div>' +
        '<div class="me-d">上传文档，或者加一条视频链接。</div></div>';
    } else {
      html += '<div class="mat-list">' + p.materials.map(function (m) {
        var isVideo = m.type === 'video' || !!m.url;
        var t = isVideo ? { cls: 'video', label: '视频', reader: 'video' } : matType(m.name);
        var canRead = t.reader !== 'none';
        var canGen = !isVideo && (!!m.textChars || !!m.preview);
        return '<div class="mat-item" data-mat="' + m.id + '">' +
          '<div class="mat-ic ' + t.cls + '">' + (isVideo
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 8 6 4-6 4V8Z"/></svg>'
            : t.label) + '</div>' +
          '<div class="mat-main"><div class="mat-name">' + esc(m.name) + '</div>' +
            '<div class="mat-meta"><span>' + esc(m.size) + '</span>' +
            (m.pages ? '<span>' + m.pages + ' 页</span>' : '') +
            '<span>' + (isVideo ? '视频' : '上传于 ' + esc(m.uploadedAt)) + '</span>' +
            (canGen ? '<span class="mat-ok">可出题</span>' : '') +
            '</div></div>' +
          '<div class="mat-acts">' +
            (canRead ? '<button class="qa-btn" data-mata="view" data-mat="' + m.id + '">预览</button>' : '') +
            (canGen ? '<button class="qa-btn go" data-mata="quiz" data-mat="' + m.id + '">用它出题</button>' : '') +
            '<button class="qa-btn" data-mata="rename" data-mat="' + m.id + '">重命名</button>' +
            '<button class="qa-btn del" data-mata="del" data-mat="' + m.id + '">删除</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    html += '<div class="mat-add">' +
      '<div class="mat-drop" id="matDrop">' +
        '<div class="md-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5-5 5 5M12 5v12"/></svg></div>' +
        '<div class="md-t">拖入或点击上传</div>' +
        '<div class="md-d">PDF / PPT / Word / Excel / 图片 / 视频，单个不超过 100 MB</div>' +
      '</div>' +
      '<button class="mat-link" id="matVideoLink">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m10 8 6 4-6 4V8Z"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>' +
        '<span><b>视频链接</b><i>大文件不走上传，贴钉钉云盘或内网地址</i></span>' +
      '</button>' +
    '</div><input type="file" id="matFileInput" multiple hidden accept="' + (global.Files ? global.Files.ACCEPT : '.pdf,.pptx,.docx') + '">';

    $('trainBody').innerHTML = html;
  }

  function matId() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  /** 视频用外链：大文件不进浏览器存储，学员端直接播放这个地址 */
  function saveVideoLink() {
    var name = $('mvName').value.trim();
    var url = $('mvUrl').value.trim();
    if (!url) { $('mvErr').textContent = '贴一个能直接播的视频地址'; $('mvUrl').focus(); return; }
    if (!/^(https?:\/\/|\/\/)/i.test(url)) { $('mvErr').textContent = '地址要以 http:// 或 https:// 开头'; $('mvUrl').focus(); return; }
    if (!name) name = '培训视频.mp4';

    var d = new Date();
    project.materials.push({
      id: matId(),
      name: name,
      type: 'video',
      size: '外链',
      pages: 0,
      uploadedAt: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
      views: 0,
      hasFile: false,
      url: url,
      textChars: 0
    });
    persist();
    if (global.App && global.App.closeModal) global.App.closeModal('matVideoModal');
    renderMaterial(); renderHead();
    toast('视频已加入材料');
  }

  function addMaterials(files) {
    var list = Array.prototype.slice.call(files);
    if (!list.length) return;

    var added = 0, skipped = 0;
    var slots = list.map(function () { return null; });
    var jobs = list.map(function (f, idx) {
      var t = matType(f.name);
      if (f.size > 100 * 1024 * 1024) {
        skipped++;
        toast(f.name + ' 超过 100 MB，建议压缩后再传', 'err');
        return Promise.resolve();
      }
      if (t.reader === 'none') {
        skipped++;
        toast(f.name + ' 这类格式不支持，请转成 PDF 或 PPT', 'err');
        return Promise.resolve();
      }
      var id = matId();
      var d = new Date();
      return global.Files.put(id, f).then(function (info) {
        slots[idx] = {
          id: id,
          name: f.name,
          type: t.kind,
          size: global.Files.fmtSize(f.size),
          pages: info.pages || 0,
          uploadedAt: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
          views: 0,
          hasFile: true,
          textChars: (info.text || '').length
        };
        added++;
      })['catch'](function (err) {
        skipped++;
        console.error('[material]', err);
      });
    });

    toast('正在解析文件…');
    Promise.all(jobs).then(function () {
      // 按上传顺序入列
      slots.forEach(function (m) { if (m) project.materials.push(m); });
      persist();
      renderMaterial();
      renderHead();
      renderProjectList();
      renderDocPick();
      if (added) {
        var noText = project.materials.slice(-added).filter(function (m) { return !m.textChars; }).length;
        toast('已添加 ' + added + ' 份材料' + (skipped ? '，' + skipped + ' 份跳过' : ''));
        if (noText) {
          setTimeout(function () {
            toast('有 ' + noText + ' 份材料提取不到文字（PDF 常见），员工可在线阅读；出题请用 PPT/Word 或直接粘贴文本');
          }, 900);
        }
      } else {
        toast('没有可用的材料', 'err');
      }
    });
  }

  /* =========================================================
     中栏：试卷
     ========================================================= */
  function renderPaperTab() {
    var p = project;
    if (!p.questions.length) {
      $('trainBody').innerHTML = '<div class="mini-empty" style="padding:40px"><div class="me-ic">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
        '</div><div class="me-t">还没配置考核试卷</div>' +
        '<div class="me-d">在右侧「考核出题」面板选材料生成试题，生成后这里会显示完整试卷。</div></div>';
      return;
    }
    renderPaperBody();
  }

  /* =========================================================
     通知辅助：变量 / 规则 / 收件人
     ========================================================= */
  var MAIL_VARS = ['姓名', '部门', '培训名称', '材料数量', '题目数量', '总分', '及格分', '截止时间', '剩余天数', '时长', '进度', '成绩', '通过状态', '用时', '提交时间', '结果提示', '链接'];

  function ruleByKey(key) {
    return project.rules.find(function (r) { return r.key === key; });
  }

  function templateForRule(key) {
    if (key === 'invite') return project.templates.invite;
    if (key === 'remind3' || key === 'remind1') return project.templates.remind;
    if (key === 'urge') return project.templates.urge;
    if (key === 'result') return project.templates.result;
    return project.templates.invite;
  }

  function fillVars(text, person) {
    var p = project;
    var st = stats(p);
    var rec = p.records.find(function (r) { return r.pid === person.id; });
    var left = daysLeft(p.dueAt);
    var rs = rec ? (TD.recStatus[rec.status] || TD.recStatus.pending) : TD.recStatus.pending;

    var map = {
      '{{姓名}}': person.name,
      '{{部门}}': person.dept,
      '{{培训名称}}': p.title,
      '{{材料数量}}': String(p.materials.length),
      '{{题目数量}}': String(p.questions.length),
      '{{总分}}': String(totalScore(p)),
      '{{及格分}}': String(passLine(p)),
      '{{截止时间}}': p.dueAt,
      '{{剩余天数}}': String(Math.max(0, left)),
      '{{时长}}': String(p.duration),
      '{{进度}}': rs.name,
      '{{成绩}}': rec && rec.score != null ? String(rec.score) : '—',
      '{{通过状态}}': rec && rec.score != null ? (rec.score >= passLine(p) ? '通过' : '未通过') : '未出分',
      '{{用时}}': rec && rec.used != null ? rec.used + ' 分钟' : '—',
      '{{提交时间}}': rec && rec.submitAt ? rec.submitAt : '—',
      '{{结果提示}}': rec && rec.score != null
        ? (rec.score >= passLine(p) ? '恭喜通过考核，无需其他操作。' : '本次未达到及格线，可在截止前重新作答。')
        : '',
      '{{链接}}': 'https://learn.example.com/train/' + p.id
    };

    var out = text;
    Object.keys(map).forEach(function (k) { out = out.split(k).join(map[k]); });
    return out;
  }

  function audienceList() {
    var mode = audienceMode();
    var only = (S.mailTo && S.mailTo.length) ? S.mailTo : null;
    return project.people.map(function (id) { return TD.personById(id); }).filter(Boolean).filter(function (x) {
      if (only && only.indexOf(x.id) < 0) return false;
      var rec = project.records.find(function (r) { return r.pid === x.id; });
      var done = rec && rec.status === 'done';
      if (mode === 'done') return done;
      if (mode === 'undone') return !done;
      return true;
    });
  }

  /* =========================================================
     中栏：分派与通知
     一个页面做完三件事：选谁 → 写什么 → 发出去
     ========================================================= */
  var AUD_DEFAULT = { invite: 'all', remind3: 'undone', remind1: 'undone', urge: 'undone', result: 'done' };

  /** 某套模板当前的收件人范围：用户改过就用改过的，否则用模板默认 */
  function audienceMode() {
    var key = S.mailRuleKey || 'invite';
    var saved = S.mailAud && S.mailAud[key];
    return saved || AUD_DEFAULT[key] || 'all';
  }

  function setAudience(key, mode) {
    if (!S.mailAud) S.mailAud = {};
    S.mailAud[key] = mode;
  }

  function deptGroups() {
    var g = {};
    TD.people.forEach(function (x) {
      if (!g[x.dept]) g[x.dept] = [];
      g[x.dept].push(x);
    });
    return Object.keys(g).map(function (k) { return { dept: k, list: g[k] }; });
  }

  function renderAssignPeople() {
    var p = project;
    var sel = {};
    p.people.forEach(function (id) { sel[id] = true; });
    var groups = deptGroups();

    var h = '<div class="asg-people">';
    groups.forEach(function (g) {
      var chosen = g.list.filter(function (x) { return sel[x.id]; }).length;
      var allOn = chosen === g.list.length;
      h += '<div class="asgp-dept">' +
        '<div class="asgp-head"><span class="asgp-name">' + esc(g.dept) + '</span>' +
          '<span class="asgp-n">' + chosen + '/' + g.list.length + '</span>' +
          '<button class="asgp-all' + (allOn ? ' is-on' : '') + '" data-dept="' + esc(g.dept) + '">' +
            (allOn ? '取消全部' : '全选') + '</button>' +
        '</div>' +
        '<div class="asgp-list">' + g.list.map(function (x) {
          var on = !!sel[x.id];
          return '<button class="asgp-chip' + (on ? ' is-on' : '') + '" data-person="' + x.id + '">' +
            '<span class="asgp-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>' +
            '<span class="asgp-txt"><b>' + esc(x.name) + '</b><i>' + esc(x.role || '') + '</i></span>' +
          '</button>';
        }).join('') + '</div>' +
      '</div>';
    });
    h += '</div>';

    var host = $('asgPeople');
    if (host) host.innerHTML = h;
    syncAssignSummary();
  }

  function syncAssignSummary() {
    var p = project;
    var aud = audienceList();
    var n = p.people.length;
    var sum = $('asgSum');
    if (sum) {
      sum.innerHTML = n
        ? '<b>' + n + '</b> 人参加 · 本次通知发给 <b>' + aud.length + '</b> 人'
        : '<span class="asg-warn">还没选人，选了才能分派</span>';
    }
    var sendBtn = $('btnSendMail');
    if (sendBtn) {
      sendBtn.disabled = !aud.length;
      sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>' +
        (aud.length ? '发给这 ' + aud.length + ' 人' : '先选人');
    }
  }

  function renderAssign() {
    var p = project;
    var key = S.mailRuleKey || 'invite';
    var rule = ruleByKey(key) || p.rules[0];
    if (!rule) { key = 'invite'; rule = p.rules[0]; }
    if (!rule) return;
    var tpl = templateForRule(rule.key);
    var audMode = audienceMode();
    var aud = audienceList();
    var sample = aud[0] || TD.people[0];

    var html = '<div class="asg">';

    /* ---- 1. 谁参加 ---- */
    var newHireCount = TD.people.filter(function (x) {
      return global.Staff && global.Staff.isNewHire(x);
    }).length;

    html += '<div class="asg-sec">' +
      '<div class="asg-h"><span class="asgh-t">谁要参加</span>' +
        '<span class="asgh-d" id="asgSum"></span>' +
        '<span class="asgh-gap"></span>' +
        (newHireCount ? '<button class="btn-text" data-pick="new">新入职 ' + newHireCount + ' 人</button>' : '') +
        '<button class="btn-text" data-pick="all">全部 ' + TD.people.length + ' 人</button>' +
        '<button class="btn-text" data-pick="none">清空</button>' +
      '</div>' +
      '<label class="asg-auto">' +
        '<input type="checkbox" id="asgAutoJoin"' + (p.autoJoin ? ' checked' : '') + '>' +
        '<span>之后入职的新员工自动加入这个项目</span>' +
        '<i>' + (p.autoJoin ? '已开启 · 当前 ' + newHireCount + ' 位新入职' : '临时培训保持关闭，手动挑人') + '</i>' +
      '</label>' +
      '<div id="asgPeople"></div>' +
    '</div>';

    /* ---- 2. 发什么通知 ---- */
    html += '<div class="asg-sec">' +
      '<div class="asg-h"><span class="asgh-t">发什么通知</span></div>' +

      '<div class="asg-rules">' + p.rules.map(function (r) {
        return '<button class="asgr' + (r.key === key ? ' is-on' : '') + '" data-rule="' + r.key + '">' +
          '<b>' + esc(r.name) + '</b><i>' + esc(r.desc) + '</i>' +
          (r.sent ? '<span class="asgr-sent">已发 ' + r.sent + ' 封</span>' : '') +
        '</button>';
      }).join('') + '</div>' +

      '<div class="asg-editor">' +
        '<div class="asge-row">' +
          '<label for="mailSubject">主题</label>' +
          '<input class="input" id="mailSubject" value="' + esc(tpl.subject) + '">' +
        '</div>' +
        '<div class="asge-row">' +
          '<label for="mailBody">正文</label>' +
          '<textarea class="input" id="mailBody">' + esc(tpl.body) + '</textarea>' +
          '<div class="asge-vars">' + MAIL_VARS.map(function (v) {
            return '<button class="var-chip" data-var="' + v + '">{{' + v + '}}</button>';
          }).join('') + '</div>' +
        '</div>' +

        '<div class="asge-aud">' +
          '<span class="asgea-label">这次发给</span>' +
          '<div class="asgea-chips">' +
            '<button class="chip' + (audMode === 'all' ? ' is-on' : '') + '" data-aud="all">参加的全部人</button>' +
            '<button class="chip' + (audMode === 'undone' ? ' is-on' : '') + '" data-aud="undone">还没交卷的</button>' +
            '<button class="chip' + (audMode === 'done' ? ' is-on' : '') + '" data-aud="done">已交卷的</button>' +
          '</div>' +
        '</div>' +

        '<details class="asge-pv">' +
          '<summary>看一眼收到的样子' + (sample ? '（示例：' + esc(sample.name) + '）' : '') + '</summary>' +
          '<div class="mail-preview">' +
            '<div class="mp-head"><b>主题：</b>' + esc(fillVars(tpl.subject, sample)) + '</div>' +
            '<div class="mp-body">' + esc(fillVars(tpl.body, sample)) + '</div>' +
          '</div>' +
        '</details>' +

        '<div class="asg-send">' +
          '<button class="btn btn-primary" id="btnSendMail">发给这 0 人</button>' +
          '<span class="asg-send-side">' +
            '<button class="btn-text" id="btnCopyMail">复制正文</button>' +
            '<button class="btn-text" id="btnExportEml">导出 .eml</button>' +
            '<button class="btn-text" id="btnExportMailList">导出名单</button>' +
          '</span>' +
        '</div>' +
      '</div>' +
    '</div>';

    /* ---- 3. 发送记录 ---- */
    html += '<div class="asg-sec asg-log">' +
      '<div class="asg-h"><span class="asgh-t">发过什么</span>' +
        '<span class="asgh-d">' + (p.mailLog.length ? '最近 ' + Math.min(8, p.mailLog.length) + ' 条' : '还没有记录') + '</span></div>';
    if (!p.mailLog.length) {
      html += '<div class="asg-log-empty">分派之后，每次发送都会记在这里。</div>';
    } else {
      html += '<div class="asg-log-list">' + p.mailLog.slice(0, 8).map(function (l) {
        return '<div class="asgl-row">' +
          '<span class="asgl-t">' + esc(l.rule) + '</span>' +
          '<span class="asgl-n">' + l.count + ' 人</span>' +
          '<span class="asgl-time">' + esc(l.time) + '</span>' +
          '<span class="asgl-note">' + esc(l.note || '') + '</span>' +
        '</div>';
      }).join('') + '</div>';
    }
    html += '</div>';

    html += '</div>';

    $('trainBody').innerHTML = html;
    renderAssignPeople();
    if (aud.length) syncAssignSummary();
  }


  function sendMail(ruleName, count, note) {
    var d = new Date();
    var time = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
      ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (!project.mailLog) project.mailLog = [];
    project.mailLog.unshift({ rule: ruleName, count: count, note: note || '', time: time });
    var r = project.rules.find(function (x) { return x.name === ruleName; });
    if (r) r.sent = (r.sent || 0) + count;
    persist();
  }

  /* =========================================================
     渲染调度
     ========================================================= */
  function renderTrain() {
    if (!project) return;
    renderProjectList();
    renderHead();

    var tab = S.trainTab || 'board';
    if (['board', 'material', 'paper', 'assign'].indexOf(tab) < 0) tab = 'board';

    // 出题助手只在「试卷」页出现，其他页面中栏铺满
    var withBuilder = tab === 'paper';
    document.querySelector('.train-panel').classList.toggle('no-builder', !withBuilder);
    var shellT = $('shellTrain');
    if (shellT) shellT.classList.toggle('has-builder', withBuilder);
    var builder = $('trainBuilder');
    if (builder) builder.classList.toggle('is-on', withBuilder);

    if (tab === 'board') renderBoard();
    else if (tab === 'material') renderMaterial();
    else if (tab === 'paper') renderPaperTab();
    else if (tab === 'assign') renderAssign();

    if (withBuilder) renderTrainBuilder();
  }

  /* ---------- 试卷正文（可展开改题） ---------- */
  function renderPaperBody() {
    var qs = project.questions || [];
    var body = $('trainBody');
    if (!body) return;

    var html = '<div class="quickedit">';

    if (!qs.length) {
      html += '<div class="mini-empty" style="padding:38px"><div class="me-ic">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
        '</div><div class="me-t">还没有试题</div>' +
        '<div class="me-d">在右侧「考核出题」里选材料生成，或者手动加一道。</div>' +
        '<button class="btn btn-ghost btn-sm" id="qeAdd" style="margin-top:14px">手动加一题</button></div>';
      html += '</div>';
      body.innerHTML = html;
      refreshQuickEditState();
      return;
    }

    html += '<div class="paper-bar">' +
      '<span class="pb-text">共 <b>' + qs.length + '</b> 题，满分 <b>' + totalScore(project) + '</b> 分，' +
        '及格线 <b>' + passLine(project) + '</b> 分</span>' +
      '<span class="pb-gap"></span>' +
      '<button class="btn btn-ghost btn-sm" id="qeAdd">加一题</button>' +
    '</div>';

    html += '<div class="qe-list">';
    qs.forEach(function (q, i) {
      var t = C.TYPE_MAP[q.type];
      var open = S.trainQOpenId === q.id;
      var ansArr = Array.isArray(q.answer) ? q.answer : [q.answer];

      var fields = '<div class="f-mini"><div class="f-lab">题干</div>' +
        '<textarea class="f-txt" data-qid="' + q.id + '" data-f="stem" style="min-height:64px">' + C.esc(q.stem) + '</textarea></div>';

      if (t.hasOptions) {
        fields += '<div class="f-mini"><div class="f-lab">选项 <span class="f-lab-hint">点字母改答案</span></div>' +
          q.options.map(function (o) {
            var ok = ansArr.indexOf(o.key) >= 0;
            return '<div class="opt-line' + (ok ? ' is-ans' : '') + '">' +
              '<button class="opt-key" data-qid="' + q.id + '" data-qa="mark" data-key="' + o.key + '">' + o.key + '</button>' +
              '<input class="f-inp" data-qid="' + q.id + '" data-f="option" data-key="' + o.key + '" value="' + C.esc(o.text) + '">' +
            '</div>';
          }).join('') + '</div>';
      } else if (q.type === 'judge') {
        var isT = /正确|对|^A$/.test(String(q.answer));
        fields += '<div class="f-mini"><div class="f-lab">正确答案</div><div class="judge-pick">' +
          '<button class="jp-btn' + (isT ? ' on-t' : '') + '" data-qid="' + q.id + '" data-qa="judge" data-val="正确">正确</button>' +
          '<button class="jp-btn' + (!isT ? ' on-f' : '') + '" data-qid="' + q.id + '" data-qa="judge" data-val="错误">错误</button>' +
        '</div></div>';
      } else {
        fields += '<div class="f-mini"><div class="f-lab">参考答案</div>' +
          '<textarea class="f-txt" data-qid="' + q.id + '" data-f="answer" style="min-height:52px">' + C.esc(q.answer) + '</textarea></div>';
      }

      fields += '<div class="f-mini"><div class="grid2" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div><div class="f-lab">难度</div><select class="f-sel" data-qid="' + q.id + '" data-f="difficulty">' +
          C.DIFFS.map(function (d) {
            return '<option value="' + d.key + '"' + (q.difficulty === d.key ? ' selected' : '') + '>' + d.name + '</option>';
          }).join('') + '</select></div>' +
        '<div><div class="f-lab">分值</div><input class="f-inp" type="number" min="0" data-qid="' + q.id + '" data-f="score" value="' + q.score + '"></div>' +
      '</div></div>';

      fields += '<div class="qc-acts" style="margin-top:10px">' +
        '<button class="qa-btn del" data-qid="' + q.id + '" data-qa="del">删除这题</button>' +
      '</div>';

      html += '<div class="qe-item' + (open ? ' is-on' : '') + '" data-qid="' + q.id + '">' +
        '<div class="qe-head" data-qa="toggle" data-qid="' + q.id + '">' +
          '<span class="qe-no">' + (i + 1) + '</span>' +
          '<div class="qe-main">' +
            '<div class="qc-tags"><span class="qc-type qt-' + q.type + '">' + t.name + '</span>' +
            '<span class="qc-diff d-' + q.difficulty + '">' + (C.DIFF_MAP[q.difficulty] || C.DIFF_MAP.medium).name + '</span>' +
            '<span class="qc-score">' + q.score + ' 分</span></div>' +
            '<div class="qe-stem">' + C.esc(q.stem) + '</div>' +
          '</div>' +
          '<span class="qe-edit">' + (open ? '收起' : '改这题') + '</span>' +
        '</div>' +
        '<div class="qe-body">' + fields + '</div>' +
      '</div>';
    });
    html += '</div></div>';

    body.innerHTML = html;
    refreshQuickEditState();
  }

  function refreshQuickEditState() {
    var qs = project.questions || [];
    var c = $('trainFootCount'), s = $('trainFootScore');
    if (c) c.textContent = qs.length;
    if (s) s.textContent = totalScore(project);
    var ex = $('trainBtnExport');
    if (ex) ex.style.display = '';
  }

  /** 学员端联动刷新 */
  function refreshStudentPreview() { /* 预览已改为独立模块，无需联动 */ }

  /* =========================================================
     右栏：出题面板
     ========================================================= */
  function renderDocPick() {
    var mats = project ? project.materials : [];
    var box = $('trainDocList');
    if (!box) return;

    if (!mats.length) {
      box.innerHTML = '<div style="font-size:13.5px;color:var(--ink-4);line-height:1.7;padding:8px 0">' +
        '这个培训还没有材料。去「培训材料」上传，或切到「粘贴 / 上传」直接给文本。</div>';
      return;
    }

    box.className = 'doc-pick';
    box.innerHTML = mats.map(function (m) {
      var on = !!docPick[m.id];
      var canGen = !!(m.textChars || m.preview);
      return '<button class="dp-item' + (on ? ' is-on' : '') + (canGen ? '' : ' is-notext') +
          '" data-doc="' + m.id + '" data-notext="' + (canGen ? '0' : '1') + '">' +
        '<span class="dp-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>' +
        '<span class="dp-name">' + esc(m.name) + '</span>' +
        '<span class="dp-size">' + (canGen ? esc(m.size) : '无文字') + '</span>' +
      '</button>';
    }).join('');
  }

  /** 同步估算素材字数，用于按钮可用状态 */
  function sourceChars() {
    if (trainSrcMode === 'paste') return C.countChars(trainPasteText);
    if (trainSrcMode === 'file') return C.countChars(trainFileText);
    return (project.materials || []).reduce(function (sum, m) {
      if (!docPick[m.id]) return sum;
      return sum + (m.textChars || (m.preview ? m.preview.length : 0));
    }, 0);
  }

  /** 取选中材料的文字，返回 Promise */
  function pickedMaterialText() {
    var picked = (project.materials || []).filter(function (m) { return docPick[m.id]; });
    if (!picked.length) return Promise.resolve('');
    return Promise.all(picked.map(function (m) {
      if (m.preview) return m.preview;
      if (!m.hasFile) return '';
      return global.Files.text(m.id);
    })).then(function (arr) {
      return arr.filter(function (x) { return x && x.trim(); }).join('\n\n');
    });
  }

  function trainSourceText() {
    if (trainSrcMode === 'paste') return Promise.resolve(trainPasteText);
    if (trainSrcMode === 'file') return Promise.resolve(trainFileText);
    return pickedMaterialText();
  }

  function renderTrainTypeRows() {
    var counts = trainCounts();
    var colors = {
      single: ['var(--indigo-soft)', 'var(--indigo-d)'],
      multi: ['var(--teal-soft)', '#06796F'],
      judge: ['var(--amber-soft)', '#855002'],
      blank: ['#F0EBFF', '#5B32C4'],
      essay: ['var(--rose-soft)', '#9B2043']
    };
    $('trainTypeRows').innerHTML = C.TYPES.map(function (t) {
      var v = Number(counts[t.key]) || 0;
      var c = colors[t.key];
      return '<div class="type-row' + (v > 0 ? ' has-val' : '') + '" data-type="' + t.key + '">' +
        '<span class="tr-badge" style="background:' + c[0] + ';color:' + c[1] + '">' + t.badge + '</span>' +
        '<span class="tr-name">' + t.name + '</span>' +
        '<span class="tr-max">' + t.score + '分</span>' +
        '<span class="stepper">' +
          '<button class="st-btn" data-act="dec"' + (v <= 0 ? ' disabled' : '') + '>−</button>' +
          '<input class="st-val" type="number" min="0" max="40" value="' + v + '" data-in="' + t.key + '">' +
          '<button class="st-btn" data-act="inc"' + (v >= 40 ? ' disabled' : '') + '>+</button>' +
        '</span>' +
      '</div>';
    }).join('');
    $('trainTotalPill').textContent = Object.keys(counts).reduce(function (s, k) { return s + (Number(counts[k]) || 0); }, 0);
  }

  var _trainCounts = { single: 5, multi: 3, judge: 3, blank: 2, essay: 1 };
  var _trainDiff = { easy: 30, medium: 50, hard: 20 };
  function trainCounts() { return _trainCounts; }

  function renderTrainDiff() {
    $$('#trainDiffChips .dchip').forEach(function (b) {
      var k = b.dataset.d;
      b.textContent = (k === 'easy' ? '简单 ' : k === 'medium' ? '中等 ' : '困难 ') + _trainDiff[k] + '%';
    });
  }

  function renderTrainQs() {
    var qs = project ? project.questions : [];
    $('trainQCount').textContent = qs.length;
    $('trainFootCount').textContent = qs.length;
    $('trainFootScore').textContent = totalScore(project || { questions: [] });

    if (!qs.length) {
      $('trainQWrap').classList.add('hidden');
      $('trainQEmpty').classList.remove('hidden');
      return;
    }
    $('trainQWrap').classList.remove('hidden');
    $('trainQEmpty').classList.add('hidden');

    $('trainQList').innerHTML = qs.map(function (q, i) {
      var t = C.TYPE_MAP[q.type];
      var d = C.DIFF_MAP[q.difficulty] || C.DIFF_MAP.medium;
      var open = S.trainQOpenId === q.id;
      var ansArr = Array.isArray(q.answer) ? q.answer : [q.answer];

      var opts = '';
      if (t.hasOptions) {
        opts = '<div class="f-mini"><div class="f-lab">选项</div>' +
          q.options.map(function (o) {
            var ok = ansArr.indexOf(o.key) >= 0;
            return '<div class="opt-line' + (ok ? ' is-ans' : '') + '">' +
              '<span class="opt-key">' + o.key + '</span>' +
              '<span style="flex:1;font-size:13.5px;line-height:1.6;color:' + (ok ? '#0A6B45' : 'var(--ink-2)') + '">' +
              esc(o.text) + '</span></div>';
          }).join('') + '</div>';
      } else {
        opts = '<div class="f-mini"><div class="f-lab">参考答案</div>' +
          '<div style="font-size:13.5px;line-height:1.65;color:#0A6B45;background:var(--green-soft);padding:8px 11px;border-radius:7px">' +
          esc(String(q.answer || '').replace(/\n/g, '；')) + '</div></div>';
      }

      return '<div class="qcard' + (open ? ' is-open' : '') + '" data-tq="' + q.id + '">' +
        '<div class="qc-head" data-ta="toggle" data-id="' + q.id + '">' +
          '<span class="qc-no">' + (i + 1) + '</span>' +
          '<div class="qc-main">' +
            '<div class="qc-tags">' +
              '<span class="qc-type qt-' + q.type + '">' + t.name + '</span>' +
              '<span class="qc-diff d-' + q.difficulty + '">' + d.name + '</span>' +
              '<span class="qc-score">' + q.score + ' 分</span>' +
            '</div>' +
            '<div class="qc-stem">' + esc(q.stem) + '</div>' +
          '</div>' +
          '<span class="qc-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>' +
        '</div>' +
        '<div class="qc-edit">' + opts +
          '<div class="qc-acts">' +
            '<button class="qa-btn" data-ta="del" data-id="' + q.id + '">删除</button>' +
            '<span class="qa-spacer"></span>' +
            '<span style="font-size:13px;color:var(--ink-4)">按题型排序后导出</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function refreshTrainGen() {
    var chars = sourceChars();
    var total = Object.keys(_trainCounts).reduce(function (s, k) { return s + (Number(_trainCounts[k]) || 0); }, 0);
    var ok = total > 0 && chars >= 60;

    $('trainGenLabel').textContent = total ? '生成 ' + total + ' 道题' : '生成试题';
    $('trainBtnGen').disabled = !ok || busy;

    var hint = $('trainGenHint');
    var useAI = S.llm && S.llm.on && S.llm.key && S.llm.base && S.llm.model;
    var cap = Math.floor(chars / 50);

    if (trainSrcMode === 'material' && !Object.keys(docPick).some(function (k) { return docPick[k]; })) {
      hint.textContent = '先勾选至少一份培训材料';
      hint.style.color = 'var(--amber)';
    } else if (chars < 60) {
      hint.textContent = trainSrcMode === 'material'
        ? '选中的材料没有可提取的文字，改用「粘贴」'
        : '资料太短，至少 60 字';
      hint.style.color = 'var(--amber)';
    } else if (!total) {
      hint.textContent = '至少选一种题型';
      hint.style.color = 'var(--amber)';
    } else if (total > cap) {
      hint.textContent = '这份资料约够 ' + cap + ' 题，当前要 ' + total + ' 题，可能少出';
      hint.style.color = 'var(--amber)';
    } else {
      hint.textContent = useAI ? '将调用 ' + S.llm.model : '将用本地引擎出题';
      hint.style.color = 'var(--ink-4)';
    }

    $('trainAiSetup').classList.toggle('hidden', !!useAI);
  }

  function renderTrainBuilder() {
    renderDocPick();
    renderTrainTypeRows();
    renderTrainDiff();
    renderTrainQs();
    refreshTrainGen();
  }

  /* =========================================================
     学员答题端
     ========================================================= */
  /* =========================================================
     弹窗辅助
     ========================================================= */
  function openModal(id) {
    $('overlay').classList.add('is-on');
    $(id).classList.add('is-on');
  }

  /* =========================================================
     事件绑定
     ========================================================= */
  function bind() {
    /* 项目切换 */
    $('tpList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-proj]');
      if (!b) return;
      S.activeProjectId = b.dataset.proj;
      project = S.projects.find(function (p) { return p.id === S.activeProjectId; });
      docPick = {};
      S.trainQOpenId = null;
      boardKw = '';
      persist();
      renderTrain();
    });

    /* ---- 看板：筛选 / 搜索 ---- */
    $('trainBody').addEventListener('input', function (e) {
      if (e.target && e.target.id === 'bdSearch') {
        boardKw = e.target.value;
        renderBoard();
        var box = $('bdSearch');
        if (box) {
          box.focus();
          box.selectionStart = box.selectionEnd = box.value.length;
        }
      }
    });

    $('trainTabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      S.trainTab = b.dataset.tab;
      S.trainQOpenId = null;
      persist();
      renderHead();
      renderTrain();
    });

    /* 试卷改题（委托在 trainBody 上，重渲染不失效） */
    function bindPaperEdit() {
      var body = $('trainBody');
      if (!body) return;

      body.addEventListener('click', function (e) {
        var b = e.target.closest('[data-qa]');
        if (b) {
          var act = b.dataset.qa;
          var qid = b.dataset.qid;
          var q = project.questions.find(function (x) { return x.id === qid; });
          if (!q) return;

          if (act === 'toggle') {
            S.trainQOpenId = S.trainQOpenId === qid ? null : qid;
            renderPaperBody();
            return;
          }
          if (act === 'mark') {
            var key = b.dataset.key;
            if (C.TYPE_MAP[q.type].multi) {
              var arr = Array.isArray(q.answer) ? q.answer.slice() : [];
              var i = arr.indexOf(key);
              if (i >= 0) { if (arr.length > 1) arr.splice(i, 1); }
              else arr.push(key);
              q.answer = arr.sort();
            } else q.answer = key;
            persist();
            S.trainQOpenId = qid;
            renderPaperBody();
            return;
          }
          if (act === 'judge') {
            q.answer = b.dataset.val;
            persist();
            S.trainQOpenId = qid;
            renderPaperBody();
            return;
          }
          if (act === 'del') {
            if (!confirm('删除这道题？')) return;
            project.questions = project.questions.filter(function (x) { return x.id !== qid; });
            persist();
            renderPaperBody();
            renderHead(); renderProjectList();
            toast('已删除');
            return;
          }
          return;
        }

        if (e.target.closest('#qeAdd')) {
          var nq = C.makeQuestion('single');
          nq.point = project.title;
          project.questions.push(nq);
          S.trainQOpenId = nq.id;
          persist();
          renderPaperBody();
          renderHead(); renderProjectList();
          toast('已添加空题');
        }
      });

      body.addEventListener('input', function (e) {
        var el = e.target;
        var qid = el.dataset.qid, f = el.dataset.f;
        if (!qid || !f) return;
        var q = project.questions.find(function (x) { return x.id === qid; });
        if (!q) return;

        if (f === 'option') {
          var o = q.options.find(function (x) { return x.key === el.dataset.key; });
          if (o) o.text = el.value;
        } else if (f === 'score') {
          q.score = Number(el.value) || 0;
          var fs = $('trainFootScore');
          if (fs) fs.textContent = totalScore(project);
        } else {
          q[f] = el.value;
          if (f === 'stem') {
            var card = el.closest('.qe-item');
            var st = card && card.querySelector('.qe-stem');
            if (st) st.textContent = q.stem || '（题干为空）';
          }
        }
        persist();
      });

      body.addEventListener('change', function (e) {
        var el = e.target;
        var qid = el.dataset.qid, f = el.dataset.f;
        if (qid && f === 'difficulty') {
          var q = project.questions.find(function (x) { return x.id === qid; });
          if (q) { q.difficulty = el.value; persist(); }
        }
      });
    }
    bindPaperEdit();

    $('trainBody').addEventListener('click', function (e) {
      // 材料操作
      var ma = e.target.closest('[data-mata]');
      if (ma) {
        var mid = ma.dataset.mat;
        var m = project.materials.find(function (x) { return x.id === mid; });
        if (!m) return;
        if (ma.dataset.mata === 'view') {
          if (global.Reader) {
            global.Reader.open(m, {
              onRead: function () { m.views = (m.views || 0) + 1; }
            });
          }
          return;
        }
        if (ma.dataset.mata === 'del') {
          if (!confirm('删除材料「' + m.name + '」？')) return;
          project.materials = project.materials.filter(function (x) { return x.id !== mid; });
          delete docPick[mid];
          if (global.Files) global.Files.remove(mid);
          persist(); renderMaterial(); renderHead(); renderProjectList(); renderDocPick();
          toast('已删除材料');
        } else if (ma.dataset.mata === 'rename') {
          var nn = prompt('新的材料名称', m.name);
          if (nn && nn.trim()) { m.name = nn.trim(); persist(); renderMaterial(); renderDocPick(); }
        } else if (ma.dataset.mata === 'quiz') {
          // 拿这份材料去出题：切到试卷页，右栏预选这份材料
          docPick = {};
          docPick[m.id] = true;
          trainSrcMode = 'material';
          S.trainTab = 'paper';
          S.trainQOpenId = null;
          persist(); renderHead(); renderTrain();
          var b = $('trainBtnGen');
          if (b) b.scrollIntoView({ block: 'center' });
          toast('已选好「' + m.name + '」，点生成试题');
        }
        return;
      }

      var drop = e.target.closest('#matDrop');
      if (drop) { var fi = $('matFileInput'); if (fi) fi.click(); return; }

      if (e.target.closest('#matVideoLink')) {
        $('mvName').value = '';
        $('mvUrl').value = '';
        $('mvErr').textContent = '';
        if (global.App && global.App.openModal) global.App.openModal('matVideoModal');
        setTimeout(function () { $('mvName').focus(); }, 120);
        return;
      }

      /* ---- 看板：跳转到准备步骤 ---- */
      var goto = e.target.closest('[data-goto]');
      if (goto) {
        S.trainTab = goto.dataset.goto;
        persist(); renderHead(); renderTrain();
        return;
      }

      /* ---- 看板筛选 ---- */
      var bt = e.target.closest('[data-bt]');
      if (bt) {
        boardTab = bt.dataset.bt;
        renderBoard();
        return;
      }

      /* ---- 催办：单人或全部 ---- */
      var nudge = e.target.closest('[data-nudge]');
      if (nudge) {
        var who = TD.personById(nudge.dataset.nudge);
        S.mailRuleKey = 'urge';
        setAudience('urge', 'undone');
        S.mailTo = [nudge.dataset.nudge];
        S.trainTab = 'assign';
        persist(); renderHead(); renderTrain();
        toast('已把「' + (who ? who.name : '他') + '」放进催办名单，确认内容就能发');
        return;
      }
      if (e.target.closest('[data-nudge-all]')) {
        S.mailRuleKey = 'urge';
        setAudience('urge', 'undone');
        S.mailTo = null;
        S.trainTab = 'assign';
        persist(); renderHead(); renderTrain();
        toast('已切到催办通知，收件人是还没交卷的人');
        return;
      }

      /* ---- 分派：选人 ---- */
      var pp = e.target.closest('[data-person]');
      if (pp) {
        var pid = pp.dataset.person;
        var idx = project.people.indexOf(pid);
        if (idx >= 0) project.people.splice(idx, 1);
        else project.people.push(pid);
        persist();
        renderAssignPeople(); renderHead(); renderProjectList();
        return;
      }
      var deptBtn = e.target.closest('[data-dept]');
      if (deptBtn) {
        var dept = deptBtn.dataset.dept;
        var inDept = TD.people.filter(function (x) { return x.dept === dept; }).map(function (x) { return x.id; });
        var allIn = inDept.every(function (id) { return project.people.indexOf(id) >= 0; });
        if (allIn) {
          project.people = project.people.filter(function (id) { return inDept.indexOf(id) < 0; });
        } else {
          inDept.forEach(function (id) { if (project.people.indexOf(id) < 0) project.people.push(id); });
        }
        persist();
        renderAssignPeople(); renderHead(); renderProjectList();
        return;
      }
      var pk = e.target.closest('[data-pick]');
      if (pk) {
        if (pk.dataset.pick === 'all') project.people = TD.people.map(function (x) { return x.id; });
        else if (pk.dataset.pick === 'none') project.people = [];
        else if (pk.dataset.pick === 'new') {
          var newIds = TD.people.filter(function (x) {
            return global.Staff && global.Staff.isNewHire(x);
          }).map(function (x) { return x.id; });
          newIds.forEach(function (id) {
            if (project.people.indexOf(id) < 0) project.people.push(id);
          });
        }
        else return;
        persist();
        renderAssignPeople(); renderAssign(); renderHead(); renderProjectList();
        return;
      }

      /* 新员工自动加入开关 */
      if (e.target && e.target.id === 'asgAutoJoin') {
        project.autoJoin = !!e.target.checked;
        if (project.autoJoin && global.Staff) global.Staff.syncAutoJoin();
        persist();
        renderAssign(); renderProjectList();
        toast(project.autoJoin ? '开班后新入职的同事会自动进来' : '已关闭自动加入');
        return;
      }

      /* ---- 通知模板切换 ---- */
      var rule = e.target.closest('[data-rule]');
      if (rule) {
        var key = rule.dataset.rule;
        if (S.mailRuleKey !== key) {
          S.mailRuleKey = key;
          // 模板自带默认收件人范围；用户改过就记住
          S.mailTo = null;
          persist(); renderAssign();
        }
        return;
      }
      var aud = e.target.closest('[data-aud]');
      if (aud) {
        setAudience(S.mailRuleKey || 'invite', aud.dataset.aud);
        S.mailTo = null;
        persist(); renderAssign();
        return;
      }

      var vchip = e.target.closest('[data-var]');
      if (vchip) {
        var ta = $('mailBody');
        if (ta) {
          var pos = ta.selectionStart || ta.value.length;
          var ins = '{{' + vchip.dataset.var + '}}';
          ta.value = ta.value.slice(0, pos) + ins + ta.value.slice(ta.selectionEnd || pos);
          ta.focus();
          ta.selectionStart = ta.selectionEnd = pos + ins.length;
          saveMailTpl();
        }
        return;
      }

      // 导出 CSV
      if (e.target.closest('#btnExportCsv')) { exportCsv(); return; }

      // 邮件动作
      if (e.target.closest('#btnSendMail')) { doSendMail(); return; }
      if (e.target.closest('#btnCopyMail')) { doCopyMail(); return; }
      if (e.target.closest('#btnExportEml')) { doExportEml(); return; }
      if (e.target.closest('#btnExportMailList')) { doExportMailList(); return; }
    });

    /* 材料上传 */
    document.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'matFileInput') {
        if (e.target.files && e.target.files.length) addMaterials(e.target.files);
        e.target.value = '';
      }
    });

    /* 拖拽上传 */
    document.addEventListener('dragover', function (e) {
      var d = e.target.closest && e.target.closest('#matDrop');
      if (d) { e.preventDefault(); d.classList.add('is-drag'); }
    });
    document.addEventListener('dragleave', function (e) {
      var d = e.target.closest && e.target.closest('#matDrop');
      if (d) d.classList.remove('is-drag');
    });
    document.addEventListener('drop', function (e) {
      var d = e.target.closest && e.target.closest('#matDrop');
      if (!d) return;
      e.preventDefault();
      d.classList.remove('is-drag');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        addMaterials(e.dataTransfer.files);
      }
    });

    /* 邮件模板编辑 */
    document.addEventListener('input', function (e) {
      if (!e.target) return;
      if (e.target.id === 'mailSubject' || e.target.id === 'mailBody') {
        saveMailTpl();
        // 实时刷新预览
        var key = S.mailRuleKey || 'invite';
        var tpl = templateForRule(key);
        var aud = audienceList();
        var sample = aud[0] || TD.people[0];
        var pv = document.querySelector('.mail-preview');
        if (pv && tpl) {
          pv.innerHTML = '<div class="mp-head"><b>主题：</b>' + esc(fillVars(tpl.subject, sample)) + '</div>' +
            '<div class="mp-body">' + esc(fillVars(tpl.body, sample)) + '</div>';
        }
      }
    });

    $('mvSave').addEventListener('click', saveVideoLink);

    /* 新建项目 */
    $('btnNewProject').addEventListener('click', function () {
      $('npTitle').value = '';
      $('npDesc').value = '';
      $('npDept').value = '';
      $('npDue').value = '2026-12-15';
      $('npDuration').value = '45';
      $('npPass').value = '60';
      $('npRetake').value = '1';
      openModal('newProjectModal');
    });
    $('npCreate').addEventListener('click', createProject);

    /* 头部动作 */
    $('btnPublish').addEventListener('click', function () {
      S.trainTab = 'assign';
      S.trainQOpenId = null;
      persist();
      renderHead();
      renderTrain();
      var tb = $('trainBody');
      if (tb) tb.scrollTop = 0;
    });

    /* 右侧出题 */
    $('trainSrcTabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-src]');
      if (!b) return;
      trainSrcMode = b.dataset.src;
      $$('#trainSrcTabs .src-tab').forEach(function (x) { x.classList.toggle('is-on', x.dataset.src === trainSrcMode); });
      $('trainSrcMaterial').classList.toggle('hidden', trainSrcMode !== 'material');
      $('trainSrcPaste').classList.toggle('hidden', trainSrcMode !== 'paste');
      $('trainSrcFile').classList.toggle('hidden', trainSrcMode !== 'file');
      refreshTrainGen();
    });

    $('trainDocList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-doc]');
      if (!b) return;
      var id = b.dataset.doc;

      // 提取不到文字的材料不参与出题，点了只提示
      if (b.dataset.notext === '1') {
        toast('这份材料里没有可提取的文字（PDF 常见），员工能在线阅读，但没法作为出题依据。换成 PPT / Word，或用「粘贴」直接给文字', 'err');
        return;
      }

      docPick[id] = !docPick[id];
      b.classList.toggle('is-on', !!docPick[id]);
      refreshTrainGen();
    });

    $('trainPaste').addEventListener('input', function () {
      trainPasteText = this.value;
      $('trainPasteChars').textContent = C.countChars(trainPasteText);
      refreshTrainGen();
    });

    $('trainUploadZone').addEventListener('click', function () { $('trainFileInput').click(); });
    $('trainFileInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) loadTrainSourceFile(f);
      e.target.value = '';
    });

    $('trainTypeRows').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var row = b.closest('.type-row');
      var key = row.dataset.type;
      var v = Number(_trainCounts[key]) || 0;
      v = b.dataset.act === 'inc' ? Math.min(40, v + 1) : Math.max(0, v - 1);
      _trainCounts[key] = v;
      renderTrainTypeRows();
      refreshTrainGen();
    });
    $('trainTypeRows').addEventListener('input', function (e) {
      var inp = e.target.closest('[data-in]');
      if (!inp) return;
      var key = inp.dataset.in;
      var v = Math.max(0, Math.min(40, Number(inp.value) || 0));
      _trainCounts[key] = v;
      var row = inp.closest('.type-row');
      row.classList.toggle('has-val', v > 0);
      var dec = row.querySelector('[data-act="dec"]');
      var inc = row.querySelector('[data-act="inc"]');
      if (dec) dec.disabled = v <= 0;
      if (inc) inc.disabled = v >= 40;
      $('trainTotalPill').textContent = Object.keys(_trainCounts).reduce(function (s, k) { return s + (Number(_trainCounts[k]) || 0); }, 0);
      refreshTrainGen();
    });

    $('trainDiffChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-d]');
      if (!b) return;
      var k = b.dataset.d;
      var next = _trainDiff[k] >= 70 ? 10 : _trainDiff[k] + 10;
      var remain = 100 - next;
      var others = ['easy', 'medium', 'hard'].filter(function (x) { return x !== k; });
      var sum = (_trainDiff[others[0]] + _trainDiff[others[1]]) || 1;
      _trainDiff[k] = next;
      _trainDiff[others[0]] = Math.round(remain * _trainDiff[others[0]] / sum);
      _trainDiff[others[1]] = remain - _trainDiff[others[0]];
      renderTrainDiff();
    });

    $('trainBtnGen').addEventListener('click', doTrainGenerate);
    $('trainBtnCfg').addEventListener('click', function () {
      if (global.App && global.App.openSettings) global.App.openSettings();
    });

    $('trainQList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-ta]');
      if (!b) return;
      var id = b.dataset.id;
      var q = project.questions.find(function (x) { return x.id === id; });
      if (!q) return;
      if (b.dataset.ta === 'toggle') {
        S.trainQOpenId = S.trainQOpenId === id ? null : id;
        renderTrainQs();
      } else if (b.dataset.ta === 'del') {
        if (!confirm('删除这道题？')) return;
        project.questions = project.questions.filter(function (x) { return x.id !== id; });
        persist();
        renderTrainQs(); renderHead(); renderProjectList();
        if (S.trainTab === 'paper') renderPaperTab();
        toast('已删除');
      }
    });

    $('trainBtnAddQ').addEventListener('click', function () {
      var q = C.makeQuestion('single');
      q.point = project.title;
      project.questions.push(q);
      S.trainQOpenId = q.id;
      persist();
      renderTrainQs(); renderHead(); renderProjectList();
      toast('已添加空题');
    });

    $('trainBtnExport').addEventListener('click', function () {
      if (!project.questions.length) { toast('还没有试题', 'err'); return; }
      try {
        var st = {
          questions: project.questions,
          bank: project.title,
          courseTitle: project.title,
          point: project.title,
          examTitle: project.title,
          exportCfg: S.exportCfg,
          questionsSorted: true
        };
        var name = X.exportXlsx(st);
        toast('已导出 ' + name);
      } catch (err) {
        toast('导出失败：' + ((err && err.message) || err), 'err');
      }
    });
  }

  function saveMailTpl() {
    var key = S.mailRuleKey || 'invite';
    var tpl = templateForRule(key);
    if (!tpl) return;
    var sub = $('mailSubject');
    var bod = $('mailBody');
    if (sub) tpl.subject = sub.value;
    if (bod) tpl.body = bod.value;
    persist();
  }

  function closeModalById(id) {
    $(id).classList.remove('is-on');
    if (!$$('.modal.is-on').length) $('overlay').classList.remove('is-on');
  }

  /* ---------- 邮件动作 ---------- */
  function doSendMail() {
    var key = S.mailRuleKey || 'invite';
    var rule = ruleByKey(key);
    var tpl = templateForRule(key);
    if (!tpl) return;
    saveMailTpl();
    var aud = audienceList();
    if (!aud.length) { toast('这个筛选条件下没有人', 'err'); return; }

    sendMail(tpl.name, aud.length, '收件人：' + aud.slice(0, 3).map(function (x) { return x.name; }).join('、') +
      (aud.length > 3 ? ' 等 ' + aud.length + ' 人' : ''));

    // 发完就清掉单人催办的临时限定，避免下次误发
    S.mailTo = null;
    persist();
    renderAssign();
    toast('已发送「' + tpl.name + '」给 ' + aud.length + ' 人，记录已生成');
  }

  function doCopyMail() {
    var key = S.mailRuleKey || 'invite';
    saveMailTpl();
    var tpl = templateForRule(key);
    var aud = audienceList();
    var sample = aud[0] || TD.people[0];
    var text = '主题：' + fillVars(tpl.subject, sample) + '\n\n' + fillVars(tpl.body, sample);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('邮件内容已复制到剪贴板');
      }).catch(function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('邮件内容已复制'); }
    catch (e) { toast('复制失败，请手动选择', 'err'); }
    document.body.removeChild(ta);
  }

  function doExportEml() {
    var key = S.mailRuleKey || 'invite';
    saveMailTpl();
    var tpl = templateForRule(key);
    var aud = audienceList();
    var sample = aud[0] || TD.people[0];
    var subj = fillVars(tpl.subject, sample);
    var body = fillVars(tpl.body, sample);

    var d = new Date();
    var dt = d.toUTCString();
    var eml = [
      'From: 人力资源部培训组 <training@example.com>',
      'To: ' + sample.name + ' <' + sample.mail + '>',
      'Subject: =?UTF-8?B?' + b64utf8(subj) + '?=',
      'Date: ' + dt,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64utf8(body)
    ].join('\r\n');

    var blob = new Blob([eml], { type: 'message/rfc822' });
    downloadBlob(blob, '邮件_' + tpl.name + '_' + C.nowStamp() + '.eml');
    toast('已导出邮件文件（可用邮件客户端打开）');
  }

  function b64utf8(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function doExportMailList() {
    var aud = audienceList();
    if (!aud.length) { toast('没有收件人', 'err'); return; }
    var rows = [['姓名', '部门', '岗位', '邮箱', '状态']];
    aud.forEach(function (x) {
      var rec = project.records.find(function (r) { return r.pid === x.id; });
      var rs = rec ? (TD.recStatus[rec.status] || TD.recStatus.pending) : TD.recStatus.pending;
      rows.push([x.name, x.dept, x.role, x.mail, rs.name]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), '收件人名单_' + C.nowStamp() + '.csv');
    toast('已导出 ' + aud.length + ' 人名单');
  }

  /** 导出成绩：按分派名单出，没开始的人也在里面，和看板表格一致 */
  function exportCsv() {
    var p = project;
    var matTotal = (p.materials || []).length;
    var line = passLine(p);
    var total = totalScore(p);
    var rows = [['姓名', '部门', '岗位', '邮箱', '工号', '已读材料', '材料总数',
      '状态', '得分', '满分', '及格线', '是否通过', '用时(分)', '提交时间']];

    var order = { done: 0, doing: 1, pending: 2 };
    var list = p.people.map(function (id) { return TD.personById(id); }).filter(Boolean);
    list.sort(function (a, b) {
      var oa = order[recStatusOf(a.id)] == null ? 3 : order[recStatusOf(a.id)];
      var ob = order[recStatusOf(b.id)] == null ? 3 : order[recStatusOf(b.id)];
      return oa - ob;
    });

    function recStatusOf(pid) {
      var r = p.records.filter(function (x) { return x.pid === pid; })[0];
      return r ? r.status : 'pending';
    }

    list.forEach(function (x) {
      var r = p.records.filter(function (y) { return y.pid === x.id; })[0];
      var status = r ? r.status : 'pending';
      var rs = TD.recStatus[status] || TD.recStatus.pending;
      var passed = r && r.score != null ? (r.score >= line ? '通过' : '未通过') : '';
      rows.push([
        x.name, x.dept, x.role || '', x.mail || '', x.jobNo || '',
        readCountOf(r, p), matTotal, rs.name,
        r && r.score != null ? r.score : '', total, line, passed,
        r && r.used != null ? r.used : '', (r && r.submitAt) || ''
      ]);
    });

    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }),
      p.title.replace(/[\\/:*?"<>|]/g, '_') + '_成绩_' + C.nowStamp() + '.csv');
    toast('已导出 ' + list.length + ' 人的成绩');
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  /* ---------- 分发 ---------- */
  /** 已合并进「分派与通知」，保留兼容 */
  function doPublish() {
    S.trainTab = 'assign'; persist(); renderHead(); renderTrain(); return;
  }

  /* ---------- 新建项目 ---------- */
  function createProject() {
    var title = $('npTitle').value.trim();
    if (!title) { toast('填个培训名称', 'err'); return; }

    var id = 'tp' + Date.now().toString(36);
    var d = new Date();
    var today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

    var p = {
      id: id,
      title: title,
      dept: $('npDept').value.trim() || '全员',
      type: '必修',
      status: 'draft',
      owner: '宋知微',
      createdAt: today,
      startAt: today,
      dueAt: $('npDue').value || '2026-12-15',
      duration: Number($('npDuration').value) || 45,
      passScore: Number($('npPass').value) || 60,
      retake: Number($('npRetake').value) || 0,
      desc: $('npDesc').value.trim(),
      materials: [],
      questions: [],
      rules: TD.defaultRules(),
      templates: TD.defaultTemplates(),
      people: [],
      records: [],
      mailLog: []
    };

    S.projects.unshift(p);
    S.activeProjectId = p.id;
    project = p;
    docPick = {};
    boardKw = '';
    // 新项目落在看板：那里列着「上传材料 → 出题 → 选人」三步，比直接跳某一页清楚
    S.trainTab = 'board';
    persist();
    closeModalById('newProjectModal');
    renderHead();
    renderTrain();
    toast('已创建「' + title + '」，按看板上的三步往下走');
  }

  /* ---------- 出题 ---------- */
  function loadTrainSourceFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var p;
    if (ext === 'docx') {
      p = global.JSZip.loadAsync(file).then(function (zip) {
        var f = zip.file('word/document.xml');
        if (!f) throw new Error('不是有效的 docx');
        return f.async('string');
      }).then(function (xml) {
        return C.normalizeText(xml
          .replace(/<w:tab[^>]*\/>/g, '\t')
          .replace(/<w:br[^>]*\/>/g, '\n')
          .replace(/<\/w:p>/g, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      });
    } else if (['txt', 'md', 'markdown', 'csv'].indexOf(ext) >= 0) {
      p = new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(String(fr.result || '')); };
        fr.onerror = function () { rej(new Error('读取失败')); };
        fr.readAsText(file, 'utf-8');
      });
    } else {
      toast('不支持 .' + ext, 'err');
      return;
    }

    p.then(function (text) {
      trainFileText = text;
      trainFileName = file.name;
      trainSrcMode = 'file';
      $('trainFileMeta').style.display = 'flex';
      $('trainFileName').textContent = file.name;
      $('trainFileChars').textContent = C.countChars(text);
      $$('#trainSrcTabs .src-tab').forEach(function (x) { x.classList.toggle('is-on', x.dataset.src === 'file'); });
      $('trainSrcMaterial').classList.add('hidden');
      $('trainSrcPaste').classList.add('hidden');
      $('trainSrcFile').classList.remove('hidden');
      refreshTrainGen();
      toast('已读取 ' + file.name);
    }).catch(function (err) {
      toast('读取失败：' + ((err && err.message) || err), 'err');
    });
  }

  function doTrainGenerate() {
    if (busy || !project) return;
    if (sourceChars() < 60) { toast('资料太短，先去选材料或粘贴内容', 'err'); return; }

    busy = true;
    refreshTrainGen();
    $('trainProgress').classList.add('is-on');
    $('trainQWrap').classList.add('hidden');
    $('trainQEmpty').classList.add('hidden');
    setTrainProgress(0.05, '正在解析资料…', '切分段落 · 提取关键词');

    var useAI = S.llm && S.llm.on && S.llm.key && S.llm.base && S.llm.model;
    var t0 = Date.now();

    var task = Promise.resolve(trainSourceText()).then(function (text) {
      if (C.countChars(text) < 60) throw new Error('资料太短');
      return useAI
        ? E.generateByLLM(text, _trainCounts, _trainDiff, 'mixed', S.llm, function (p, sub) {
            setTrainProgress(0.05 + p * 0.92, 'AI 正在出题…', sub);
          })
        : E.generateOffline(text, _trainCounts, _trainDiff, 'mixed', function (p, sub) {
            setTrainProgress(0.1 + p * 0.86, '正在生成题目…', sub);
          });
    });

    task.then(function (qs) {
      qs = qs || [];
      if (!qs.length) {
        busy = false;
        $('trainProgress').classList.remove('is-on');
        renderTrainQs(); refreshTrainGen();
        toast('没生成出题目，资料信息量不足', 'err');
        return;
      }
      setTrainProgress(1, '生成完成', '用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒');
      setTimeout(function () {
        qs.forEach(function (q) { if (!q.point) q.point = project.title; });
        var ORDER = ['single', 'multi', 'judge', 'blank', 'essay'];
        qs.sort(function (a, b) { return ORDER.indexOf(a.type) - ORDER.indexOf(b.type); });
        project.questions = qs;
        S.trainQOpenId = null;
        busy = false;
        $('trainProgress').classList.remove('is-on');
        persist();
        renderTrainQs(); renderTrainTypeRows(); refreshTrainGen();
        renderHead(); renderProjectList();
        if (S.trainTab === 'paper') renderPaperTab();
        toast('已生成 ' + qs.length + ' 道题');
      }, 380);
    }).catch(function (err) {
      busy = false;
      $('trainProgress').classList.remove('is-on');
      renderTrainQs(); refreshTrainGen();
      toast('出题失败：' + ((err && err.message) || err), 'err');
    });
  }

  function setTrainProgress(p, label, sub) {
    p = Math.max(0, Math.min(1, p));
    $('trainGpPct').textContent = Math.round(p * 100) + '%';
    $('trainGpRing').style.strokeDashoffset = String(151 - 151 * p);
    if (label) $('trainGpLabel').textContent = label;
    if (sub) $('trainGpSub').textContent = sub;
  }

  /** 顶栏项目切换器已移除，保留空实现兼容旧调用 */
  function syncTopSwitch() { }

  /* =========================================================
     对外
     ========================================================= */
  function init(sharedState, opts) {
    S = sharedState;
    ensureProjects();

    // 让 App 能打开设置
    if (global.App) global.App.openSettings = function () {
      if (opts && opts.openSettings) opts.openSettings();
    };
    if (opts && opts.openSettings) {
      $('trainBtnCfg').onclick = opts.openSettings;
    }

    bind();
    renderTrain();
    syncTopSwitch();
  }

  /** 模块切换到培训时调用 */
  function onShow() {
    if (!S) return;
    ensureProjects();
    renderTrain();
    syncTopSwitch();
  }

  global.Train = {
    init: init,
    onShow: onShow,
    current: function () { return project; },
    rerender: function () {
      // 学员登录时管理端是隐藏的，跳过渲染避免动到不存在的节点
      var shell = document.getElementById('shellTrain');
      if (!S || !shell || !shell.classList.contains('is-on')) return;
      renderTrain();
    },
    stats: stats
  };
})(window);
