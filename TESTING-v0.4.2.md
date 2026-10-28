# FloatingCloud 0.4.2 Beta — 实机验收

此测试版建立在 v0.4.1 修复分支上，尚未合并 main。自动生成的 `plugin/desktop.html` 与 `native.dll` 包含于 Actions 构建产物。

## 本版改动

- **TaskbarLyrics v1.7.4 MIT 原码**：`plugin/vendor/tbl-presentation.js`，原作者 anync，另附 `plugin/vendor/LICENSE-TaskbarLyrics.txt`。FloatingCloud 调用其 `PresentationPlanner / PresentationCoordinator` 负责 progressPatch、singleRoll、监听 transitionend、fallback 超时与取消管理。文字布局的 DOM 执行器是适配代码，不等于直接移植整个 TBL 应用。
- **严格双行裁切**：`fc-track top:0`，`stage.height = 2*pitch`。第三行仍为动画缓冲 DOM，但不会在裁切区域露出。
- **主/副行视觉字号差 2px**：主行 `fontSize`，副行以 `(fontSize - 2)/fontSize` 视觉缩放。切句时副行以相同时长升为 100%，主行淡出；避免切句完字体重排抽动。
- **工具栏布局/交互**：歌词区域上方预留固定 64px，快速设置面板与工具栏共用该区域；单击歌词呼出 3.5 秒后自动隐藏，锁定时强制隐藏并清掉焦点；歌词区域仍可拖动。Native 结合字号调整高度，避免文字与控件重叠。
- **多源回退**：网易云 YRC/LRC 优先，LRCLIB /api/get 精确检索失败时 /api/search 候选搜索，并验证歌曲名称、歌手与时长。Lyricsfile 可通过下一词起点推导省略的 `end_ms`。**QQ 音乐 QRC 和酷狗 KRC 仍未移植**：TBL 对应源码依赖 .NET Lyricify 的平台搜索与专用解码库，不能直接在 BetterNCM JS 中粘贴运行。不会用伪造逐词时间代替真实结果。

## 安装

1. GitHub Actions 运行 [40613672899](https://github.com/YuuFong/FloatingCloud/actions/runs/40613672899) → Artifacts → `FloatingCloud-plugin-win64`。
2. 解压后得到 `FloatingCloud-v0.4.2.plugin`。完全退出网易云，备份旧版文件并移到 `C:\betterncm\plugins\` 以外的目录。
3. 将新的 `.plugin` 放入 `C:\betterncm\plugins\` 后重启网易云。不要直接修改 `plugins_runtime`。

## 重点验收

1. 用歌词含三句以上、短句连续切换的歌曲，确认第三行顶部永不露出。
2. 检查当前行视觉字号比下一行大约 2px，且升为主行时不突跳、不中断逐词扫描。
3. 单击歌词：工具栏弹出；不操作 3.5s 后自动隐藏；再单击歌词应再次弹出。
4. 点击锁定：立即隐藏所有功能键；不能点击歌词下方的桌面图标则说明 Win32 穿透仍未通过，使用 BetterNCM 设置页解锁，必要时恢复 v0.4.1。
5. 调大字号、调小字号，检查工具栏始终不与歌词重合。
6. 测试有 YRC 的歌曲逐词高亮与暂停、快进，普通 LRC 只有行级扫描。
7. 当前仅网易云与 LRCLIB 在线源。QQ/酷狗不应在 UI 中宣称已接入。

## 自动化构建已通过

GitHub Actions Windows 2022 x64：JS 单测、HTML 生成 / 内嵌 JS 语法、MSVC x64 DLL 构建、插件打包通过。尚未在用户本机网易云 3.1.42 + WebView2 验证视觉质量及锁定穿透。
