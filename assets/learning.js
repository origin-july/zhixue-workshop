/* =========================================================
   学习引擎
   - BKT：按知识点更新「已掌握」概率（Corbett & Anderson, 1995）
   - FSRS-lite：DSR 三量算遗忘曲线与下次复习日
   - 错题状态机：连对 2 次毕业
   - 事件溯源：只存作答事件，掌握度随时可重算
   所有数值都由确定性算法算出，可直接向学员解释
   ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 参数 ----------
     教科书的起步值。企业培训场景把 MASTERED 从 0.95 放宽到 0.85：
     培训考的是「能不能照做」，不是「学术意义上的精通」。
  */
  var BKT = {
    P_INIT: 0.2,       // 没做过题时，假定 20% 概率已经会了
    P_GUESS: 0.2,      // 不会但猜对的概率（选择题有这个底噪）
    P_SLIP: 0.15,      // 会了但答错的概率。教科书取 0.1，培训场景调高：
                       // 员工看错题、点错选项比闭卷考试常见，一次答错不该直接判「不会」
    P_TRANSIT: 0.15,   // 每做一次题，从不会变成会的概率
    MAX: 0.999
  };

  var FSRS = {
    S_INIT: 1.0,       // 稳定性：保持率掉到 0.9 所需天数
    D_INIT: 5.0,       // 难度，1~10
    S_MIN: 0.5,
    D_MIN: 1,
    D_MAX: 10,
    TARGET: 0.9        // 目标保持率
  };

  var MASTERED = 0.85;      // 判定「熟练」的阈值
  var MIN_EVIDENCE = 2;     // 少于这条数不给分数（培训一次考试就能出分）
  var GRADUATE_STREAK = 2;  // 错题连对几次算毕业
  var ALGO_VERSION = 'bkt1_fsrs1';

  var DAY = 86400000;

  /* =========================================================
     BKT：更新掌握概率
     答对答错都不直接下结论 —— 存在猜对和失误
     ========================================================= */
  function bktUpdate(pKnown, correct) {
    var p = Number(pKnown);
    if (!isFinite(p) || p <= 0) p = BKT.P_INIT;
    if (p > 1) p = 1;

    var num, den;
    if (correct) {
      // 观测到答对：在「已经会了」假设下有多可能
      num = p * (1 - BKT.P_SLIP);
      den = num + (1 - p) * BKT.P_GUESS;
    } else {
      // 观测到答错
      num = p * BKT.P_SLIP;
      den = num + (1 - p) * (1 - BKT.P_GUESS);
    }
    var posterior = den > 0 ? num / den : p;

    // 做题这件事本身就在学习，所以哪怕答错，也会往上推一点
    var next = posterior + (1 - posterior) * BKT.P_TRANSIT;
    return Math.min(BKT.MAX, Math.max(0.001, next));
  }

  /* =========================================================
     FSRS-lite：稳定性 / 难度 / 保持率
     ========================================================= */

  /** 判定这次作答的档位，规则确定，不由模型输出 */
  function ratingOf(correct, opt) {
    if (!correct) return 'again';
    opt = opt || {};
    if (opt.easy) return 'easy';
    if (opt.hinted || opt.retried) return 'hard';
    return 'good';
  }

  /** 难度只在一个地方起作用：调节稳定性涨多少 */
  function dFactor(D) {
    // D=1 → ×1.33，D=5 → ×1.00，D=10 → ×0.58
    var f = 1 - (D - 5) * (0.75 / 9);
    return Math.max(0.45, Math.min(1.6, f));
  }

  function nextStability(S, D, rating) {
    var s = Number(S) > 0 ? Number(S) : FSRS.S_INIT;
    var d = Number(D) > 0 ? Number(D) : FSRS.D_INIT;
    var base = { again: 0.5, hard: 1.2, good: 2.0, easy: 3.0 }[rating] || 2.0;

    var ns;
    if (rating === 'again') {
      ns = s * 0.5;          // 答错直接收紧，不受难度影响
    } else {
      ns = s * base * dFactor(d);
    }
    return Math.max(FSRS.S_MIN, Math.round(ns * 100) / 100);
  }

  function nextDifficulty(D, rating) {
    var d = Number(D) > 0 ? Number(D) : FSRS.D_INIT;
    // 答错把难度推满 1 分，答对回落 0.5 —— 代价不对称，往安全一侧偏
    d += rating === 'again' ? 1.0 : -0.5;
    return Math.max(FSRS.D_MIN, Math.min(FSRS.D_MAX, Math.round(d * 10) / 10));
  }

  /** 保持率：从「上次复习」到现在还能想起来的比例 */
  function retention(S, lastAt, now) {
    var s = Number(S) > 0 ? Number(S) : FSRS.S_INIT;
    var days = Math.max(0, ((now || Date.now()) - (lastAt || Date.now())) / DAY);
    // S 的定义就是「保持率掉到 0.9 所需天数」，所以到期那天恰好是 0.9
    return Math.pow(FSRS.TARGET, days / s);
  }

  function dueAt(S, lastAt) {
    var s = Number(S) > 0 ? Number(S) : FSRS.S_INIT;
    return (lastAt || Date.now()) + s * DAY;
  }

  /* =========================================================
     单个知识点的状态推进
     ========================================================= */
  function newState() {
    return {
      p: BKT.P_INIT,       // BKT 掌握概率
      S: FSRS.S_INIT,      // 稳定性（天）
      D: FSRS.D_INIT,      // 难度
      n: 0,                // 客观作答次数
      right: 0,
      wrong: 0,
      lastAt: 0,           // 上次作答时间
      due: 0,              // 下次复习时间
      streak: 0,           // 当前连对
      graduated: false,    // 错题是否已毕业
      relapsed: 0          // 毕业后又错的次数
    };
  }

  function advance(st, correct, at, opt) {
    var rating = ratingOf(correct, opt);

    st.p = bktUpdate(st.p, correct);
    st.S = nextStability(st.S, st.D, rating);
    st.D = nextDifficulty(st.D, rating);
    st.n += 1;
    if (correct) st.right += 1; else st.wrong += 1;
    st.lastAt = at;
    st.due = dueAt(st.S, at);

    // 错题状态机
    if (correct) {
      st.streak += 1;
      if (st.wrong > 0 && st.streak >= GRADUATE_STREAK) st.graduated = true;
    } else {
      st.streak = 0;
      if (st.graduated) {
        st.graduated = false;
        st.relapsed += 1;
      }
    }
    return st;
  }

  /* =========================================================
     从事件流重算
     ========================================================= */
  function replay(events, now) {
    now = now || Date.now();
    var byPoint = {};

    (events || []).forEach(function (e) {
      if (!e || e.kind !== 'attempt') return;
      var key = e.point || '综合考核';
      if (!byPoint[key]) byPoint[key] = newState();
      advance(byPoint[key], !!e.correct, e.at || now, {
        hinted: !!e.hinted,
        retried: !!e.retried
      });
    });

    Object.keys(byPoint).forEach(function (k) {
      var st = byPoint[k];
      st.point = k;
      st.retention = retention(st.S, st.lastAt, now);

      // 两个数各管一件事，不混在一起：
      //   p   —— 当时学没学会，决定「熟练/一般/待加强」
      //   score = p × 保持率 —— 现在还能提取出多少，用来画进度条
      // 学会就是学会，忘了是「该复习」，不该把等级拉下来
      var enough = st.n >= MIN_EVIDENCE;
      st.score = enough ? st.p * st.retention : null;
      st.level = enough ? levelOf(st.p) : 'unknown';
      st.mastered = enough && st.p >= MASTERED;
      st.needReview = enough && st.retention < 0.9;
      st.overdue = st.due > 0 && st.due <= now;
    });

    return byPoint;
  }

  /** 掌握度分级 */
  function levelOf(score) {
    if (score == null) return 'unknown';
    if (score >= MASTERED) return 'strong';
    if (score >= 0.6) return 'medium';
    if (score >= 0.3) return 'weak';
    return 'none';
  }

  var LEVELS = {
    strong: { key: 'strong', name: '熟练', cls: 'lv-strong', desc: '可以放心交给他做' },
    medium: { key: 'medium', name: '一般', cls: 'lv-medium', desc: '基本掌握，细节还要巩固' },
    weak: { key: 'weak', name: '待加强', cls: 'lv-weak', desc: '建议再看一遍材料' },
    none: { key: 'none', name: '未掌握', cls: 'lv-none', desc: '这块基本是空白' },
    unknown: { key: 'unknown', name: '数据不足', cls: 'lv-unknown', desc: '这块还没有作答记录' }
  };

  function levelInfo(key) { return LEVELS[key] || LEVELS.unknown; }

  /* =========================================================
     对外接口
     ========================================================= */

  /** 从培训记录里算出逐知识点掌握情况 */
  function masteryOf(rec, now) {
    var states = replay((rec && rec.events) || [], now);
    var list = Object.keys(states).map(function (k) { return states[k]; });

    // 排序：弱的、到期的排前面
    list.sort(function (a, b) {
      var sa = a.score == null ? 2 : a.score;
      var sb = b.score == null ? 2 : b.score;
      if (sa !== sb) return sa - sb;
      return (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0);
    });

    var scored = list.filter(function (s) { return s.score != null; });
    var avg = scored.length
      ? scored.reduce(function (a, s) { return a + s.score; }, 0) / scored.length
      : null;

    return {
      list: list,
      byPoint: states,
      avg: avg,
      scored: scored.length,
      total: list.length,
      weak: list.filter(function (s) { return s.score != null && s.p < 0.6; }),
      due: list.filter(function (s) { return s.overdue; }),
      strong: list.filter(function (s) { return s.level === 'strong'; })
    };
  }

  /** 把一次考试的结果转成事件，追加到记录里 */
  function eventsFromAttempt(detail, at) {
    at = at || Date.now();
    return (detail || []).map(function (d) {
      var q = d.q || {};
      return {
        kind: 'attempt',
        qid: q.id || '',
        point: String(q.point || '').trim() || '综合考核',
        correct: !!d.ok,
        earned: Number(d.earned) || 0,
        full: Number(q.score) || 0,
        at: at,
        hinted: !!d.hinted
      };
    });
  }

  /** 写一条事件到记录（只追加，不改旧数据） */
  function appendEvents(rec, events) {
    if (!rec) return;
    if (!rec.events) rec.events = [];
    (events || []).forEach(function (e) { rec.events.push(e); });
  }

  /** 该复习什么：到期的 + 最弱的，合成一条学习建议 */
  function nextAction(rec, now) {
    var m = masteryOf(rec, now);
    if (!m.list.length) {
      return { type: 'learn', title: '先看材料', desc: '还没做过题，先把材料过一遍' };
    }
    var due = m.due[0];
    if (due) {
      return {
        type: 'review',
        point: due.point,
        title: '复习「' + due.point + '」',
        desc: '这个知识点该复习了，再忘就白学了'
      };
    }
    var weak = m.weak[0];
    if (weak) {
      return {
        type: 'review',
        point: weak.point,
        title: '补一下「' + weak.point + '」',
        desc: '这块掌握得最弱，建议回材料里再看一遍'
      };
    }
    if (m.scored && m.list.every(function (s) { return s.level === 'strong'; })) {
      return { type: 'done', title: '都掌握了', desc: '每个知识点都到熟练了，可以放心' };
    }
    return { type: 'exam', title: '再考一次', desc: '多答几题，掌握度才算得准' };
  }

  /** 距离下次复习还有几天（负数表示已过期） */
  function daysToDue(st, now) {
    if (!st || !st.due) return null;
    return (st.due - (now || Date.now())) / DAY;
  }

  global.Learning = {
    BKT: BKT,
    FSRS: FSRS,
    MASTERED: MASTERED,
    MIN_EVIDENCE: MIN_EVIDENCE,
    GRADUATE_STREAK: GRADUATE_STREAK,
    VERSION: ALGO_VERSION,
    LEVELS: LEVELS,

    bktUpdate: bktUpdate,
    ratingOf: ratingOf,
    nextStability: nextStability,
    nextDifficulty: nextDifficulty,
    retention: retention,
    dueAt: dueAt,
    levelOf: levelOf,
    levelInfo: levelInfo,

    newState: newState,
    advance: advance,
    replay: replay,
    masteryOf: masteryOf,
    eventsFromAttempt: eventsFromAttempt,
    appendEvents: appendEvents,
    nextAction: nextAction,
    daysToDue: daysToDue
  };
})(window);
