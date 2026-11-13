/* =========================================================
   core.js — 常量 / 状态 / 本地存储
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 题型定义 ---------- */
  var TYPES = [
    { key: 'single', name: '单选题', badge: '单选', cls: 'tb-single', color: '#2b4ed6',
      score: 4, minOpts: 2, maxOpts: 6, hasOptions: true, multi: false,
      desc: '一个正确答案' },
    { key: 'multi',  name: '多选题', badge: '多选', cls: 'tb-multi', color: '#00806f',
      score: 6, minOpts: 2, maxOpts: 6, hasOptions: true, multi: true,
      desc: '两个以上正确答案' },
    { key: 'judge',  name: '判断题', badge: '判断', cls: 'tb-judge', color: '#b86208',
      score: 3, minOpts: 0, maxOpts: 0, hasOptions: false, multi: false,
      desc: '正确或错误' },
    { key: 'blank',  name: '填空题', badge: '填空', cls: 'tb-blank', color: '#6b3fc9',
      score: 4, minOpts: 0, maxOpts: 0, hasOptions: false, multi: false,
      desc: '挖空关键词' },
    { key: 'essay',  name: '简答题', badge: '简答', cls: 'tb-essay', color: '#b3217a',
      score: 10, minOpts: 0, maxOpts: 0, hasOptions: false, multi: false,
      desc: '主观作答' }
  ];

  var TYPE_MAP = {};
  TYPES.forEach(function (t) { TYPE_MAP[t.key] = t; });

  var DIFFS = [
    { key: 'easy',   name: '简单', cls: 'd-easy' },
    { key: 'medium', name: '中等', cls: 'd-medium' },
    { key: 'hard',   name: '困难', cls: 'd-hard' }
  ];
  var DIFF_MAP = {};
  DIFFS.forEach(function (d) { DIFF_MAP[d.key] = d; });

  var STYLES = {
    concept: { name: '概念理解', hint: '考查对知识点的理解与辨析，适合大多数培训场景。' },
    practice:{ name: '场景应用', hint: '把知识点放进具体工作场景里考，适合制度、流程、操作类培训。' },
    memory:  { name: '记忆要点', hint: '直接考数字、名称、时限等硬性记忆点，适合规章条款。' },
    mixed:   { name: '混合型',   hint: '按题号轮换三种风格，整份试卷更均衡。' }
  };

  /* ---------- 默认导出列 ---------- */
  function defaultColumns() {
    return [
      { field: 'type',       label: '题型',     on: true },
      { field: 'stem',       label: '题干',     on: true },
      { field: 'option:A',   label: '选项A',    on: true },
      { field: 'option:B',   label: '选项B',    on: true },
      { field: 'option:C',   label: '选项C',    on: true },
      { field: 'option:D',   label: '选项D',    on: true },
      { field: 'option:E',   label: '选项E',    on: false },
      { field: 'option:F',   label: '选项F',    on: false },
      { field: 'answer',     label: '正确答案', on: true },
      { field: 'analysis',   label: '答案解析', on: true },
      { field: 'difficulty', label: '难度',     on: true },
      { field: 'score',      label: '分值',     on: true },
      { field: 'point',      label: '考核点',   on: true },
      { field: 'bank',       label: '题库',     on: false }
    ];
  }

  var FIELD_NAMES = {
    type: '题型', stem: '题干', answer: '正确答案', analysis: '答案解析',
    difficulty: '难度', score: '分值', point: '考核点', bank: '题库'
  };

  /* ---------- 默认状态 ---------- */
  function defaultState() {
    return {
      /* 顶层模块：manage 培训管理 | learn 学员中心 */
      module: 'manage',

      /* 出题配置（管理端右栏用） */
      counts: { single: 5, multi: 3, judge: 3, blank: 2, essay: 1 },
      diff: { easy: 30, medium: 50, hard: 20 },
      style: 'mixed',

      /* 设置 */
      llm: { on: false, base: '', key: '', model: '' },
      exportCfg: {
        noteRow: true,
        judgeFmt: 'text-a',
        multiSep: ',',
        columns: defaultColumns()
      },

      /* ===== 培训管理 ===== */
      projects: null,       // 懒初始化
      activeProjectId: '',
      trainTab: 'board',    // board | material | paper | assign
      trainQOpenId: null,
      mailRuleKey: '',
      mailAud: {},           // 每套通知模板各自记住上次选的收件人范围
      mailTo: null,          // 催办时只发给指定的人

      /* ===== 员工库 ===== */
      staff: null,           // 懒初始化，来自 TrainData.seedPeople
      ding: { enabled: false, endpoint: '' },

      /* ===== 学员中心 ===== */
      preview: { on: false, personId: '' }   // 管理员预览学员时的临时态，不落库
    };
  }

  var STORE_KEY = 'zhixue_workshop_v4';

  var Store = {
    load: function () {
      try {
        var raw = localStorage.getItem(STORE_KEY);
        if (!raw) return null;
        var data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        return data;
      } catch (e) { return null; }
    },
    save: function (state) {
      try {
        var slim = {
          module: state.module,
          counts: state.counts,
          diff: state.diff,
          style: state.style,
          llm: state.llm,
          exportCfg: state.exportCfg,
          staff: state.staff,
          ding: state.ding,
          projects: state.projects,
          activeProjectId: state.activeProjectId,
          trainTab: state.trainTab,
          mailAud: state.mailAud
        };
        localStorage.setItem(STORE_KEY, JSON.stringify(slim));
        return true;
      } catch (e) { return false; }
    },
    wipe: function () {
      try {
        localStorage.removeItem(STORE_KEY);
        return true;
      } catch (e) { return false; }
    }
  };

  /* ---------- 工具 ---------- */
  var uidSeq = 0;
  function uid() {
    uidSeq++;
    return 'q' + Date.now().toString(36) + uidSeq.toString(36);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function nowStamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
           '_' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function normalizeText(s) {
    return String(s || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00a0\u3000]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function countChars(s) {
    return String(s || '').replace(/\s/g, '').length;
  }

  /* ---------- 题目工厂 ---------- */
  function makeQuestion(type) {
    var t = TYPE_MAP[type] || TYPE_MAP.single;
    var q = {
      id: uid(),
      type: t.key,
      stem: '',
      options: [],
      answer: t.multi ? [] : '',
      analysis: '',
      difficulty: 'medium',
      score: t.score,
      point: '',
      from: ''
    };
    if (t.hasOptions) {
      q.options = [
        { key: 'A', text: '' },
        { key: 'B', text: '' },
        { key: 'C', text: '' },
        { key: 'D', text: '' }
      ];
      q.answer = t.multi ? ['A'] : 'A';
    }
    return q;
  }

  global.Core = {
    TYPES: TYPES,
    TYPE_MAP: TYPE_MAP,
    DIFFS: DIFFS,
    DIFF_MAP: DIFF_MAP,
    STYLES: STYLES,
    FIELD_NAMES: FIELD_NAMES,
    defaultColumns: defaultColumns,
    defaultState: defaultState,
    Store: Store,
    uid: uid,
    nowStamp: nowStamp,
    esc: esc,
    clone: clone,
    shuffle: shuffle,
    normalizeText: normalizeText,
    countChars: countChars,
    makeQuestion: makeQuestion
  };
})(window);
