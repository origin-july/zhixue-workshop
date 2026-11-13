/* =========================================================
   exporter.js — 云学堂模板 / JSON / Markdown 导出
   ========================================================= */
(function (global) {
  'use strict';

  var C = global.Core;

  /** 题库名：优先显式设置，否则用课程 / 章节标题兜底 */
  function bankName(state) {
    return state.bank || state.courseTitle || state.examTitle || '未命名题库';
  }

  function judgeText(ans, fmt) {
    var isTrue = (ans === '正确' || ans === '对' || ans === 'A' || ans === true || ans === 'TRUE' || ans === 'true');
    switch (fmt) {
      case 'text-b': return isTrue ? '对' : '错';
      case 'letter': return isTrue ? 'A' : 'B';
      case 'bool':   return isTrue ? 'TRUE' : 'FALSE';
      default:       return isTrue ? '正确' : '错误';
    }
  }

  function diffText(d) {
    var m = C.DIFF_MAP[d];
    return m ? m.name : '中等';
  }

  function answerText(q, cfg) {
    if (q.type === 'judge') return judgeText(q.answer, cfg.judgeFmt);
    if (q.type === 'multi') {
      var arr = Array.isArray(q.answer) ? q.answer.slice().sort() : String(q.answer || '').split('');
      return arr.join(cfg.multiSep == null ? ',' : cfg.multiSep);
    }
    if (q.type === 'blank' || q.type === 'essay') {
      return String(q.answer || '').replace(/\n/g, ' / ');
    }
    return String(q.answer || '');
  }

  function cellValue(q, field, cfg, state) {
    if (field.indexOf('option:') === 0) {
      var key = field.split(':')[1];
      if (q.type === 'judge') {
        // 判断题若按字母格式，给固定选项
        if (cfg.judgeFmt === 'letter') return key === 'A' ? '正确' : (key === 'B' ? '错误' : '');
        return key === 'A' ? '正确' : (key === 'B' ? '错误' : '');
      }
      var opt = (q.options || []).find(function (o) { return o.key === key; });
      return opt ? opt.text : '';
    }
    switch (field) {
      case 'type': return (C.TYPE_MAP[q.type] || {}).name || '单选题';
      case 'stem': return q.stem || '';
      case 'answer': return answerText(q, cfg);
      case 'analysis': return q.analysis || '';
      case 'difficulty': return diffText(q.difficulty);
      case 'score': return q.score;
      case 'point': return q.point || state.point || '';
      case 'bank': return state.bank || bankName(state);
      default: return '';
    }
  }

  /* ---------- xlsx ---------- */
  function exportXlsx(state) {
    var cfg = state.exportCfg;
    var cols = (cfg.columns || []).filter(function (c) { return c.on; });
    if (!cols.length) throw new Error('没有启用任何导出列');

    var aoa = [];

    if (cfg.noteRow) {
      var notes = [
        '填写说明：',
        '1. 题型可填写：单选题 / 多选题 / 判断题 / 填空题 / 简答题；',
        '2. 多选题正确答案用分隔符连接，如 A,B；',
        '3. 判断题正确答案填「' + (cfg.judgeFmt === 'letter' ? 'A（正确）/ B（错误）' :
          cfg.judgeFmt === 'bool' ? 'TRUE / FALSE' :
          cfg.judgeFmt === 'text-b' ? '对 / 错' : '正确 / 错误') + '」；',
        '4. 填空题题干中的空格统一用四个下划线 ____ 表示；',
        '5. 难度可填写：简单 / 中等 / 困难；',
        '6. 请勿修改本行及表头，直接在第 3 行起填写或覆盖内容。'
      ].join('');
      var noteRow = new Array(cols.length).fill('');
      noteRow[0] = notes;
      aoa.push(noteRow);
    }

    aoa.push(cols.map(function (c) { return c.label; }));

    // 按题型归组导出，和云学堂组卷顺序一致
    var ORDER = ['single', 'multi', 'judge', 'blank', 'essay'];
    var sorted = state.questions.slice().sort(function (a, b) {
      return ORDER.indexOf(a.type) - ORDER.indexOf(b.type);
    });

    sorted.forEach(function (q) {
      aoa.push(cols.map(function (c) { return cellValue(q, c.field, cfg, state); }));
    });

    var ws = XLSX.utils.aoa_to_sheet(aoa);

    // 列宽
    ws['!cols'] = cols.map(function (c) {
      if (c.field === 'stem') return { wch: 56 };
      if (c.field === 'analysis') return { wch: 44 };
      if (c.field.indexOf('option:') === 0) return { wch: 28 };
      if (c.field === 'type') return { wch: 10 };
      if (c.field === 'answer') return { wch: 14 };
      if (c.field === 'score') return { wch: 8 };
      if (c.field === 'difficulty') return { wch: 10 };
      if (c.field === 'point') return { wch: 18 };
      return { wch: 16 };
    });

    // 行高
    ws['!rows'] = aoa.map(function (_, i) {
      if (cfg.noteRow && i === 0) return { hpt: 46 };
      return { hpt: 30 };
    });

    // 合并说明行
    if (cfg.noteRow && cols.length > 1) {
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }];
    }

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '试题导入');

    var bank = bankName(state).replace(/[\\/:*?"<>|]/g, '_');
    var name = '云学堂试题导入_' + bank + '_' + C.nowStamp() + '.xlsx';
    XLSX.writeFile(wb, name);
    return name;
  }

  /* ---------- JSON ---------- */
  function exportJson(state) {
    var data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      bank: bankName(state),
      point: state.point || '',
      sourceName: state.fileName || state.courseTitle || '',
      counts: state.counts,
      diff: state.diff,
      style: state.style,
      questions: state.questions
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    var name = '题库备份_' + bankName(state) + '_' + C.nowStamp() + '.json';
    downloadBlob(blob, name);
    return name;
  }

  /* ---------- Markdown 试卷 ---------- */
  function exportMarkdown(state) {
    var lines = [];
    var title = state.examTitle || (bankName(state) + ' 测评试卷');
    lines.push('# ' + title);
    lines.push('');
    var total = state.questions.reduce(function (s, q) { return s + (Number(q.score) || 0); }, 0);
    lines.push('> 共 ' + state.questions.length + ' 题 · 总分 ' + total + ' 分');
    lines.push('');

    var typeOrder = ['single', 'multi', 'judge', 'blank', 'essay'];
    var cn = ['一', '二', '三', '四', '五'];
    var idx = 0;

    typeOrder.forEach(function (tk, ti) {
      var group = state.questions.filter(function (q) { return q.type === tk; });
      if (!group.length) return;
      var t = C.TYPE_MAP[tk];
      lines.push('## ' + cn[ti] + '、' + t.name + '（共 ' + group.length + ' 题）');
      lines.push('');
      group.forEach(function (q) {
        idx++;
        lines.push('**' + idx + '.** ' + q.stem + '　*(' + (Number(q.score) || 0) + ' 分)*');
        lines.push('');
        if (q.options && q.options.length) {
          q.options.forEach(function (o) { lines.push('- ' + o.key + '. ' + o.text); });
          lines.push('');
        }
        if (tk === 'blank') { lines.push(''); }
        if (tk === 'essay') { lines.push(''); lines.push(''); }
      });
    });

    lines.push('---');
    lines.push('');
    lines.push('## 参考答案');
    lines.push('');
    idx = 0;
    typeOrder.forEach(function (tk) {
      state.questions.filter(function (q) { return q.type === tk; }).forEach(function (q) {
        idx++;
        var a = answerText(q, { judgeFmt: 'text-a', multiSep: '、' });
        lines.push('**' + idx + '.** ' + a);
        if (q.analysis) lines.push('  > ' + q.analysis.replace(/\n/g, ' '));
        lines.push('');
      });
    });

    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var name = '试卷_' + bankName(state) + '_' + C.nowStamp() + '.md';
    downloadBlob(blob, name);
    return name;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  /** 生成导出预览表（前 5 行）用于界面展示 */
  function previewRows(state, limit) {
    limit = limit || 3;
    var cfg = state.exportCfg;
    var cols = (cfg.columns || []).filter(function (c) { return c.on; });
    return {
      headers: cols.map(function (c) { return c.label; }),
      rows: state.questions.slice(0, limit).map(function (q) {
        return cols.map(function (c) { return cellValue(q, c.field, cfg, state); });
      })
    };
  }

  global.Exporter = {
    exportXlsx: exportXlsx,
    exportJson: exportJson,
    exportMarkdown: exportMarkdown,
    previewRows: previewRows,
    answerText: answerText
  };
})(window);
