/* =========================================================
   壳层：登录、角色路由、模块切换、账号管理、设置
   - 培训管理（manage）：决定员工学什么、考什么
   - 学员中心（learn）：员工在线阅读材料 + 参加考试
   ========================================================= */
(function (global) {
  'use strict';

  var C = global.Core;

  var S = C.defaultState();
  var saved = C.Store.load();
  if (saved) {
    try {
      ['module', 'projects', 'activeProjectId', 'trainTab', 'mailAud', 'staff', 'ding',
       'counts', 'diff', 'style', 'llm', 'exportCfg'
      ].forEach(function (k) { if (saved[k] != null) S[k] = saved[k]; });
      if (!S.exportCfg || !S.exportCfg.columns || !S.exportCfg.columns.length) {
        S.exportCfg = C.defaultState().exportCfg;
      }
      if (!Array.isArray(S.projects) || !S.projects.length) {
        S.projects = C.defaultState().projects;
        S.activeProjectId = S.projects[0].id;
      }
      if (['board', 'material', 'paper', 'assign'].indexOf(S.trainTab) < 0) S.trainTab = 'board';
    } catch (e) { }
  }
  if (!S.module || ['manage', 'staff', 'learn'].indexOf(S.module) < 0) S.module = 'manage';

  var ME = null;

  /* ---------- 基础工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function toast(msg, type) {
    var wrap = $('toastWrap');
    if (!wrap) return;
    var d = document.createElement('div');
    d.className = 'toast' + (type ? ' ' + type : '');
    d.textContent = msg;
    wrap.appendChild(d);
    setTimeout(function () {
      d.classList.add('out');
      setTimeout(function () { d.remove(); }, 300);
    }, type === 'err' ? 3600 : 2400);
  }

  function persist() { C.Store.save(S); }

  /* ---------- 弹窗 ---------- */
  function openModal(id) {
    var m = $(id);
    if (!m) return;
    m.classList.add('is-on');
    var ov = $('overlay');
    if (ov) ov.classList.add('is-on');
  }

  function closeModal(id) {
    var m = $(id);
    if (!m) return;
    m.classList.remove('is-on');
    var any = $$('.modal.is-on').length;
    var ov = $('overlay');
    if (ov && !any) ov.classList.remove('is-on');
  }

  function closeAllModals() {
    $$('.modal.is-on').forEach(function (m) { m.classList.remove('is-on'); });
    var ov = $('overlay');
    if (ov) ov.classList.remove('is-on');
  }

  /* ---------- AI 状态 ---------- */
  function updateEnginePill() {
    var pill = $('enginePill'), txt = $('engineText');
    if (!pill || !txt) return;
    var on = S.llm && S.llm.on && S.llm.key && S.llm.base && S.llm.model;
    pill.classList.toggle('is-on', !!on);
    txt.textContent = on ? (S.llm.model || 'AI 已配置') : '本地引擎';
    pill.title = on ? '出题走大模型' : '出题走本地引擎，配置大模型可提升语言质量';
  }

  /* =========================================================
     模块切换
     - manage 培训（管理员） | staff 员工库（管理员） | learn 我的学习（学员）
     ========================================================= */
  function activeProject() {
    var list = S.projects || [];
    return list.filter(function (p) { return p.id === S.activeProjectId; })[0] || list[0] || null;
  }

  /** 学员端：只有本人身份，没有切换 */
  function renderLearn() {
    if (!ME) return;
    var pid = ME.personId || '';
    var person = (global.TrainData && global.TrainData.personById(pid)) || null;

    $('lwAv').textContent = person ? person.name.slice(-1) : '—';
    $('lwName').textContent = person ? person.name : '未绑定身份';
    $('lwMeta').textContent = person
      ? (person.dept + (person.role ? ' · ' + person.role : ''))
      : '请联系管理员绑定人员';

    $('learnToolRight').innerHTML = '';

    if (global.Student) {
      global.Student.mount($('learnHost'), { mode: 'self', personId: pid });
    }
  }

  function switchModule(m, silent) {
    var isAdmin = ME && ME.role === 'admin';
    if (!isAdmin) m = 'learn';
    if (isAdmin && m === 'learn') m = 'manage';
    if (['manage', 'staff', 'learn'].indexOf(m) < 0) m = isAdmin ? 'manage' : 'learn';

    S.module = m;
    document.body.dataset.module = m;

    $$('#mainNav .mn-btn').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.module === m);
    });
    $('shellTrain').classList.toggle('is-on', m === 'manage');
    var sf = $('shellStaff');
    if (sf) sf.classList.toggle('is-on', m === 'staff');
    $('shellLearn').classList.toggle('is-on', m === 'learn');

    if (m === 'manage') {
      if (global.Student && global.Student.unmount) global.Student.unmount();
      if (global.Train && global.Train.onShow) global.Train.onShow();
    } else if (m === 'staff') {
      if (global.Staff) global.Staff.onShow();
    } else {
      renderLearn();
    }
    persist();
    if (!silent) {
      var sc = $('learnScroll');
      if (sc) sc.scrollTop = 0;
    }
  }

  /* =========================================================
     登录与角色
     ========================================================= */
  function fillUserUI() {
    if (!ME) return;
    $('userAvatar').textContent = ME.name.slice(-1);
    $('userName').textContent = ME.name;
    $('userRole').textContent = (global.Auth.roles[ME.role] || {}).name || '';
    $('umName').textContent = ME.name;
    $('umSub').textContent = (ME.dept || '') + (ME.title ? ' · ' + ME.title : '') + ' · @' + ME.username;
    $('umAccounts').style.display = ME.role === 'admin' ? '' : 'none';
    $('btnSettings').style.display = ME.role === 'admin' ? '' : 'none';
    $('enginePill').style.display = ME.role === 'admin' ? '' : 'none';

    document.body.classList.toggle('is-student', ME.role !== 'admin');
  }

  function showLogin() {
    $('loginScreen').classList.add('is-on');
    $('shellTrain').classList.remove('is-on');
    $('shellLearn').classList.remove('is-on');
    var sf = $('shellStaff');
    if (sf) sf.classList.remove('is-on');
    document.querySelector('.topbar').style.display = 'none';
    setTimeout(function () { var u = $('loginUser'); if (u) u.focus(); }, 200);
  }

  function applyRole() {
    var isAdmin = ME && ME.role === 'admin';

    $('loginScreen').classList.remove('is-on');
    document.querySelector('.topbar').style.display = '';
    fillUserUI();

    if (isAdmin) switchModule('manage', true);
    else switchModule('learn', true);
  }

  function doLogin() {
    var u = $('loginUser').value;
    var p = $('loginPass').value;
    var err = $('loginErr');
    err.innerHTML = '';

    $('loginBtn').disabled = true;
    var r = global.Auth.login(u, p);
    $('loginBtn').disabled = false;

    if (!r.ok) {
      err.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' + C.esc(r.msg);
      $('loginPass').select();
      return;
    }

    ME = r.account;
    $('loginPass').value = '';
    applyRole();
    toast('欢迎回来，' + ME.name);
  }

  function doLogout() {
    if (!confirm('确定退出登录？')) return;
    global.Auth.logout();
    ME = null;
    if (global.Student && global.Student.unmount) global.Student.unmount();
    $('userMenu').classList.remove('is-on');
    document.body.classList.remove('is-student');
    showLogin();
  }

  /* =========================================================
     账号管理
     ========================================================= */
  var accFilter = 'all';
  var accSearch = '';
  var accEditing = null;
  var pwdReveal = {};

  function renderAccounts() {
    var all = global.Auth.all();
    var st = global.Auth.stats();

    $('accSub').textContent = '共 ' + st.total + ' 个账号 · ' + st.admin + ' 个管理员 · ' + st.student + ' 个学员' +
      (st.inactive ? ' · ' + st.inactive + ' 个已停用' : '');
    if ($('accFoot')) $('accFoot').textContent = '密码明文显示，请谨慎转发';

    var list = all.filter(function (a) {
      if (accFilter === 'admin' && a.role !== 'admin') return false;
      if (accFilter === 'student' && a.role !== 'student') return false;
      if (accFilter === 'inactive' && a.active) return false;
      if (accSearch) {
        var q = accSearch.toLowerCase();
        var hay = (a.name + a.username + a.dept + a.title).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });

    $('accBody').innerHTML = list.map(function (a) {
      var roleName = (global.Auth.roles[a.role] || {}).name || a.role;
      var shown = pwdReveal[a.id];
      var pwdCell = shown
        ? '<span style="font-family:var(--mono);font-size:13.5px">' + C.esc(a.password) + '</span>' +
          '<button class="eye" data-pwd="' + a.id + '" title="隐藏">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19.5C5.5 19.5 2 12 2 12a19 19 0 0 1 5.1-5.9M9.9 4.7A10.4 10.4 0 0 1 12 4.5c6.5 0 10 7.5 10 7.5a19 19 0 0 1-2.2 3.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>' +
          '</button>'
        : '<span style="font-family:var(--mono);font-size:13.5px;letter-spacing:2px">••••••</span>' +
          '<button class="eye" data-pwd="' + a.id + '" title="显示密码">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="2.6"/></svg>' +
          '</button>';

      return '<tr' + (a.active ? '' : ' class="is-off"') + '>' +
        '<td><div class="acc-name">' + C.esc(a.name) + '</div></td>' +
        '<td><span class="acc-uname">' + C.esc(a.username) + '</span></td>' +
        '<td><span class="acc-pwd">' + pwdCell + '</span></td>' +
        '<td><span class="acc-role ' + a.role + '">' + roleName + '</span></td>' +
        '<td>' + C.esc(a.dept || '—') + (a.title ? '<div style="font-size:13px;color:var(--ink-4)">' + C.esc(a.title) + '</div>' : '') + '</td>' +
        '<td><span class="' + (a.active ? 'acc-on' : 'acc-off') + '">' + (a.active ? '启用' : '停用') + '</span></td>' +
        '<td><div class="acc-ops">' +
          '<button class="qa-btn" data-acc="edit" data-id="' + a.id + '">编辑</button>' +
          '<button class="qa-btn" data-acc="toggle" data-id="' + a.id + '">' + (a.active ? '停用' : '启用') + '</button>' +
          '<button class="qa-btn del" data-acc="del" data-id="' + a.id + '">删除</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    if (!list.length) {
      $('accBody').innerHTML = '<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--ink-4)">没有匹配的账号</td></tr>';
    }
  }

  function openAccEdit(id) {
    accEditing = id || null;
    var a = id ? global.Auth.byId(id) : null;

    $('aeTitle').textContent = a ? '编辑账号' : '新建账号';
    $('aeName').value = a ? a.name : '';
    $('aeUsername').value = a ? a.username : '';
    $('aePassword').value = a ? a.password : '';
    $('aeRole').value = a ? a.role : 'student';
    $('aeDept').value = a ? (a.dept || '') : '';
    $('aeTitle2').value = a ? (a.title || '') : '';
    $('aeActive').classList.toggle('is-on', a ? !!a.active : true);
    $('aeErr').textContent = '';

    var opts = '<option value="">不绑定</option>';
    ((global.TrainData && global.TrainData.people) || []).forEach(function (x) {
      var on = a && a.personId === x.id ? ' selected' : '';
      opts += '<option value="' + x.id + '"' + on + '>' + C.esc(x.name) + ' · ' + C.esc(x.dept) + '</option>';
    });
    $('aePerson').innerHTML = opts;

    openModal('accEditModal');
    setTimeout(function () { $('aeName').focus(); }, 180);
  }

  function saveAcc() {
    var data = {
      name: $('aeName').value,
      username: $('aeUsername').value,
      password: $('aePassword').value,
      role: $('aeRole').value,
      dept: $('aeDept').value,
      title: $('aeTitle2').value,
      personId: $('aePerson').value,
      active: $('aeActive').classList.contains('is-on')
    };

    var r = accEditing ? global.Auth.update(accEditing, data) : global.Auth.add(data);
    if (!r.ok) { $('aeErr').textContent = r.msg; return; }

    closeModal('accEditModal');
    renderAccounts();
    toast(accEditing ? '账号已更新' : '账号已创建');
    accEditing = null;
  }

  function openPwdModal() {
    $('pwdOld').value = '';
    $('pwdNew').value = '';
    $('pwdNew2').value = '';
    $('pwdErr').textContent = '';
    $('pwdSub').textContent = ME ? (ME.name + ' · @' + ME.username) : '';
    openModal('pwdModal');
    setTimeout(function () { $('pwdOld').focus(); }, 180);
  }

  function savePwd() {
    var err = $('pwdErr');
    err.textContent = '';
    if ($('pwdOld').value !== ME.password) { err.textContent = '当前密码不正确'; return; }
    var n = $('pwdNew').value;
    if (n.length < 6) { err.textContent = '新密码至少 6 位'; return; }
    if (n !== $('pwdNew2').value) { err.textContent = '两次输入的新密码不一致'; return; }

    var r = global.Auth.update(ME.id, { password: n });
    if (!r.ok) { err.textContent = r.msg; return; }
    ME = r.account;
    closeModal('pwdModal');
    toast('密码已修改');
  }

  /* =========================================================
     设置：大模型 + 导出列映射
     ========================================================= */
  var LLM_PRESETS = [
    { name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { name: 'Kimi', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
    { name: '自建中转', base: '', model: '' }
  ];

  function renderLlmPresets() {
    var box = $('llmPresets');
    if (!box) return;
    box.innerHTML = LLM_PRESETS.map(function (p, i) {
      return '<button class="preset-chip" data-preset="' + i + '">' + C.esc(p.name) + '</button>';
    }).join('');
  }

  function renderColMap() {
    var box = $('colMap');
    if (!box) return;
    var cols = S.exportCfg.columns;
    box.innerHTML = cols.map(function (c, i) {
      var name = c.field.indexOf('option:') === 0
        ? '选项 ' + c.field.split(':')[1]
        : (C.FIELD_NAMES[c.field] || c.field);
      return '<div class="col-row">' +
        '<span class="idx">' + (i + 1) + '</span>' +
        '<span class="switch-s' + (c.on ? ' is-on' : '') + '" data-col-toggle="' + i + '"></span>' +
        '<input class="input" data-col-label="' + i + '" value="' + C.esc(c.label) + '" placeholder="列名">' +
        '<span class="field-tag">' + name + '</span>' +
        '<span class="col-order">' +
          '<button class="qa-btn" data-col-move="up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button class="qa-btn" data-col-move="down" data-i="' + i + '"' + (i === cols.length - 1 ? ' disabled' : '') + '>▼</button>' +
        '</span>' +
      '</div>';
    }).join('');
  }

  function syncSettings() {
    var on = !!(S.llm && S.llm.on);
    $('swLlm').classList.toggle('is-on', on);
    $('llmPane').style.display = on ? '' : 'none';
    $('llmBase').value = (S.llm && S.llm.base) || '';
    $('llmKey').value = (S.llm && S.llm.key) || '';
    $('llmModel').value = (S.llm && S.llm.model) || '';

    $('swNoteRow').classList.toggle('is-on', !!S.exportCfg.noteRow);
    $('selJudgeFmt').value = S.exportCfg.judgeFmt;
    $('selMultiSep').value = S.exportCfg.multiSep;
    renderColMap();
    renderLlmPresets();
  }

  function guessField(name) {
    var s = String(name || '').replace(/\s/g, '');
    var opt = s.match(/^(选项)?([A-F])$/i);
    if (opt) return 'option:' + opt[2].toUpperCase();
    var rules = [
      [/序号|编号|^(no|no\.)$/i, 'seq'],
      [/题型|类型/, 'type'],
      [/题干|题目|试题/, 'stem'],
      [/答案|正确选项/, 'answer'],
      [/解析|说明/, 'analysis'],
      [/分值|分数/, 'score'],
      [/难度/, 'difficulty'],
      [/知识点|考点/, 'point'],
      [/题库|所属/, 'bank']
    ];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i][0].test(s)) return rules[i][1];
    }
    return null;
  }

  function loadTemplateFile(file) {
    if (!file || !global.XLSX) { toast('缺少表格解析库', 'err'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var wb = XLSX.read(new Uint8Array(fr.result), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
        var headerRow = null;
        for (var i = 0; i < Math.min(rows.length, 6); i++) {
          var cells = (rows[i] || []).filter(function (c) { return String(c || '').trim(); });
          if (cells.length >= 3) { headerRow = rows[i]; break; }
        }
        if (!headerRow) { toast('没识别到表头行', 'err'); return; }

        var cols = headerRow.map(function (h, idx) {
          var label = String(h == null ? '' : h).trim();
          if (!label) return null;
          return { field: guessField(label) || ('custom:' + idx), label: label, on: true };
        }).filter(Boolean);

        if (!cols.length) { toast('表头是空的', 'err'); return; }
        S.exportCfg.columns = cols;
        renderColMap();
        persist();
        toast('已读取 ' + cols.length + ' 列');
      } catch (e) {
        toast('读取失败：' + e.message, 'err');
      }
    };
    fr.readAsArrayBuffer(file);
  }

  function exportState() {
    var p = (global.Train && global.Train.current) ? global.Train.current() : activeProject();
    return {
      questions: (p && p.questions) || [],
      exportCfg: S.exportCfg,
      bank: p ? p.title : '',
      point: '',
      examTitle: p ? p.title : '',
      examDuration: p ? p.duration : 60,
      examPass: p ? p.passScore : 60
    };
  }

  function doExport(kind) {
    var st = exportState();
    if (!st.questions.length) { toast('还没有题目可导出', 'err'); return; }
    if (kind === 'json') global.Exporter.exportJson(st);
    else if (kind === 'md') global.Exporter.exportMarkdown(st);
    else global.Exporter.exportXlsx(st);
  }

  /* =========================================================
     事件绑定
     ========================================================= */
  function bindBase() {
    var ov = $('overlay');
    if (ov) ov.addEventListener('click', closeAllModals);
    $$('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeModal(b.dataset.close); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (global.Reader && global.Reader.isOpen()) return;
      closeAllModals();
      $('userMenu').classList.remove('is-on');
    });

    $('mainNav').addEventListener('click', function (e) {
      var b = e.target.closest('[data-module]');
      if (!b) return;
      if (b.dataset.module === S.module) return;
      switchModule(b.dataset.module);
    });

    $('userBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      $('userMenu').classList.toggle('is-on');
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#userWrap')) $('userMenu').classList.remove('is-on');
    });
    $('umLogout').addEventListener('click', doLogout);
    $('umPassword').addEventListener('click', function () {
      $('userMenu').classList.remove('is-on');
      openPwdModal();
    });
    $('umAccounts').addEventListener('click', function () {
      $('userMenu').classList.remove('is-on');
      renderAccounts();
      openModal('accountsModal');
    });

    $('btnSettings').addEventListener('click', openSettings);
  }

  function bindSettings() {
    $('settingsModal').addEventListener('click', function (e) {
      if (e.target.closest('#swLlm')) {
        S.llm.on = !S.llm.on;
        syncSettings();
        persist();
        updateEnginePill();
        return;
      }
      if (e.target.closest('#swNoteRow')) {
        S.exportCfg.noteRow = !S.exportCfg.noteRow;
        syncSettings();
        persist();
        return;
      }
      var preset = e.target.closest('[data-preset]');
      if (preset) {
        var p = LLM_PRESETS[Number(preset.dataset.preset)];
        if (p) {
          S.llm.base = p.base;
          S.llm.model = p.model;
          syncSettings();
          persist();
          if (!p.base) toast('填自建中转的接口地址');
        }
        return;
      }
      var tog = e.target.closest('[data-col-toggle]');
      if (tog) {
        var ci = Number(tog.dataset.colToggle);
        S.exportCfg.columns[ci].on = !S.exportCfg.columns[ci].on;
        renderColMap();
        persist();
        return;
      }
      var mv = e.target.closest('[data-col-move]');
      if (mv) {
        var i = Number(mv.dataset.i);
        var j = mv.dataset.colMove === 'up' ? i - 1 : i + 1;
        var cols = S.exportCfg.columns;
        if (j < 0 || j >= cols.length) return;
        var t = cols[i]; cols[i] = cols[j]; cols[j] = t;
        renderColMap();
        persist();
      }
    });

    $('settingsModal').addEventListener('input', function (e) {
      var el = e.target;
      if (el.id === 'llmBase' || el.id === 'llmKey' || el.id === 'llmModel') {
        S.llm[el.id === 'llmBase' ? 'base' : el.id === 'llmKey' ? 'key' : 'model'] = el.value.trim();
        persist();
        updateEnginePill();
        return;
      }
      if (el.dataset && el.dataset.colLabel != null) {
        S.exportCfg.columns[Number(el.dataset.colLabel)].label = el.value;
        persist();
      }
    });

    $('settingsModal').addEventListener('change', function (e) {
      var el = e.target;
      if (el.id === 'selJudgeFmt') { S.exportCfg.judgeFmt = el.value; persist(); }
      if (el.id === 'selMultiSep') { S.exportCfg.multiSep = el.value; persist(); }
    });

    $('btnResetCols').addEventListener('click', function () {
      S.exportCfg.columns = C.defaultColumns();
      renderColMap();
      persist();
      toast('已恢复默认列结构');
    });

    $('btnLoadTpl').addEventListener('click', function () { $('tplInput').click(); });
    $('tplInput').addEventListener('change', function () {
      if (this.files && this.files[0]) loadTemplateFile(this.files[0]);
      this.value = '';
    });

    $('btnExportJson').addEventListener('click', function () { doExport('json'); });
    $('btnExportMd').addEventListener('click', function () { doExport('md'); });

    $('btnWipe').addEventListener('click', function () {
      if (!confirm('清空所有本地数据？题目、材料、培训记录都会丢失，账号保留。')) return;
      C.Store.wipe();
      if (global.Files) global.Files.clearAll();
      location.reload();
    });

    $('btnTestLlm').addEventListener('click', function () {
      var btn = this, res = $('llmTestRes');
      var base = (S.llm.base || '').replace(/\/+$/, '');
      if (!base || !S.llm.key || !S.llm.model) {
        res.style.color = 'var(--rose)';
        res.textContent = '三项都要填';
        return;
      }
      btn.disabled = true;
      res.style.color = 'var(--ink-4)';
      res.textContent = '测试中…';

      fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.llm.key },
        body: JSON.stringify({
          model: S.llm.model,
          messages: [{ role: 'user', content: '回复两个字：正常' }],
          max_tokens: 16
        })
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        var txt = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        res.style.color = 'var(--green)';
        res.textContent = '连接正常：' + String(txt || '').slice(0, 20);
        updateEnginePill();
      })['catch'](function (err) {
        res.style.color = 'var(--rose)';
        res.textContent = '失败：' + (err.message || err) + '（可能是 CORS 或地址不对）';
      }).then(function () {
        btn.disabled = false;
      });
    });
  }

  function openSettings() {
    syncSettings();
    openModal('settingsModal');
  }

  function bindAuth() {
    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      doLogin();
    });
    $('loginEye').addEventListener('click', function () {
      var inp = $('loginPass');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      inp.focus();
    });

    $('accSearch').addEventListener('input', function () {
      accSearch = this.value.trim();
      renderAccounts();
    });
    $('accFilters').addEventListener('click', function (e) {
      var b = e.target.closest('[data-af]');
      if (!b) return;
      accFilter = b.dataset.af;
      $$('#accFilters .chip').forEach(function (x) { x.classList.toggle('is-on', x.dataset.af === accFilter); });
      renderAccounts();
    });
    $('accBody').addEventListener('click', function (e) {
      var pw = e.target.closest('[data-pwd]');
      if (pw) {
        var id = pw.dataset.pwd;
        pwdReveal[id] = !pwdReveal[id];
        renderAccounts();
        return;
      }
      var btn = e.target.closest('[data-acc]');
      if (!btn) return;
      var act = btn.dataset.acc;
      var aid = btn.dataset.id;

      if (act === 'edit') { openAccEdit(aid); return; }
      if (act === 'toggle') {
        var a = global.Auth.byId(aid);
        if (!a) return;
        if (a.id === ME.id && a.active) { toast('不能停用自己正在使用的账号', 'err'); return; }
        var r = global.Auth.update(aid, { active: !a.active });
        if (!r.ok) { toast(r.msg, 'err'); return; }
        renderAccounts();
        toast(a.active ? '已启用' : '已停用');
        return;
      }
      if (act === 'del') {
        if (aid === ME.id) { toast('不能删除自己正在使用的账号', 'err'); return; }
        var t = global.Auth.byId(aid);
        if (!confirm('删除账号「' + (t ? t.name : '') + '」？删除后该账号无法登录。')) return;
        var r2 = global.Auth.remove(aid);
        if (!r2.ok) { toast(r2.msg, 'err'); return; }
        renderAccounts();
        toast('已删除');
      }
    });
    $('accAddNew').addEventListener('click', function () { openAccEdit(null); });
    $('accResetAll').addEventListener('click', function () {
      if (!confirm('恢复为默认账号？自建账号会被清空，当前登录也会退出。')) return;
      global.Auth.resetAll();
      ME = null;
      closeModal('accountsModal');
      showLogin();
      toast('已恢复默认账号');
    });

    $('aeSave').addEventListener('click', saveAcc);
    $('aeActive').addEventListener('click', function () { this.classList.toggle('is-on'); });
    $('aeGenPass').addEventListener('click', function () {
      var chars = 'abcdefghjkmnpqrstuvwxyz23456789';
      var out = '';
      for (var i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
      $('aePassword').value = out;
    });
    $('aeRole').addEventListener('change', function () {
      if (this.value === 'admin') $('aePerson').value = '';
    });

    $('pwdSave').addEventListener('click', savePwd);
  }

  /* =========================================================
     启动
     ========================================================= */
  function init() {
    document.body.dataset.module = S.module;

    $$('#mainNav .mn-btn').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.module === S.module);
    });

    if (global.Train) global.Train.init(S, { openSettings: openSettings });
    if (global.Staff) global.Staff.init(S);

    bindBase();
    bindSettings();
    bindAuth();
    updateEnginePill();

    ME = global.Auth.current();
    if (ME) applyRole();
    else showLogin();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.App = {
    state: S,
    toast: toast,
    persist: persist,
    openSettings: openSettings,
    switchModule: switchModule,
    openModal: openModal,
    closeModal: closeModal,
    me: function () { return ME; },
    openAccounts: function () { renderAccounts(); openModal('accountsModal'); },
    project: activeProject
  };
})(window);
