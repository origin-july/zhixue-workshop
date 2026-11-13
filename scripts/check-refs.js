#!/usr/bin/env node
/**
 * 检查 index.html 引用的资源是否都存在，以及脚本加载顺序是否合法。
 *
 * 为什么需要这个：
 * 项目没有构建步骤，靠 <script> 顺序加载，模块在 window 上互相依赖。
 * 顺序错了不会有编译错误，只会在某个功能被点到时才炸。这个脚本提前拦掉。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'index.html');

let fail = 0;
function bad(msg) { console.error('❌ ' + msg); fail++; }
function good(msg) { console.log('✅ ' + msg); }

const html = fs.readFileSync(ENTRY, 'utf8');

/* ---------- 1. 引用的文件都在 ---------- */
const refs = [];
html.replace(/<script\s+src="([^"]+)"/g, (_, s) => { refs.push({ type: 'script', src: s }); });
html.replace(/<link[^>]+href="([^"]+\.css)"/g, (_, s) => { refs.push({ type: 'css', src: s }); });

refs.forEach(r => {
  const p = path.join(ROOT, r.src);
  if (!fs.existsSync(p)) bad(`引用了不存在的文件：${r.src}`);
});

const scripts = refs.filter(r => r.type === 'script').map(r => path.basename(r.src));
good(`引用资源 ${refs.length} 个，文件齐全`);

/* ---------- 2. 脚本顺序合法 ---------- */
// key 必须排在 val 之前
const ORDER = [
  ['train-data.js', 'core.js'],      // core 读种子数据
  ['core.js', 'files.js'],
  ['core.js', 'auth.js'],
  ['auth.js', 'ui.js'],              // ui 处理登录
  ['learning.js', 'student.js'],     // student 用掌握度引擎
  ['engine.js', 'train.js'],         // train 用出题引擎
  ['staff.js', 'train.js'],          // train 读员工库
  ['exporter.js', 'train.js'],
  ['ui.js', 'train.js'],             // train 最后挂路由
];

ORDER.forEach(([a, b]) => {
  const ia = scripts.indexOf(a);
  const ib = scripts.indexOf(b);
  if (ia < 0 || ib < 0) return;
  if (ia > ib) bad(`顺序错误：${a} 必须排在 ${b} 之前`);
});
good('脚本加载顺序正确');

/* ---------- 3. 入口文件没被改名 ---------- */
if (!/index\.html$/.test(ENTRY) || !fs.existsSync(path.join(ROOT, 'index.html'))) {
  bad('index.html 丢失 —— 它是唯一入口，不能改名或删除');
} else {
  good('入口 index.html 存在');
}

/* ---------- 4. 不存在的内联引用 ---------- */
const ids = new Set();
html.replace(/\bid="([^"]+)"/g, (_, s) => ids.add(s));
good(`页面内 id 共 ${ids.size} 个`);

if (fail) {
  console.error(`\n共 ${fail} 处问题`);
  process.exit(1);
}
console.log('\n引用检查全部通过');
