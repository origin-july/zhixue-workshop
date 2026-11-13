# 参与贡献

谢谢愿意花时间。不管是提需求、报 bug、改文案、加测试还是写文档，都是贡献。

## 报 Bug

先搜一下有没有人提过。没有就开新 Issue，把这几件事说清：

- **你做了什么** —— 从登录到出问题的完整路径
- **你期望什么**
- **实际发生了什么**
- **环境** —— 浏览器和版本、系统、屏幕宽度（手机端的布局问题必须写）
- **截图**（界面问题几乎都需要）

少一项，就得来回问一轮，修得就慢。

## 提功能

先开 Issue 说清「你想解决什么问题」，而不是「你想要什么功能」。

「导出 CSV 里没有部门负责人，交报表时得手填」是好描述。
「加一个部门负责人字段」就没说清为什么。

## 跑起来

```bash
git clone https://github.com/{{GITHUB_USER}}/zhixue-workshop.git
cd zhixue-workshop
python3 -m http.server 8080   # 打开 http://localhost:8080
```

不需要 `npm install` 就能跑页面。只有跑测试才需要装依赖：

```bash
npm install
npx playwright install chromium
```

## 改代码

### 分支

```
main      稳定可发布
dev       日常迭代
feat/*    单个功能
fix/*     单个修复
```

从 `dev` 切出来，改完合回 `dev`。

### 提交信息

用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat(exam): 交卷移到右上角，下一题放右下
fix(board): 手机端姓名被挤成竖排
docs(readme): 补快速开始和账号说明
refactor(style): 清理 v8 遗留的渐变
test(learning): 补 BKT 边界用例
chore(deps): 升级 playwright 到 1.65
```

一句话说清「改了什么」，不要写「update」「fix bug」。

### 提交前必须做的

```bash
npm run test:all
```

全绿才能提 PR。红了先修，别指望别人替你兜。

## 代码约定

这套代码是**故意**保持原始的，请一起守住：

| 约定 | 原因 |
|---|---|
| **不引入构建步骤** | 双击就能跑是这个项目最大的卖点。加了 webpack/vite 就等于换了个项目 |
| **不引入框架** | ES5 IIFE + `window` 挂模块。三年后回来还能读懂 |
| **不引入新依赖** | 除 SheetJS 和 JSZip（解析 Office 文件必需），其余手写 |
| **单文件样式** | 全部在 `assets/style.css`，不拆分、不用预处理器 |
| **最小字号 13px** | 有测试守着，改了会红 |
| **手机端不许横向滚动** | 同上 |

### 改存储结构

`localStorage` 的 key 带版本前缀（`zhixue_workshop_v4`）。**改结构就换 key 名**，并写迁移逻辑，否则老用户的存档会读不出来。

### 改界面

提 PR 时附改前 / 改后截图。纯文字描述看不出对齐问题。

### 加测试

测试用 Playwright 真开浏览器跑，不是 jsdom 模拟。新功能配一两个关键路径的用例就够了，不用追求覆盖率。

## PR

- 标题和提交信息一样的格式
- 描述里写清「解决了什么」和「怎么验证的」
- 一个 PR 只做一件事。顺手重构请单独开一个

## 许可证

贡献的代码按 [MIT](LICENSE) 授权。
