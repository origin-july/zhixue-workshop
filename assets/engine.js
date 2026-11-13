/* =========================================================
   engine.js — 文本解析 / 离线出题 / 大模型出题
   ========================================================= */
(function (global) {
  'use strict';

  var C = global.Core;

  /* =========================================================
     1. 文本解析
     ========================================================= */

  var STOP_WORDS = {};
  ('的 了 是 在 和 与 及 或 有 为 对 从 到 以 被 把 让 给 就 都 也 还 又 而 但 却 ' +
   '这 那 其 该 此 些 个 种 项 条 款 中 上 下 内 外 前 后 时 后 者 之 所 于 由 向 至 ' +
   '可以 需要 应当 应该 必须 不得 不能 能够 可能 已经 进行 通过 根据 按照 依据 对于 关于 ' +
   '如果 因此 所以 但是 然而 并且 以及 或者 同时 另外 此外 其中 包括 例如 比如 以上 以下 ' +
   '我们 你们 他们 自己 公司 企业 部门 单位 员工 人员 相关 有关 情况 方面 问题 内容 要求 ' +
   '一个 一种 一定 一般 主要 重要 基本 具体 相应 有效 充分 及时 认真 严格 加强 提高 ' +
   '第一 第二 第三 第四 第五 一是 二是 三是 四是 五是 规定 执行 实施 管理 工作 事项 ' +
   '如下 下列 上述 如下所 详见 参见 按照 依照 结合 针对 围绕 着眼 立足 通过 采取 使用 ' +
   '本 该 各 每 任何 所有 全部 部分 其他 其余 之一 之间 之后 之前 以上 以内 以外').split(/\s+/)
    .forEach(function (w) { if (w) STOP_WORDS[w] = 1; });

  function isStop(w) { return !!STOP_WORDS[w]; }

  /** 把长文切成结构化的 section */
  function parseDocument(text) {
    var t = C.normalizeText(text);
    var lines = t.split('\n');
    var sections = [];
    var cur = { title: '正文', sentences: [] };

    var HEAD_PATTERNS = [
      /^#{1,6}\s*(.+)$/,
      /^第[一二三四五六七八九十百零\d]+[章节条款部分]\s*[、.．:：]?\s*(.*)$/,
      /^[一二三四五六七八九十]+\s*[、.．]\s*(.+)$/,
      /^[（(]\s*[一二三四五六七八九十\d]+\s*[)）]\s*[、.．]?\s*(.+)$/,
      /^\d+\s*[、.．]\s*(.+)$/
    ];

    function pushSection() {
      if (cur.sentences.length) sections.push(cur);
      cur = { title: cur.title, sentences: [] };
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var isHead = false, headText = '';
      if (line.length <= 42) {
        for (var p = 0; p < HEAD_PATTERNS.length; p++) {
          var m = line.match(HEAD_PATTERNS[p]);
          if (m) { isHead = true; headText = (m[1] || '').trim(); break; }
        }
      }
      if (isHead) {
        pushSection();
        cur.title = headText || line;
        continue;
      }

      var sents = splitSentences(line);
      for (var s = 0; s < sents.length; s++) {
        var sn = sents[s].trim();
        if (sn.length >= 8) cur.sentences.push(sn);
      }
    }
    pushSection();

    if (!sections.length) {
      sections = [{ title: '正文', sentences: splitSentences(t).filter(function (s) { return s.length >= 8; }) }];
    }
    return sections;
  }

  function splitSentences(text) {
    return String(text)
      .replace(/([。！？；!?;])/g, '$1\u0001')
      .split('\u0001')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /** 中文 n-gram 关键词提取 */
  function extractTerms(text, limit) {
    limit = limit || 40;
    var freq = {};
    var clean = String(text).replace(/[a-zA-Z0-9]+/g, function (m) { return '\u0002' + m + '\u0002'; });

    // 统计 2~5 字中文片段
    var zhRuns = clean.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    zhRuns.forEach(function (run) {
      for (var n = 2; n <= 5; n++) {
        for (var i = 0; i + n <= run.length; i++) {
          var g = run.substr(i, n);
          if (isStop(g)) continue;
          if (n === 2 && isStop(g[0]) && isStop(g[1])) continue;
          freq[g] = (freq[g] || 0) + 1;
        }
      }
    });

    // 英文词
    var enRuns = String(text).match(/[A-Za-z][A-Za-z0-9+#.\-]{1,}/g) || [];
    enRuns.forEach(function (w) {
      if (w.length < 2) return;
      freq[w] = (freq[w] || 0) + 1;
    });

    var arr = Object.keys(freq).map(function (w) {
      return { w: w, f: freq[w], len: w.length };
    }).filter(function (o) {
      // 长词至少出现 1 次，短词至少 2 次
      if (o.len >= 4) return o.f >= 1;
      if (o.len === 3) return o.f >= 2;
      return o.f >= 3;
    });

    // 去掉被更长高频词包含的短词
    arr.sort(function (a, b) { return b.len - a.len || b.f - a.f; });
    var kept = [];
    arr.forEach(function (o) {
      for (var i = 0; i < kept.length; i++) {
        if (kept[i].w.indexOf(o.w) >= 0 && kept[i].len > o.len) return;
      }
      kept.push(o);
    });

    kept.sort(function (a, b) {
      return (b.f * Math.min(b.len, 4)) - (a.f * Math.min(a.len, 4));
    });
    return kept.slice(0, limit).map(function (o) { return o.w; });
  }

  /** 数字 / 时限 / 专有名词等硬信息（按长度降序，优先挖最长的） */
  function findNuggets(sentence) {
    var out = [];
    var re = /(\d+(?:\.\d+)?\s*(?:个工作日|工作日|%|％|天|日|小时|分钟|个月|年|周|次(?!性)|人|元|万元|分|倍|个|项|条))|([一二三四五六七八九十百千]+\s*(?:个工作日|工作日|天|日|小时|分钟|个月|年|周|次(?!性)|人|元|万元|分|倍))/g;
    var m;
    while ((m = re.exec(sentence)) !== null) {
      out.push({ text: m[0].trim(), index: m.index, len: m[0].trim().length });
    }
    out.sort(function (a, b) { return b.len - a.len; });
    return out;
  }

  /** 从数字串造一个干扰值 */
  function fakeNumber(numStr) {
    return numStr.replace(/\d+(?:\.\d+)?/, function (n) {
      var v = parseFloat(n);
      if (isNaN(v)) return n;
      var nv;
      if (v <= 5) {
        nv = Math.random() < 0.5 ? v + (1 + Math.floor(Math.random() * 2)) : Math.max(1, v - 1);
      } else if (v <= 12) {
        nv = Math.random() < 0.5 ? v + (1 + Math.floor(Math.random() * 3)) : Math.max(1, v - (1 + Math.floor(Math.random() * 3)));
      } else {
        // 大数字用常见倍数，避免出现 93 分钟这种怪值
        var mult = [0.5, 1.5, 2][Math.floor(Math.random() * 3)];
        nv = v * mult;
      }
      if (nv === v) nv = v + 1;
      var s = Number.isInteger(v) ? String(Math.round(nv)) : nv.toFixed(1);
      return s;
    });
  }

  /** 压缩成一句话选项（不超过 maxLen） */
  function condense(sentence, maxLen) {
    maxLen = maxLen || 34;
    var s = String(sentence).replace(/^[（(]?[一二三四五六七八九十\d]+[)）、.．]\s*/, '');
    s = s.replace(/[。；;]$/, '');
    if (s.length <= maxLen) return s;
    var parts = s.split(/[，,、]/);
    var out = '';
    var used = 0;
    for (var i = 0; i < parts.length; i++) {
      if ((out + parts[i]).length > maxLen) break;
      out += (out ? '，' : '') + parts[i];
      used++;
    }
    if (!out) return s.slice(0, maxLen) + '…';
    return used < parts.length ? out + '…' : out;
  }

  /** 造一个错误陈述：优先改数字，其次换否定词。改不动就返回 null */
  function falsify(sentence) {
    var nug = findNuggets(sentence);
    if (nug.length) {
      var pick = nug[0];
      var fake = fakeNumber(pick.text);
      if (fake !== pick.text) {
        return sentence.slice(0, pick.index) + fake + sentence.slice(pick.index + pick.len);
      }
    }
    // 长的优先匹配，避免「不得」被「不」抢先处理成病句
    var negations = [
      ['可以享受', '不享受'],
      ['应当予以', '不予'],
      ['无需办理', '必须办理'],
      ['不少于', '少于'],
      ['不超过', '超过'],
      ['不得超过', '可以达到'],
      ['不得', '可以'],
      ['必须', '不必'],
      ['应当', '无需'],
      ['需要', '不需要'],
      ['允许', '禁止'],
      ['包含', '不包含'],
      ['一致', '不一致'],
      ['视为', '不视为'],
      ['可以', '不得'],
      ['需', '无需'],
      ['应', '不应'],
      ['可', '不可'],
      ['是', '不是'],
      ['有', '没有']
    ];
    var shuffled = C.shuffle(negations);
    for (var i = 0; i < shuffled.length; i++) {
      var pair = shuffled[i];
      if (sentence.indexOf(pair[0]) >= 0) {
        var out = sentence.replace(pair[0], pair[1]);
        // 简单语法校验：不出现连续的否定叠加或空片段
        if (/不[不无]|无无|没没有/.test(out)) continue;
        if (out.length < sentence.length * 0.7) continue;
        return out;
      }
    }
    return null;
  }

  /* =========================================================
     2. 离线出题
     ========================================================= */

  function buildContext(text) {
    var sections = parseDocument(text);
    var allSentences = [];
    sections.forEach(function (sec) {
      sec.sentences.forEach(function (s) {
        allSentences.push({ text: s, section: sec.title });
      });
    });
    var terms = extractTerms(text, 60);

    // 句子打分：含数字 / 含高频词
    var scored = allSentences.map(function (item) {
      var score = 0;
      if (findNuggets(item.text).length) score += 3;
      terms.forEach(function (t, i) {
        if (item.text.indexOf(t) >= 0) score += Math.max(1, 6 - Math.floor(i / 6));
      });
      if (item.text.length > 12 && item.text.length < 80) score += 2;
      if (/应当|必须|不得|禁止|负责|要求|标准|流程|规定/.test(item.text)) score += 2;
      return { text: item.text, section: item.section, score: score };
    });

    scored.sort(function (a, b) { return b.score - a.score; });

    return { sections: sections, sentences: allSentences, scored: scored, terms: terms };
  }

  function pickN(arr, n, used) {
    var out = [];
    for (var i = 0; i < arr.length && out.length < n; i++) {
      if (used && used[arr[i].text || arr[i]]) continue;
      out.push(arr[i]);
      if (used) used[arr[i].text || arr[i]] = 1;
    }
    return out;
  }

  function mkSingle(ctx, used, style) {
    var pool = ctx.scored.filter(function (s) { return !used[s.text] && s.text.length >= 12; });
    if (!pool.length) pool = ctx.scored;
    var base = pool[Math.floor(Math.random() * Math.min(5, pool.length))];
    if (!base) return null;
    used[base.text] = 1;

    var q = C.makeQuestion('single');
    q.from = base.text;
    var nug = findNuggets(base.text);

    var correct, stem;
    var preferBlank = style === 'memory' ? 0.75 : (style === 'practice' ? 0.2 : 0.45);
    var useBlank = nug.length > 0 && Math.random() < preferBlank;

    if (useBlank) {
      var ng = nug[0];
      var blanked = base.text.slice(0, ng.index) + '____' + base.text.slice(ng.index + ng.len);
      var condensed = condense(blanked, 62).replace(/[。；]$/, '');
      // 截断后如果横线掉了，就不能用这条，否则题干和答案对不上
      if (condensed.indexOf('____') < 0) useBlank = false;
      else {
        stem = '根据培训资料补全表述：' + condensed + '。横线处应填（　）。';
        correct = ng.text;
      }
    }

    if (!useBlank) {
      correct = condense(base.text, 38);
      // 无章节标题时（如纯粘贴文本）用不依赖章节名的措辞，避免出现「关于「正文」」
      var hasTitle = base.section && base.section !== '正文';
      var stems;
      if (style === 'practice') {
        stems = hasTitle
          ? ['在实际工作中涉及「' + base.section + '」时，以下做法符合要求的是？',
             '按照「' + base.section + '」的要求，下列操作正确的是？']
          : ['在实际工作中遇到相关情形时，以下做法符合要求的是？',
             '按照培训要求，下列操作正确的是？'];
      } else {
        stems = hasTitle
          ? ['关于「' + base.section + '」，下列说法正确的是？',
             '根据「' + base.section + '」相关要求，下列表述正确的是？',
             '以下关于「' + base.section + '」的说法，符合培训资料的是？']
          : ['根据培训资料，下列说法正确的是？',
             '以下说法中，符合培训资料的是？',
             '关于培训内容，下列表述正确的是？'];
      }
      stem = stems[Math.floor(Math.random() * stems.length)];
    }

    var wrongs = [];
    var usedWrong = {};
    usedWrong[correct] = 1;

    // 干扰项优先取同一章节的句子，语义更贴近
    var sameSec = ctx.scored.filter(function (s) { return s.section === base.section && s.text !== base.text; });
    var otherSec = ctx.scored.filter(function (s) { return s.section !== base.section && s.text !== base.text; });
    var others = C.shuffle(sameSec).slice(0, 6).concat(C.shuffle(otherSec).slice(0, 6));
    for (var i = 0; i < others.length && wrongs.length < 3; i++) {
      var falsified = falsify(others[i].text);
      if (!falsified) continue;
      var rawCondensed = condense(others[i].text, 34);
      var f = condense(falsified, 34);
      // 没被改动的原句不能当错误项，否则一道题会出现多个正确答案
      if (f === rawCondensed) continue;
      if (f !== correct && !usedWrong[f] && f.length > 4) { wrongs.push(f); usedWrong[f] = 1; }
    }
    // 干扰项 3：原句数字篡改
    if (wrongs.length < 3 && nug.length) {
      var faked = falsify(correct);
      if (faked) {
        var f2 = condense(faked, 30);
        if (f2 !== correct && !usedWrong[f2]) { wrongs.push(f2); usedWrong[f2] = 1; }
      }
    }
    // 干扰项 4：从其他关键词凑
    var idx = 0;
    while (wrongs.length < 3 && idx < ctx.terms.length) {
      var cand = condense(ctx.terms[idx] + '的相关要求由上级另行确定', 30);
      idx++;
      if (!usedWrong[cand]) { wrongs.push(cand); usedWrong[cand] = 1; }
    }
    if (wrongs.length < 3) return null;

    var opts = C.shuffle([correct].concat(wrongs.slice(0, 3)));
    q.stem = stem;
    q.options = opts.map(function (text, i) { return { key: 'ABCD'[i], text: text }; });
    q.answer = 'ABCD'[opts.indexOf(correct)];
    q.analysis = '原文：' + base.text;
    q.point = base.section && base.section !== '正文' ? base.section : '';
    return q;
  }

  function mkJudge(ctx, used) {
    var pool = ctx.scored.filter(function (s) { return !used[s.text] && s.text.length >= 12; });
    if (!pool.length) pool = ctx.scored;
    var base = pool[Math.floor(Math.random() * Math.min(5, pool.length))];
    if (!base) return null;
    used[base.text] = 1;

    var q = C.makeQuestion('judge');
    q.from = base.text;
    var makeTrue = Math.random() < 0.5;
    var faked = makeTrue ? null : falsify(base.text);
    if (!makeTrue && !faked) makeTrue = true;

    if (makeTrue) {
      q.stem = condense(base.text, 70) + '。';
      q.answer = '正确';
      q.analysis = '与培训资料一致。';
    } else {
      q.stem = condense(faked, 70) + '。';
      q.answer = '错误';
      q.analysis = '原文为：' + base.text;
    }
    q.point = base.section && base.section !== '正文' ? base.section : '';
    return q;
  }

  function mkBlank(ctx, used) {
    var pool = ctx.scored.filter(function (s) { return !used[s.text] && findNuggets(s.text).length; });
    if (!pool.length) pool = ctx.scored.filter(function (s) { return !used[s.text] && s.text.length > 16; });
    if (!pool.length) return null;
    var base = pool[Math.floor(Math.random() * Math.min(5, pool.length))];
    used[base.text] = 1;

    var q = C.makeQuestion('blank');
    q.from = base.text;
    var nug = findNuggets(base.text);
    var target;
    if (nug.length) {
      target = nug[0];
    } else {
      var term = ctx.terms.find(function (t) { return base.text.indexOf(t) >= 0; });
      if (!term) return null;
      var pos = base.text.indexOf(term);
      target = { text: term, index: pos, len: term.length };
    }
    q.stem = (base.text.slice(0, target.index) + '____' + base.text.slice(target.index + target.len))
      .replace(/[。；]$/, '') + '。';
    q.answer = target.text;
    q.analysis = '原文：' + base.text;
    q.point = base.section && base.section !== '正文' ? base.section : '';
    return q;
  }

  function mkMulti(ctx, used) {
    // 找同一 section 里 3 句以上
    var secCands = ctx.sections.filter(function (s) { return s.sentences.length >= 3; });
    var sec = secCands.length ? secCands[Math.floor(Math.random() * secCands.length)] : null;
    var trues = [], falses = [];

    if (sec) {
      var cands = C.shuffle(sec.sentences.filter(function (s) { return s.length >= 10; })).slice(0, 4);
      for (var j = 0; j < cands.length && trues.length < 2; j++) {
        if (used[cands[j]]) continue;
        used[cands[j]] = 1;
        trues.push(condense(cands[j], 30));
      }
    }
    if (trues.length < 2) {
      var extra = ctx.scored.filter(function (s) { return !used[s.text]; }).slice(0, 10);
      extra.forEach(function (s) {
        if (trues.length < 2) { used[s.text] = 1; trues.push(condense(s.text, 30)); }
      });
    }
    if (trues.length < 2) return null;

    // 干扰项候选不要求未被使用，改写后不会与原句混淆即可
    var wrongPool = C.shuffle(ctx.scored.filter(function (s) {
      return s.text.length > 10 && trues.indexOf(condense(s.text, 34)) < 0;
    })).slice(0, 24);
    for (var k = 0; k < wrongPool.length && falses.length < 2; k++) {
      var falsified = falsify(wrongPool[k].text);
      if (!falsified) continue;
      var f = condense(falsified, 34);
      if (f === condense(wrongPool[k].text, 34)) continue;
      if (trues.indexOf(f) < 0 && falses.indexOf(f) < 0) falses.push(f);
    }
    // 仍不够就重复利用同一批句子，每句多试几种改法
    if (falses.length < 2) {
      var retry = C.shuffle(ctx.scored);
      for (var r = 0; r < retry.length && falses.length < 2; r++) {
        for (var att = 0; att < 3 && falses.length < 2; att++) {
          var fz = falsify(retry[r].text);
          if (!fz) continue;
          var cf = condense(fz, 34);
          if (cf.length < 6) continue;
          if (trues.indexOf(cf) < 0 && falses.indexOf(cf) >= 0) continue;
          if (falses.indexOf(cf) < 0) falses.push(cf);
        }
      }
    }
    // 选项不足 4 个就不出这道题，宁缺毋滥
    if (trues.length + falses.length < 4) return null;

    var q = C.makeQuestion('multi');
    var all = C.shuffle(trues.concat(falses));
    var secTitle = sec && sec.title && sec.title !== '正文' ? sec.title : '';
    q.stem = secTitle ? ('关于「' + secTitle + '」，下列说法正确的有？') : '根据培训资料，下列说法正确的有？';
    q.options = all.map(function (text, i) { return { key: 'ABCD'[i], text: text }; });
    q.answer = all.map(function (text, i) { return trues.indexOf(text) >= 0 ? 'ABCD'[i] : null; }).filter(Boolean);
    q.analysis = '正确项' + q.answer.join('、') + ' 直接来自资料，其余选项与资料表述不符。';
    q.point = secTitle;
    return q;
  }

  function mkEssay(ctx, used) {
    var cands = ctx.sections.filter(function (s) { return s.sentences.length >= 2; });
    var sec = cands.length ? cands[Math.floor(Math.random() * cands.length)] : null;
    var q = C.makeQuestion('essay');
    var secName = sec && sec.title && sec.title !== '正文' ? sec.title : '';
    if (sec) {
      q.stem = secName
        ? ('请结合培训资料，简述「' + secName + '」的核心要点。')
        : '请结合培训资料，简述本次培训的核心要点。';
      q.answer = sec.sentences.slice(0, 3).map(function (s, i) { return (i + 1) + '. ' + condense(s, 60); }).join('\n');
      q.point = secName;
      q.analysis = '答出以下要点即可得分，表述顺序不限。';
    } else {
      var top = ctx.scored[0];
      if (!top) return null;
      q.stem = '请简述培训资料中关于「' + (ctx.terms[0] || '核心内容') + '」的主要说明。';
      q.answer = condense(top.text, 80);
      q.point = top.section;
      q.analysis = '参考原文要点。';
    }
    return q;
  }

  var MAKERS = { single: mkSingle, multi: mkMulti, judge: mkJudge, blank: mkBlank, essay: mkEssay };

  /** 离线生成全部题目 */
  function generateOffline(text, counts, diffRatio, style, onProgress) {
    return new Promise(function (resolve) {
      var ctx = buildContext(text);
      if (!ctx.scored.length) { resolve([]); return; }

      var plan = [];
      C.TYPES.forEach(function (t) {
        var n = counts[t.key] || 0;
        for (var i = 0; i < n; i++) plan.push(t.key);
      });
      // 打散，避免连续同题型
      plan = C.shuffle(plan);

      var used = {};
      var out = [];
      var i = 0;

      function step() {
        if (i >= plan.length) {
          // 按题型归组，符合试卷排版习惯
          var ORDER = ['single', 'multi', 'judge', 'blank', 'essay'];
          out.sort(function (a, b) { return ORDER.indexOf(a.type) - ORDER.indexOf(b.type); });
          assignDifficulty(out, diffRatio);
          resolve(out);
          return;
        }
        var type = plan[i];
        var q = null;
        try {
          var mk = MAKERS[type];
          q = mk(ctx, used, pickStyle(style, i));
        } catch (e) { q = null; }

        var t = C.TYPE_MAP[type];
        var optN = q ? q.options.filter(function (o) { return o.text && o.text.trim(); }).length : 0;
        var okOpts = t.hasOptions ? optN >= 4 : true;
        if (q && q.stem && okOpts) {
          // 题干去重：同一句话不重复出题
          var dup = out.some(function (x) { return x.stem === q.stem; });
          if (!dup) {
            q.id = C.uid();
            q.score = C.TYPE_MAP[type].score;
            out.push(q);
          }
        }
        i++;
        if (onProgress) onProgress(i / plan.length, '已生成 ' + out.length + ' 道题');
        setTimeout(step, 55);
      }
      step();
    });
  }

  function pickStyle(style, i) {
    if (style !== 'mixed') return style;
    var arr = ['concept', 'practice', 'memory'];
    return arr[i % 3];
  }

  function assignDifficulty(questions, ratio) {
    var total = questions.length;
    if (!total) return;
    var nEasy = Math.round(total * (ratio.easy / 100));
    var nHard = Math.round(total * (ratio.hard / 100));
    var nMed = Math.max(0, total - nEasy - nHard);
    var list = [];
    for (var i = 0; i < nEasy; i++) list.push('easy');
    for (var j = 0; j < nMed; j++) list.push('medium');
    for (var k = 0; k < nHard; k++) list.push('hard');
    while (list.length < total) list.push('medium');
    list = C.shuffle(list);
    questions.forEach(function (q, idx) { q.difficulty = list[idx] || 'medium'; });
  }

  /* =========================================================
     3. 大模型出题
     ========================================================= */

  function buildPrompt(text, plan, style, diff) {
    var styleText = (C.STYLES[style] || C.STYLES.mixed).name;
    var counts = {};
    plan.forEach(function (p) { counts[p] = (counts[p] || 0) + 1; });
    var typeLines = Object.keys(counts).map(function (k) {
      return '- ' + C.TYPE_MAP[k].name + ' ' + counts[k] + ' 道';
    }).join('\n');

    var clipped = text.length > 12000 ? text.slice(0, 12000) + '\n（后文略）' : text;

    return [
      '你是企业培训的资深出题专家。请基于下面的培训资料出题。',
      '',
      '【硬性要求】',
      '1. 只考查资料中明确出现的内容，禁止编造资料外的知识或数据。',
      '2. 题干要用完整的问句或陈述句，不要出现"根据上文""如图所示"这类脱离语境的表述。',
      '3. 单选题 4 个选项，有且只有 1 个正确；多选题 4 个选项，2~3 个正确；',
      '   判断题只输出题干和答案；填空题在题干中用 4 个下划线 ____ 表示空格；简答题给出参考答案要点。',
      '4. 干扰项要看起来合理，不能明显荒谬。',
      '5. 难度分布：简单约 ' + diff.easy + '%，中等约 ' + diff.medium + '%，困难约 ' + diff.hard + '%。',
      '6. 出题风格：' + styleText + '。',
      '',
      '【题型与数量】',
      typeLines,
      '',
      '【输出格式】',
      '只输出一个 JSON 数组，不要任何解释文字，不要 markdown 代码块标记。每个元素：',
      '{',
      '  "type": "single" | "multi" | "judge" | "blank" | "essay",',
      '  "stem": "题干文本",',
      '  "options": [{"key":"A","text":"选项内容"}, ...],   // judge/blank/essay 传 []',
      '  "answer": "A" 或 ["A","C"] 或 "正确"/"错误" 或 "填空答案" 或 "简答参考答案",',
      '  "analysis": "解析，说明依据资料中的哪句话",',
      '  "difficulty": "easy" | "medium" | "hard",',
      '  "score": 数字,',
      '  "point": "所属知识点，尽量用资料里的标题"',
      '}',
      '',
      '【培训资料】',
      clipped
    ].join('\n');
  }

  function extractJson(raw) {
    var s = String(raw || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    var start = s.indexOf('[');
    var end = s.lastIndexOf(']');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    try { return JSON.parse(s); } catch (e) { }
    // 容错：去掉尾随逗号
    try { return JSON.parse(s.replace(/,\s*([\]}])/g, '$1')); } catch (e) { }
    return null;
  }

  function normalizeOne(item, idx) {
    if (!item || typeof item !== 'object') return null;
    var type = String(item.type || 'single').toLowerCase();
    var alias = {
      single: 'single', singlechoice: 'single', radio: 'single', 单选: 'single', '单选题': 'single',
      multi: 'multi', multiple: 'multi', checkbox: 'multi', 多选: 'multi', '多选题': 'multi',
      judge: 'judge', truefalse: 'judge', boolean: 'judge', 判断: 'judge', '判断题': 'judge',
      blank: 'blank', fill: 'blank', 填空: 'blank', '填空题': 'blank',
      essay: 'essay', short: 'essay', text: 'essay', 简答: 'essay', '简答题': 'essay', '问答题': 'essay'
    };
    type = alias[type] || alias[String(item.type || '')] || 'single';
    var q = C.makeQuestion(type);

    q.stem = String(item.stem || item.question || item.title || '').trim();
    if (!q.stem) return null;

    var opts = item.options || item.opts || [];
    if (typeof opts === 'object' && !Array.isArray(opts)) {
      opts = Object.keys(opts).map(function (k) { return { key: k, text: opts[k] }; });
    }
    if (Array.isArray(opts) && opts.length) {
      q.options = opts.map(function (o, i) {
        if (typeof o === 'string') return { key: 'ABCDEF'[i], text: o.replace(/^[A-Fa-f][.、．)]\s*/, '') };
        return { key: String(o.key || 'ABCDEF'[i]).toUpperCase(), text: String(o.text || o.content || '').trim() };
      }).filter(function (o) { return o.text; });
    }

    var ans = item.answer != null ? item.answer : (item.correctAnswer != null ? item.correctAnswer : item.correct);
    if (Array.isArray(ans)) q.answer = ans.map(function (a) { return String(a).trim().toUpperCase().replace(/[^A-F]/g, ''); }).filter(Boolean);
    else if (ans != null) q.answer = String(ans).trim();

    if (type === 'judge') {
      var a = String(q.answer);
      if (/^(T|true|正确|对|是|Y|yes)$/i.test(a)) q.answer = '正确';
      else q.answer = '错误';
    }
    if (type === 'multi' && typeof q.answer === 'string') {
      q.answer = q.answer.toUpperCase().replace(/[^A-F]/g, '').split('');
    }
    if (type === 'single' && typeof q.answer !== 'string') {
      q.answer = String(q.answer[0] || 'A');
    }
    if (type === 'single') {
      var m1 = String(q.answer).toUpperCase().match(/[A-F]/);
      q.answer = m1 ? m1[0] : 'A';
    }

    q.analysis = String(item.analysis || item.explanation || item.explain || '').trim();
    var d = String(item.difficulty || item.level || '').toLowerCase();
    if (/easy|简单|低/.test(d)) q.difficulty = 'easy';
    else if (/hard|困难|难|高/.test(d)) q.difficulty = 'hard';
    else q.difficulty = 'medium';
    q.score = Number(item.score) > 0 ? Number(item.score) : C.TYPE_MAP[type].score;
    q.point = String(item.point || item.knowledgePoint || item.knowledge || '').trim();

    if (C.TYPE_MAP[type].hasOptions && q.options.length < 2) return null;
    return q;
  }

  function callLLM(messages, cfg) {
    var base = String(cfg.base || '').trim().replace(/\/+$/, '');
    if (!/\/v\d+$/.test(base) && !/\/chat\/completions$/.test(base)) base += '/v1';
    var url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: messages,
        temperature: 0.6,
        max_tokens: 4096
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('HTTP ' + res.status + ' ' + t.slice(0, 200));
        });
      }
      return res.json();
    }).then(function (data) {
      var content = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : '';
      if (!content) throw new Error('返回内容为空');
      return content;
    });
  }

  /** LLM 分批生成 */
  function generateByLLM(text, counts, diffRatio, style, cfg, onProgress) {
    var plan = [];
    C.TYPES.forEach(function (t) {
      for (var i = 0; i < (counts[t.key] || 0); i++) plan.push(t.key);
    });
    if (!plan.length) return Promise.resolve([]);

    var BATCH = 6;
    var batches = [];
    for (var i = 0; i < plan.length; i += BATCH) batches.push(plan.slice(i, i + BATCH));

    var results = [];
    var done = 0;

    function runBatch(bi) {
      if (bi >= batches.length) return Promise.resolve(results);
      if (onProgress) onProgress(done / plan.length, 'AI 正在出第 ' + (done + 1) + '~' + Math.min(done + BATCH, plan.length) + ' 题');

      var prompt = buildPrompt(text, batches[bi], style, diffRatio);
      return callLLM([
        { role: 'system', content: '你只输出 JSON 数组，不输出任何其他文字。' },
        { role: 'user', content: prompt }
      ], cfg).then(function (raw) {
        var arr = extractJson(raw);
        if (!Array.isArray(arr)) throw new Error('模型返回的不是 JSON 数组');
        arr.forEach(function (item, idx) {
          var q = normalizeOne(item, idx);
          if (q) results.push(q);
        });
        done += batches[bi].length;
        if (onProgress) onProgress(Math.min(1, done / plan.length), '已完成 ' + results.length + ' 题');
        return runBatch(bi + 1);
      });
    }
    return runBatch(0);
  }

  /** 单题重生成 */
  function regenerateOne(question, text, cfg, style) {
    if (cfg && cfg.on && cfg.key) {
      var prompt = buildPrompt(text, [question.type], style, { easy: 33, medium: 34, hard: 33 });
      prompt += '\n\n【额外要求】换一个角度出题，不要和原来这题重复。原来的题目是：' + question.stem;
      return callLLM([
        { role: 'system', content: '你只输出 JSON 数组，不输出任何其他文字。' },
        { role: 'user', content: prompt }
      ], cfg).then(function (raw) {
        var arr = extractJson(raw);
        if (!Array.isArray(arr) || !arr.length) throw new Error('生成失败');
        return normalizeOne(arr[0], 0);
      });
    }

    return new Promise(function (resolve) {
      var ctx = buildContext(text);
      var used = {};
      var q = MAKERS[question.type](ctx, used, pickStyle(style, Math.floor(Math.random() * 3)));
      resolve(q);
    });
  }

  global.Engine = {
    parseDocument: parseDocument,
    splitSentences: splitSentences,
    extractTerms: extractTerms,
    buildContext: buildContext,
    generateOffline: generateOffline,
    generateByLLM: generateByLLM,
    regenerateOne: regenerateOne,
    normalizeOne: normalizeOne,
    callLLM: callLLM
  };
})(window);
