/* 出题质量校验：对默认培训材料逐份出题，检查结构问题 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  page.on('pageerror', e => console.log('ERR:', e.message));
  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(700);

  const report = await page.evaluate(async () => {
    const out = [];
    const T = window.TrainData;

    // 语料：每份示例材料的正文 + 一段补充文本
    const corpora = [];
    (T.defaultProjects ? T.defaultProjects() : []).forEach(p => {
      (p.materials || []).forEach(m => {
        if (m.preview) corpora.push({ name: m.name, text: m.preview });
      });
    });
    corpora.push({
      name: '补充语料',
      text: '新员工入职第一周须完成账号申请与安全培训。' +
        '入职材料包括身份证复印件、学历证明、离职证明三项，缺一不可。' +
        '试用期为 3 个月，试用期内需完成至少 2 次绩效面谈。' +
        '转正申请须在试用期结束前 15 天提交，由直属主管与 HRBP 共同审批。' +
        '年假按入职年限计算，满 1 年享受 5 天，满 3 年享受 10 天，满 5 年享受 15 天。' +
        '病假需提供二级以上医院证明，连续 3 天以上须报备部门负责人。'
    });

    for (const co of corpora) {
      const qs = await Engine.generateOffline(co.text, { single: 4, multi: 2, judge: 3, blank: 2, essay: 1 },
        { easy: 30, medium: 50, hard: 20 }, 'mixed', null);
      const bad = [];
      qs.forEach((q, i) => {
        if (!q.stem || q.stem.length < 6) bad.push(`#${i + 1}题干短`);
        if (q.type === 'single' || q.type === 'multi') {
          const filled = q.options.filter(o => o.text && o.text.trim());
          if (filled.length < 4) bad.push(`#${i + 1}选项${filled.length}`);
          const ans = Array.isArray(q.answer) ? q.answer : [q.answer];
          if (ans.some(a => !q.options.find(o => o.key === a))) bad.push(`#${i + 1}答案越界`);
          if (q.type === 'single' && ans.length !== 1) bad.push(`#${i + 1}单选${ans.length}答案`);
          if (q.type === 'multi' && ans.length < 2) bad.push(`#${i + 1}多选${ans.length}答案`);
          const texts = q.options.map(o => String(o.text).replace(/\s/g, ''));
          if (new Set(texts).size !== texts.length) bad.push(`#${i + 1}重复选项`);
          q.options.forEach(o => {
            if (ans.includes(o.key)) return;
            const t = String(o.text).replace(/\s/g, '');
            if (t.length > 12 && co.text.replace(/\s/g, '').includes(t)) bad.push(`#${i + 1}干扰项原句`);
          });
        }
        if (q.type === 'judge' && !/^(正确|错误)$/.test(q.answer)) bad.push(`#${i + 1}判断答案`);
        if (q.type === 'blank' && q.stem.indexOf('____') < 0) bad.push(`#${i + 1}填空无横线`);
        if ((q.type === 'blank' || q.type === 'essay') && !String(q.answer).trim()) bad.push(`#${i + 1}无答案`);
      });
      out.push({ name: co.name, chars: co.text.replace(/\s/g, '').length, got: qs.length, want: 12, bad });
    }
    return out;
  });

  console.log('语料'.padEnd(34) + '字数   生成/目标  问题');
  let totalBad = 0;
  report.forEach(r => {
    totalBad += r.bad.length;
    console.log(
      r.name.slice(0, 32).padEnd(34) +
      String(r.chars).padStart(5) + '  ' +
      (r.got + '/' + r.want).padStart(9) + '  ' +
      (r.bad.length ? r.bad.join('; ') : '无')
    );
  });
  console.log('\n合计结构问题:', totalBad);
  await browser.close();
  process.exit(totalBad ? 1 : 0);
})();
