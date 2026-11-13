/* =========================================================
   auth.js — 账号、登录、会话
   ========================================================= */
(function (global) {
  'use strict';

  var ACCOUNTS_KEY = 'zx_accounts_v1';
  var SESSION_KEY = 'zx_session_v1';

  var ROLES = {
    admin: { name: '管理员', desc: '可管理培训项目、账号与全部数据' },
    student: { name: '学员', desc: '只查看自己的培训与考核' }
  };

  /* ---------- 默认账号 ---------- */
  function defaultAccounts() {
    var TD = global.TrainData;
    var list = [{
      id: 'u-admin',
      username: 'admin',
      password: 'admin2026',
      name: '宋知微',
      role: 'admin',
      dept: '人力资源部',
      title: '培训负责人',
      personId: 'p09',
      active: true,
      createdAt: '2026-11-01'
    }];

    // 每个员工一个学员账号，用户名取邮箱前缀
    (TD ? TD.people : []).forEach(function (p, i) {
      list.push({
        id: 'u-' + p.id,
        username: p.mail.split('@')[0],
        password: 'train2026',
        name: p.name,
        role: 'student',
        dept: p.dept,
        title: p.role,
        personId: p.id,
        active: true,
        createdAt: '2026-11-01'
      });
    });
    return list;
  }

  /* ---------- 存储 ---------- */
  function readAccounts() {
    try {
      var raw = localStorage.getItem(ACCOUNTS_KEY);
      if (!raw) return null;
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr) || !arr.length) return null;
      return arr;
    } catch (e) { return null; }
  }

  function writeAccounts(arr) {
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(arr));
      return true;
    } catch (e) { return false; }
  }

  var _cache = null;

  function all() {
    if (!_cache) _cache = readAccounts() || defaultAccounts();
    return _cache;
  }

  function persistAll() {
    writeAccounts(_cache);
  }

  /* ---------- 会话 ---------- */
  function readSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return s && s.uid ? s : null;
    } catch (e) { return null; }
  }

  function writeSession(s) {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { }
  }

  /* ---------- 对外 ---------- */
  function byUsername(u) {
    var key = String(u || '').trim().toLowerCase();
    return all().find(function (a) { return a.username.toLowerCase() === key; });
  }

  function byId(id) {
    return all().find(function (a) { return a.id === id; });
  }

  function login(username, password) {
    var u = String(username || '').trim();
    var p = String(password || '');
    if (!u || !p) return { ok: false, msg: '请输入账号和密码' };

    var acc = byUsername(u);
    if (!acc) return { ok: false, msg: '账号不存在' };
    if (!acc.active) return { ok: false, msg: '该账号已停用，请联系管理员' };
    if (acc.password !== p) return { ok: false, msg: '密码不正确' };

    writeSession({ uid: acc.id, at: Date.now() });
    return { ok: true, account: acc };
  }

  function logout() {
    writeSession(null);
  }

  function current() {
    var s = readSession();
    if (!s) return null;
    var acc = byId(s.uid);
    if (!acc || !acc.active) { writeSession(null); return null; }
    return acc;
  }

  function isAdmin() {
    var c = current();
    return !!c && c.role === 'admin';
  }

  /* ---------- 账号维护 ---------- */
  function nextId() {
    return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function add(data) {
    var username = String(data.username || '').trim();
    if (!username) return { ok: false, msg: '账号不能为空' };
    if (!/^[a-zA-Z0-9_.@-]{3,24}$/.test(username)) {
      return { ok: false, msg: '账号用 3-24 位字母、数字或 _ . @ -' };
    }
    if (byUsername(username)) return { ok: false, msg: '账号 ' + username + ' 已存在' };
    if (!data.password || String(data.password).length < 6) {
      return { ok: false, msg: '密码至少 6 位' };
    }
    if (!data.name || !String(data.name).trim()) return { ok: false, msg: '姓名不能为空' };

    var acc = {
      id: nextId(),
      username: username,
      password: String(data.password),
      name: String(data.name).trim(),
      role: data.role === 'admin' ? 'admin' : 'student',
      dept: String(data.dept || '').trim(),
      title: String(data.title || '').trim(),
      personId: data.personId || '',
      active: data.active !== false,
      createdAt: new Date().toISOString().slice(0, 10)
    };
    _cache.push(acc);
    persistAll();
    return { ok: true, account: acc };
  }

  function update(id, patch) {
    var acc = byId(id);
    if (!acc) return { ok: false, msg: '账号不存在' };

    if (patch.username != null) {
      var un = String(patch.username).trim();
      if (!un) return { ok: false, msg: '账号不能为空' };
      if (!/^[a-zA-Z0-9_.@-]{3,24}$/.test(un)) return { ok: false, msg: '账号格式不合法' };
      var other = byUsername(un);
      if (other && other.id !== id) return { ok: false, msg: '账号 ' + un + ' 已存在' };
      acc.username = un;
    }
    if (patch.password != null) {
      if (String(patch.password).length < 6) return { ok: false, msg: '密码至少 6 位' };
      acc.password = String(patch.password);
    }
    if (patch.name != null) {
      if (!String(patch.name).trim()) return { ok: false, msg: '姓名不能为空' };
      acc.name = String(patch.name).trim();
    }
    if (patch.role != null) acc.role = patch.role === 'admin' ? 'admin' : 'student';
    if (patch.dept != null) acc.dept = String(patch.dept).trim();
    if (patch.title != null) acc.title = String(patch.title).trim();
    if (patch.personId != null) acc.personId = patch.personId;
    if (patch.active != null) acc.active = !!patch.active;

    persistAll();
    return { ok: true, account: acc };
  }

  function remove(id) {
    var acc = byId(id);
    if (!acc) return { ok: false, msg: '账号不存在' };
    if (acc.role === 'admin') {
      var admins = all().filter(function (a) { return a.role === 'admin' && a.active; });
      if (admins.length <= 1) return { ok: false, msg: '至少要保留一个管理员账号' };
    }
    _cache = all().filter(function (a) { return a.id !== id; });
    persistAll();
    return { ok: true };
  }

  function resetAll() {
    _cache = defaultAccounts();
    persistAll();
    writeSession(null);
    return _cache.length;
  }

  function stats() {
    var list = all();
    return {
      total: list.length,
      admin: list.filter(function (a) { return a.role === 'admin'; }).length,
      student: list.filter(function (a) { return a.role === 'student'; }).length,
      inactive: list.filter(function (a) { return !a.active; }).length
    };
  }

  global.Auth = {
    roles: ROLES,
    all: all,
    byId: byId,
    byUsername: byUsername,
    login: login,
    logout: logout,
    current: current,
    isAdmin: isAdmin,
    add: add,
    update: update,
    remove: remove,
    resetAll: resetAll,
    stats: stats,
    defaultAccounts: defaultAccounts
  };
})(window);
