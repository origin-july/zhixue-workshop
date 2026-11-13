/* 视觉核对：抓关键元素的实际计算样式，确认设计意图落地 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  page.on('dialog', d => d.accept());
  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  await page.fill('#loginUser', 'chensiyuan');
  await page.fill('#loginPass', 'train2026');
  await page.click('#loginBtn');
  await page.waitForTimeout(1300);

  const s1 = await page.evaluate(() => {
    const g = (sel, props) => {
      const e = document.querySelector(sel);
      if (!e) return 'MISSING';
      const c = getComputedStyle(e);
      return props.map(p => p + '=' + String(c[p]).slice(0, 42)).join(' | ');
    };
    const rect = sel => {
      const e = document.querySelector(sel);
      if (!e) return 'MISSING';
      const b = e.getBoundingClientRect();
      return `${Math.round(b.width)}×${Math.round(b.height)}`;
    };
    return {
      学习台hero: g('.lw-hero', ['backgroundImage']).slice(0, 70),
      继续学习卡: g('.lw-focus', ['backgroundImage']).slice(0, 70),
      问候字号: g('.lw-hi', ['fontSize', 'fontWeight']),
      进度环: rect('.lw-ring'),
      掌握度条强: g('.lw-mbar > i.lv-strong', ['backgroundImage']).slice(0, 56),
      掌握度标签强: g('.lw-mlv.lv-strong', ['color', 'fontWeight']),
      等级徽章: g('.lwr-badge', ['backgroundColor', 'color']),
      行进度条: g('.lwr-bar > i', ['backgroundImage']).slice(0, 50),
      培训行: rect('.lw-row'),
      掌握度面板: rect('.lw-mb')
    };
  });
  Object.entries(s1).forEach(([k, v]) => console.log(k.padEnd(8) + ' : ' + v));

  // 学习页
  await page.click('.lw-focus');
  await page.waitForTimeout(900);
  const s2 = await page.evaluate(() => {
    const g = (sel, props) => {
      const e = document.querySelector(sel);
      if (!e) return 'MISSING';
      const c = getComputedStyle(e);
      return props.map(p => p + '=' + String(c[p]).slice(0, 40)).join(' | ');
    };
    const rect = sel => {
      const e = document.querySelector(sel);
      if (!e) return 'MISSING';
      const b = e.getBoundingClientRect();
      return `${Math.round(b.width)}×${Math.round(b.height)} @${Math.round(b.left)},${Math.round(b.top)}`;
    };
    return {
      三栏宽度: rect('.lwc-nav') + '  |  ' + rect('.lwc-content'),
      导航选中: g('.lwcn-item.is-on', ['backgroundColor', 'borderColor']),
      已完成勾选: g('.lwcn-item.is-done .lwcn-tick', ['backgroundColor', 'color']),
      正文段落: g('.lmp-p', ['fontSize', 'lineHeight', 'color']),
      材料标题: g('.lwm-title', ['fontSize', 'fontWeight']),
      已读按钮: g('.lwm-btn.is-done.on', ['backgroundColor', 'color'])
    };
  });
  Object.entries(s2).forEach(([k, v]) => console.log(k.padEnd(8) + ' : ' + v));

  // 考试
  await page.click('.lwcn-item.is-exam');
  await page.waitForTimeout(600);
  await page.click('.lwe-start');
  await page.waitForTimeout(900);
  const s3 = await page.evaluate(() => {
    const g = (sel, props) => {
      const e = document.querySelector(sel);
      if (!e) return 'MISSING';
      const c = getComputedStyle(e);
      return props.map(p => p + '=' + String(c[p]).slice(0, 40)).join(' | ');
    };
    return {
      题型标签: g('.lx-qtype', ['backgroundColor', 'color']),
      题干: g('.lx-stem', ['fontSize', 'lineHeight', 'fontWeight']),
      选项: g('.lx-opt', ['fontSize', 'borderWidth', 'borderRadius']),
      选项高度: Math.round(document.querySelector('.lx-opt').getBoundingClientRect().height) + 'px',
      交卷按钮: g('.lx-submit', ['backgroundImage']).slice(0, 56),
      倒计时: g('.lx-clock', ['fontSize', 'fontFamily']).slice(0, 60),
      题号格: g('.lx-dot.is-cur', ['boxShadow']).slice(0, 46)
    };
  });
  Object.entries(s3).forEach(([k, v]) => console.log(k.padEnd(8) + ' : ' + v));

  // 选项选中态
  await page.click('.lx-opt');
  await page.waitForTimeout(400);
  const sel = await page.evaluate(() => {
    const e = document.querySelector('.lx-opt.is-on');
    if (!e) return 'MISSING';
    const c = getComputedStyle(e);
    return '背景 ' + c.backgroundColor + ' | 边框 ' + c.borderColor + ' | 键 ' +
      getComputedStyle(e.querySelector('.lx-key')).backgroundColor;
  });
  console.log('选项选中  : ' + sel);

  // 成绩页
  await page.click('[data-submit]');
  await page.waitForSelector('.lr-hero', { timeout: 20000 });
  await page.waitForTimeout(800);
  const s4 = await page.evaluate(() => {
    const g = (sel, props) => {
      const e = document.querySelector(sel);
      if (!e) return 'MISSING';
      const c = getComputedStyle(e);
      return props.map(p => p + '=' + String(c[p]).slice(0, 40)).join(' | ');
    };
    return {
      分数: g('.lr-score', ['fontSize', 'fontWeight', 'color']).slice(0, 66),
      通过徽章: g('.lr-badge', ['backgroundColor', 'color']),
      统计格: document.querySelectorAll('.lr-stat').length + ' 格',
      掌握度行: document.querySelectorAll('.lw-mrow').length + ' 行',
      逐题卡: document.querySelectorAll('.lr-item').length + ' 张',
      建议下一步: (document.querySelector('.lr-next-d') || {}).textContent
    };
  });
  Object.entries(s4).forEach(([k, v]) => console.log(k.padEnd(8) + ' : ' + v));

  await browser.close();
})();
