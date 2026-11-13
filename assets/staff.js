/* =========================================================
   员工库
   ---------------------------------------------------------
   平台里所有「人」只从这一处来。培训分派、学员登录、成绩统计
   都读这里，不再各存一份名单。

   来源三种：
   - seed      首次运行时的示例员工
   - manual    手工添加
   - import    从 HR 花名册 / Excel 导进来
   - dingtalk  从钉钉通讯录同步（接口位，需接企业内部应用）

   入职培训靠 joinedAt 判定：入职 30 天内算新员工。项目上打开
   「新员工自动加入」，同步进来的新人会自动进入该项目。
   ========================================================= */
(function (global) {
  'use strict';

  var C = global.Core;
  var S = null;
  var bound = false;

  var NEW_HIRE_DAYS = 30;

  function $(id) { return document.getElementById(id); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return C.esc(s); }
  function persist() { if (S) C.Store.save(S); }

  /* =========================================================
     数据
     ========================================================= */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function p2(n) { return n < 10 ? '0' + n : '' + n; }

  function seedStaff() {
    var seed = (global.TrainData && global.TrainData.seedPeople) || [];
    return seed.map(function (p, i) {
      return {
        id: p.id,
        name: p.name,
        dept: p.dept,
        role: p.role,
        mail: p.mail,
        source: 'seed',
        active: true,
        joinedAt: '2026-0' + (i % 8 + 1) + '-01',
        jobNo: ''
      };
    });
  }

  function ensure() {
    if (!S.staff || !Array.isArray(S.staff) || !S.staff.length) {
      S.staff = seedStaff();
    }
    S.staff.forEach(function (x) {
      if (x.active == null) x.active = true;
      if (!x.source) x.source = 'manual';
      if (!x.joinedAt) x.joinedAt = today();
    });
  }

  function all() { if (!S) return []; ensure(); return S.staff; }
  function active() { return all().filter(function (x) { return x.active; }); }

  function byId(id) {
    return all().filter(function (x) { return x.id === id; })[0] || null;
  }

  /** 入职天数；未知入职日期返回 null */
  function tenureDays(p) {
    if (!p || !p.joinedAt) return null;
    var t = new Date(p.joinedAt + 'T00:00:00').getTime();
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  function isNewHire(p) {
    var d = tenureDays(p);
    return d != null && d >= 0 && d <= NEW_HIRE_DAYS;
  }

  function depts() {
    var out = [];
    all().forEach(function (x) {
      if (out.indexOf(x.dept) < 0) out.push(x.dept);
    });
    return out;
  }

  function stats() {
    var list = all();
    return {
      total: list.length,
      active: list.filter(function (x) { return x.active; }).length,
      off: list.filter(function (x) { return !x.active; }).length,
      newHire: list.filter(function (x) { return x.active && isNewHire(x); }).length,
      manual: list.filter(function (x) { return x.source === 'manual'; }).length,
      imported: list.filter(function (x) { return x.source === 'import'; }).length,
      dingtalk: list.filter(function (x) { return x.source === 'dingtalk'; }).length
    };
  }

  /* =========================================================
     增删改
     ========================================================= */
  function nextId() {
    var n = 1, id;
    do {
      id = 'e' + String(n).padStart(3, '0');
      n++;
    } while (byId(id));
    return id;
  }

  function add(obj) {
    ensure();
    var p = {
      id: nextId(),
      name: (obj.name || '').trim(),
      dept: (obj.dept || '').trim() || '未分组',
      role: (obj.role || '').trim(),
      mail: (obj.mail || '').trim(),
      jobNo: (obj.jobNo || '').trim(),
      joinedAt: obj.joinedAt || today(),
      source: obj.source || 'manual',
      active: obj.active !== false
    };
    if (!p.name) return null;
    S.staff.push(p);
    persist();
    return p;
  }

  function update(id, patch) {
    var p = byId(id);
    if (!p) return null;
    Object.keys(patch).forEach(function (k) {
      if (patch[k] !== undefined) p[k] = patch[k];
    });
    persist();
    return p;
  }

  function remove(id) {
    ensure();
    var before = S.staff.length;
    S.staff = S.staff.filter(function (x) { return x.id !== id; });
    if (S.staff.length === before) return false;
    // 从所有项目的分派名单里摘掉
    (S.projects || []).forEach(function (pr) {
      pr.people = (pr.people || []).filter(function (pid) { return pid !== id; });
      pr.records = (pr.records || []).filter(function (r) { return r.pid !== id; });
    });
    persist();
    return true;
  }

  /* =========================================================
     导入
     ========================================================= */
  /** 解析一行 CSV（处理引号与逗号） */
  function splitCsvLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  var HEAD_ALIAS = {
    name: ['姓名', '名字', '员工姓名', 'name'],
    dept: ['部门', '所属部门', 'dept', 'department'],
    role: ['岗位', '职位', '职务', 'role', 'title'],
    mail: ['邮箱', '邮件', '企业邮箱', 'mail', 'email'],
    jobNo: ['工号', '员工编号', 'jobno', 'job_no', 'employeeid'],
    joinedAt: ['入职日期', '入职时间', '入職日期', 'joinedat', 'hiredate', 'join_date'],
    phone: ['手机', '手机号', '电话', 'phone', 'mobile']
  };

  function mapHeader(cells) {
    var map = {};
    cells.forEach(function (raw, i) {
      var h = String(raw).replace(/\s/g, '').toLowerCase();
      Object.keys(HEAD_ALIAS).forEach(function (key) {
        if (map[key] != null) return;
        if (HEAD_ALIAS[key].some(function (a) { return h === a.toLowerCase(); })) map[key] = i;
      });
    });
    return map;
  }

  function normDate(s) {
    var v = String(s || '').trim();
    if (!v) return '';
    var m = v.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (m) return m[1] + '-' + p2(m[2]) + '-' + p2(m[3]);
    var d = new Date(v);
    if (!isNaN(d.getTime())) return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    return '';
  }

  /**
   * 导入 CSV 文本。返回 { added, updated, skipped, preview }
   * 按 姓名 + 邮箱 判重：已存在就更新部门岗位，不重复添加。
   */
  function importCsv(text, dryRun) {
    var lines = String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
    if (lines.length < 2) return { added: 0, updated: 0, skipped: 0, preview: [], error: '至少要有表头和一行数据' };

    var head = mapHeader(splitCsvLine(lines[0]));
    if (head.name == null) return { added: 0, updated: 0, skipped: 0, preview: [], error: '表头里找不到「姓名」列' };

    var added = 0, updated = 0, skipped = 0, preview = [];
    ensure();

    lines.slice(1).forEach(function (line) {
      var cells = splitCsvLine(line);
      var name = (cells[head.name] || '').trim();
      if (!name) { skipped++; return; }

      var rec = {
        name: name,
        dept: head.dept != null ? (cells[head.dept] || '').trim() : '',
        role: head.role != null ? (cells[head.role] || '').trim() : '',
        mail: head.mail != null ? (cells[head.mail] || '').trim() : '',
        jobNo: head.jobNo != null ? (cells[head.jobNo] || '').trim() : '',
        joinedAt: head.joinedAt != null ? normDate(cells[head.joinedAt]) : ''
      };

      var hit = all().filter(function (x) {
        if (rec.mail && x.mail && x.mail.toLowerCase() === rec.mail.toLowerCase()) return true;
        return x.name === rec.name && (!rec.mail || !x.mail);
      })[0];

      if (hit) {
        if (!dryRun) {
          if (rec.dept) hit.dept = rec.dept;
          if (rec.role) hit.role = rec.role;
          if (rec.jobNo) hit.jobNo = rec.jobNo;
          if (rec.joinedAt) hit.joinedAt = rec.joinedAt;
        }
        updated++;
        preview.push({ kind: 'update', name: rec.name, dept: rec.dept || hit.dept });
      } else {
        if (!dryRun) {
          add({ name: rec.name, dept: rec.dept, role: rec.role, mail: rec.mail, jobNo: rec.jobNo, joinedAt: rec.joinedAt, source: 'import' });
        }
        added++;
        preview.push({ kind: 'add', name: rec.name, dept: rec.dept || '未分组' });
      }
    });

    if (!dryRun) {
      persist();
      syncAutoJoin();
    }
    return { added: added, updated: updated, skipped: skipped, preview: preview };
  }

  /* =========================================================
     钉钉同步（接口位）
     =========================================================
     要真正接钉钉，需要企业内应用的三样东西：
       AppKey / AppSecret → 换 access_token
       通讯录读权限 → /topapi/v2/user/list 拉部门与人员
     浏览器直连会被 CORS 和 secret 泄露挡住，正式做法是加一层
     自己的后端定时拉，前端只读结果。这里先把落点留好：
     把后端返回的人员数组交给 ingest()，剩下的和 CSV 导入一样。
     ========================================================= */
  function dingtalkReady() {
    return !!(S.ding && S.ding.enabled && S.ding.endpoint);
  }

  /** 外部（钉钉后端 / 手工粘贴 JSON）把人员推进来 */
  function ingest(rows, sourceTag) {
    if (!Array.isArray(rows)) return { added: 0, updated: 0 };
    var added = 0, updated = 0;
    ensure();
    rows.forEach(function (r) {
      var name = (r.name || r.姓名 || '').trim();
      if (!name) return;
      var mail = (r.mail || r.email || r.邮箱 || '').trim();
      var hit = all().filter(function (x) {
        if (mail && x.mail && x.mail.toLowerCase() === mail.toLowerCase()) return true;
        return x.name === name;
      })[0];
      if (hit) {
        hit.dept = r.dept || r.部门 || hit.dept;
        hit.role = r.role || r.岗位 || hit.role;
        hit.mail = mail || hit.mail;
        hit.joinedAt = normDate(r.joinedAt || r.入职日期) || hit.joinedAt;
        updated++;
      } else {
        add({
          name: name,
          dept: r.dept || r.部门 || '',
          role: r.role || r.岗位 || '',
          mail: mail,
          jobNo: r.jobNo || r.工号 || '',
          joinedAt: normDate(r.joinedAt || r.入职日期) || today(),
          source: sourceTag || 'dingtalk'
        });
        added++;
      }
    });
    persist();
    syncAutoJoin();
    return { added: added, updated: updated };
  }

  /** 把新入职员工自动塞进开了 autoJoin 的项目 */
  function syncAutoJoin() {
    var joined = 0;
    (S.projects || []).forEach(function (p) {
      if (!p.autoJoin || p.status === 'closed') return;
      active().filter(isNewHire).forEach(function (x) {
        if (p.people.indexOf(x.id) < 0) {
          p.people.push(x.id);
          joined++;
        }
      });
    });
    if (joined) persist();
    return joined;
  }

  /* =========================================================
     界面
     ========================================================= */
  var filter = { kind: 'all', dept: '', kw: '' };

  function render() {
    ensure();
    var st = stats();

    $('staffMeta').textContent = st.total + ' 人 · ' + st.active + ' 在岗' +
      (st.off ? ' · ' + st.off + ' 停用' : '') +
      (st.newHire ? ' · ' + st.newHire + ' 位新入职' : '');

    $('snAll').textContent = st.total;
    $('snNew').textContent = st.newHire;
    $('snOff').textContent = st.off;

    $$('#staffTabs .stb-tab').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.sf === filter.kind);
    });

    $('staffDept').innerHTML = '<button class="stb-dept-btn' + (filter.dept ? '' : ' is-on') + '" data-dept="">全部部门</button>' +
      depts().map(function (d) {
        return '<button class="stb-dept-btn' + (filter.dept === d ? ' is-on' : '') + '" data-dept="' + esc(d) + '">' +
          esc(d) + '</button>';
      }).join('');

    var kw = filter.kw.trim().toLowerCase();
    var list = all().filter(function (x) {
      if (filter.kind === 'new' && !(x.active && isNewHire(x))) return false;
      if (filter.kind === 'off' && x.active) return false;
      if (filter.dept && x.dept !== filter.dept) return false;
      if (kw) {
        var hay = (x.name + x.dept + (x.role || '') + (x.mail || '') + (x.jobNo || '')).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });

    if (!list.length) {
      $('staffBody').innerHTML = '<div class="staff-empty">没有匹配的员工。' +
        (kw || filter.dept || filter.kind !== 'all' ? '换个条件试试，或者' : '') +
        '点右上角「加员工」。</div>';
      return;
    }

    $('staffBody').innerHTML =
      '<table class="staff-table"><thead><tr>' +
        '<th>姓名</th><th>部门</th><th>岗位</th><th>邮箱</th><th>入职</th><th>来源</th><th></th>' +
      '</tr></thead><tbody>' +
      list.map(function (x) {
        var d = tenureDays(x);
        var tenure = d == null ? '—'
          : d < 0 ? '待入职'
          : d < NEW_HIRE_DAYS ? '<span class="sft-new">入职 ' + (d || 1) + ' 天</span>'
          : (Math.floor(d / 30) || 1) + ' 个月';
        var srcName = { seed: '示例', manual: '手工', import: '导入', dingtalk: '钉钉' }[x.source] || x.source;
        return '<tr' + (x.active ? '' : ' class="is-off"') + ' data-eid="' + x.id + '">' +
          '<td><b class="sft-name">' + esc(x.name) + '</b>' +
            (x.jobNo ? '<span class="sft-no">' + esc(x.jobNo) + '</span>' : '') + '</td>' +
          '<td>' + esc(x.dept) + '</td>' +
          '<td class="sft-dim">' + esc(x.role || '—') + '</td>' +
          '<td class="sft-dim">' + esc(x.mail || '—') + '</td>' +
          '<td class="sft-dim">' + tenure + '</td>' +
          '<td><span class="sft-src s-' + x.source + '">' + srcName + '</span>' +
            (x.active ? '' : '<span class="sft-src s-off">停用</span>') + '</td>' +
          '<td class="sft-ops">' +
            '<button class="qa-btn" data-eact="edit" data-eid="' + x.id + '">编辑</button>' +
            '<button class="qa-btn" data-eact="toggle" data-eid="' + x.id + '">' + (x.active ? '停用' : '启用') + '</button>' +
            '<button class="qa-btn del" data-eact="del" data-eid="' + x.id + '">删除</button>' +
          '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  /* ---------- 弹窗：加 / 改 ---------- */
  var editingId = null;

  function openEdit(id) {
    editingId = id || null;
    var e = id ? byId(id) : null;
    $('seTitle').textContent = e ? '编辑员工' : '加员工';
    $('seName').value = e ? e.name : '';
    $('seDept').value = e ? e.dept : (filter.dept || '');
    $('seRole').value = e ? (e.role || '') : '';
    $('seMail').value = e ? (e.mail || '') : '';
    $('seJobNo').value = e ? (e.jobNo || '') : '';
    $('seJoined').value = e ? (e.joinedAt || today()) : today();
    $('seErr').textContent = '';
    if (global.App && global.App.openModal) global.App.openModal('staffEditModal');
    else document.getElementById('staffEditModal').classList.add('is-on');
    setTimeout(function () { $('seName').focus(); }, 120);
  }

  function saveEdit() {
    var name = $('seName').value.trim();
    if (!name) { $('seErr').textContent = '姓名不能空着'; $('seName').focus(); return; }

    var patch = {
      name: name,
      dept: $('seDept').value.trim() || '未分组',
      role: $('seRole').value.trim(),
      mail: $('seMail').value.trim(),
      jobNo: $('seJobNo').value.trim(),
      joinedAt: $('seJoined').value || today()
    };

    if (editingId) update(editingId, patch);
    else add(patch);

    syncAutoJoin();
    render();
    if (global.App && global.App.closeModal) global.App.closeModal('staffEditModal');
    else document.getElementById('staffEditModal').classList.remove('is-on');
    if (global.App && global.App.toast) global.App.toast(editingId ? '已更新' : '已加入员工库');
    editingId = null;
  }

  /* ---------- 导入 ---------- */
  var importRows = [];

  function openImport() {
    importRows = [];
    $('siFile').value = '';
    $('siText').value = '';
    $('siPreview').innerHTML = '';
    $('siFoot').innerHTML = '';
    if (global.App && global.App.openModal) global.App.openModal('staffImportModal');
  }

  function runImport(text) {
    var r = importCsv(text, true);
    if (r.error) {
      $('siPreview').innerHTML = '<div class="si-err">' + esc(r.error) + '</div>';
      $('siFoot').innerHTML = '';
      return null;
    }
    importRows = r;
    $('siPreview').innerHTML =
      '<div class="si-sum">识别到 <b>' + (r.added + r.updated) + '</b> 人：新增 <b>' + r.added + '</b>，更新 <b>' + r.updated + '</b>' +
        (r.skipped ? '，跳过 ' + r.skipped + ' 行' : '') + '</div>' +
      '<div class="si-list">' + r.preview.slice(0, 12).map(function (x) {
        return '<div class="si-row"><span class="si-k ' + x.kind + '">' + (x.kind === 'add' ? '新增' : '更新') + '</span>' +
          '<b>' + esc(x.name) + '</b><span>' + esc(x.dept) + '</span></div>';
      }).join('') + (r.preview.length > 12 ? '<div class="si-more">还有 ' + (r.preview.length - 12) + ' 人…</div>' : '') + '</div>';
    $('siFoot').innerHTML = '<button class="btn btn-primary btn-sm" id="siDo">确认导入 ' + (r.added + r.updated) + ' 人</button>';
    $('siDo').onclick = function () {
      var done = importCsv(text, false);
      if (global.App && global.App.closeModal) global.App.closeModal('staffImportModal');
      render();
      if (global.App && global.App.toast) {
        global.App.toast('导入完成：新增 ' + done.added + ' 人，更新 ' + done.updated + ' 人');
      }
    };
    return r;
  }

  /* ---------- 钉钉 ---------- */
  function openDing() {
    var ready = dingtalkReady();
    $('sdState').className = 'sd-state' + (ready ? ' is-on' : '');
    $('sdState').innerHTML = ready
      ? '<b>已连接</b><span>同步来源：' + esc(S.ding.endpoint) + '</span>'
      : '<b>未连接</b><span>还没有配置钉钉企业内部应用</span>';

    $('sdBody').innerHTML = ready
      ? '<button class="btn btn-primary btn-sm" id="sdPull">立即同步通讯录</button>'
      : '<ol class="sd-steps">' +
          '<li>在钉钉开放平台建一个<b>企业内部应用</b>，开通「通讯录部门信息读权限」「成员信息读权限」。</li>' +
          '<li>拿 AppKey / AppSecret 换 access_token，拉 <code>/topapi/v2/user/list</code>。这一步要走服务端，浏览器直连会暴露 secret。</li>' +
          '<li>把人名、部门、岗位、入职日期写进这个项目的数据源，前端只读结果。' +
            '现在可以直接把后端返回的 JSON 贴进来试：</li>' +
        '</ol>' +
        '<textarea class="input" id="sdJson" placeholder=\'[{"name":"张三","dept":"金融事业部","role":"业务分析","mail":"zhangsan@example.com","joinedAt":"2026-11-01"}]\' style="min-height:120px;font-family:var(--mono);font-size:13.5px"></textarea>' +
        '<button class="btn btn-primary btn-sm" id="sdPull" style="margin-top:10px">按这份数据同步</button>';

    if (global.App && global.App.openModal) global.App.openModal('staffDingModal');

    var btn = $('sdPull');
    if (!btn) return;
    btn.onclick = function () {
      if (ready) {
        btn.disabled = true;
        btn.textContent = '同步中…';
        fetch(S.ding.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var r = ingest(data.list || data.rows || data, 'dingtalk');
            if (global.App && global.App.closeModal) global.App.closeModal('staffDingModal');
            render();
            if (global.App && global.App.toast) global.App.toast('同步完成：新增 ' + r.added + ' 人，更新 ' + r.updated + ' 人');
          })
          .catch(function () {
            btn.disabled = false;
            btn.textContent = '立即同步通讯录';
            if (global.App && global.App.toast) global.App.toast('同步失败，检查中转地址和网络', 'err');
          });
        return;
      }

      var raw = ($('sdJson').value || '').trim();
      if (!raw) { if (global.App && global.App.toast) global.App.toast('先贴一段 JSON', 'err'); return; }
      var rows;
      try { rows = JSON.parse(raw); } catch (e) {
        if (global.App && global.App.toast) global.App.toast('JSON 格式不对', 'err');
        return;
      }
      var r = ingest(rows, 'dingtalk');
      if (global.App && global.App.closeModal) global.App.closeModal('staffDingModal');
      render();
      if (global.App && global.App.toast) global.App.toast('同步完成：新增 ' + r.added + ' 人，更新 ' + r.updated + ' 人');
    };
  }

  /* =========================================================
     绑定
     ========================================================= */
  function bind() {
    if (bound) return;
    bound = true;

    $('staffTabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sf]');
      if (!b) return;
      filter.kind = b.dataset.sf;
      render();
    });

    $('staffDept').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dept]');
      if (!b) return;
      filter.dept = b.dataset.dept;
      render();
    });

    $('staffSearch').addEventListener('input', function () {
      filter.kw = this.value;
      render();
      var box = $('staffSearch');
      if (box) { box.focus(); box.selectionStart = box.selectionEnd = box.value.length; }
    });

    $('staffBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-eact]');
      if (!b) return;
      var id = b.dataset.eid;
      var act = b.dataset.eact;
      var p = byId(id);
      if (!p) return;

      if (act === 'edit') { openEdit(id); return; }
      if (act === 'toggle') {
        update(id, { active: !p.active });
        render();
        return;
      }
      if (act === 'del') {
        if (!confirm('从员工库删除「' + p.name + '」？他的培训记录也会一起清掉。只想停用就点「停用」。')) return;
        remove(id);
        render();
        if (global.App && global.App.toast) global.App.toast('已删除');
      }
    });

    $('btnStaffAdd').addEventListener('click', function () { openEdit(null); });
    $('btnStaffImport').addEventListener('click', openImport);
    $('btnStaffSync').addEventListener('click', openDing);

    $('seSave').addEventListener('click', saveEdit);

    $('siFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        $('siText').value = text;
        runImport(text);
      };
      reader.readAsText(f, 'utf-8');
      e.target.value = '';
    });

    $('siParse').addEventListener('click', function () {
      var t = $('siText').value.trim();
      if (!t) { if (global.App && global.App.toast) global.App.toast('先选文件或粘贴表格', 'err'); return; }
      runImport(t);
    });

    $('siSample').addEventListener('click', function () {
      var sample = '姓名,部门,岗位,邮箱,工号,入职日期\n' +
        '张三,金融事业部,业务分析,zhangsan@example.com,DG1024,2026-11-01\n' +
        '李四,研发中心,后端开发,lisi@example.com,DG1025,2026-11-03\n';
      $('siText').value = sample;
      runImport(sample);
    });
  }

  /* =========================================================
     对外
     ========================================================= */
  function init(sharedState) {
    S = sharedState;
    ensure();
    bind();
    render();
  }

  function onShow() {
    if (!S) return;
    ensure();
    render();
  }

  global.Staff = {
    init: init,
    onShow: onShow,
    render: render,
    all: all,
    active: active,
    byId: byId,
    add: add,
    update: update,
    remove: remove,
    depts: depts,
    stats: stats,
    isNewHire: isNewHire,
    tenureDays: tenureDays,
    importCsv: importCsv,
    ingest: ingest,
    syncAutoJoin: syncAutoJoin,
    openEdit: openEdit,
    NEW_HIRE_DAYS: NEW_HIRE_DAYS
  };

  /* =========================================================
     桥接：让老的 TD.people / TD.personById 读到活的员工库
     ---------------------------------------------------------
     培训、学员端原来直接吃 TrainData.people 这个写死的数组。
     改成 getter 后，员工库增删改立即生效，且不用改所有调用点。
     ========================================================= */
  function bridge() {
    var TD = global.TrainData;
    if (!TD || TD.__bridged) return;
    TD.__bridged = true;

    var fallback = function () { return TD.seedPeople || []; };

    try {
      Object.defineProperty(TD, 'people', {
        // 状态还没注入时（脚本初始化阶段）退回种子，避免空引用
        get: function () { return S ? active() : fallback(); },
        configurable: true
      });
      Object.defineProperty(TD, 'personById', {
        value: function (id) {
          var list = S ? all() : fallback();
          return list.filter(function (p) { return p.id === id; })[0] || null;
        },
        configurable: true,
        writable: true
      });
    } catch (e) {
      TD.personById = function (id) {
        var list = S ? all() : fallback();
        return list.filter(function (p) { return p.id === id; })[0] || null;
      };
    }
  }
  bridge();
})(window);
