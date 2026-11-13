/* 手机尺寸下学员中心是否可用 */
const { chromium, devices } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

  const ok = [], bad = [];
  const check = (n, c, x) => (c ? ok : bad).push(n + (x ? ' — ' + x : ''));

  for (const [label, vp] of [['iPhone 390', { width: 390, height: 844 }], ['平板 768', { width: 768, height: 1024 }]]) {
    const page = await browser.newPage({ viewport: vp, isMobile: vp.width < 500, hasTouch: true });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', d => d.accept());

    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(800);
    await page.fill('#loginUser', 'chensiyuan');
    await page.fill('#loginPass', 'train2026');
    await page.click('#loginBtn');
    await page.waitForTimeout(1100);

    const home = await page.evaluate(() => ({
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      hero: !!document.querySelector('.lw-hero'),
      focus: !!document.querySelector('.lw-focus'),
      rows: document.querySelectorAll('.lw-row').length,
      minFont: Math.min(...[...document.querySelectorAll('body *')]
        .filter(e => e.offsetParent !== null && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1))
        .map(e => parseFloat(getComputedStyle(e).fontSize)))
    }));
    check(label + ' 学习台无横滚', !home.hScroll);
    check(label + ' 学习台结构完整', home.hero && home.focus && home.rows > 0);
    check(label + ' 字号达标', home.minFont >= 13, home.minFont + 'px');

    // 进学习页
    await page.locator('.lw-row').first().click();
    await page.waitForTimeout(900);
    const course = await page.evaluate(() => ({
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      nav: document.querySelectorAll('.lwcn-item').length,
      navHeight: (document.querySelector('.lwc-nav') || {}).offsetHeight,
      content: !!document.querySelector('.lwm, .lwe'),
      contentBottom: Math.round((document.querySelector('.lwc-content') || {}).getBoundingClientRect?.().bottom || 0),
      vh: innerHeight
    }));
    check(label + ' 学习页无横滚', !course.hScroll);
    check(label + ' 小节导航可用', course.nav >= 2, course.nav + ' 项 · 高 ' + course.navHeight + 'px');

    // 考试
    await page.click('.lwcn-item.is-exam');
    await page.waitForTimeout(600);
    await page.click('.lwe-start');
    await page.waitForTimeout(900);
    const exam = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('.lx-opt')];
      const foot = document.querySelector('.lx-foot');
      return {
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        opts: opts.length,
        optH: opts[0] ? Math.round(opts[0].getBoundingClientRect().height) : 0,
        footVisible: foot ? (foot.getBoundingClientRect().bottom <= innerHeight + 2) : false,
        submitVisible: !!document.querySelector('.lx-submit'),
        stripWrap: (document.querySelector('.lx-strip') || {}).offsetHeight
      };
    });
    check(label + ' 考试无横滚', !exam.hScroll);
    check(label + ' 选项触控区', exam.optH >= 44, exam.optH + 'px 高');
    check(label + ' 底部导航可见', exam.footVisible && exam.submitVisible);

    // 成绩
    await page.click('[data-submit]');
    await page.waitForSelector('.lr-hero', { timeout: 20000 }).catch(() => { });
    await page.waitForTimeout(700);
    const res = await page.evaluate(() => ({
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      score: !!document.querySelector('.lr-score'),
      mastery: document.querySelectorAll('.lw-mrow').length
    }));
    check(label + ' 成绩页无横滚', !res.hScroll);
    check(label + ' 成绩页完整', res.score && res.mastery >= 1, res.mastery + ' 个知识点');

    check(label + ' 无运行时错误', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  console.log('');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (bad.length) { console.log(''); bad.forEach(x => console.log('  ✗ ' + x)); }
  console.log(`\n通过 ${ok.length} 项，失败 ${bad.length} 项`);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
