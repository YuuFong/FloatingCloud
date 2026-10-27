# FloatingCloud v0.4.1 β — Windows 实机验收清单

本版本从已能运行的 v0.4.0 Alpha 单独分支开发。**不接管或修改网易云原生桌面歌词**。

## 修改

- 主行/副行共享一个 `fontSize`，不再有 `nextFontSize`；默认只显示当前行 + 下一行。
- 切句时保留原 DOM 行并推进队列，避免字号改变及末帧整体重绘造成抽动。
- YRC 和 LRCLIB Lyricsfile 使用每个词的真实起止时间，映射到整行文字遮罩，不再给每个词套独立扫描遮罩；LRC 仍是行级扫描。
- 歌词区域点击展开工具栏，按住拖动窗口；无需拖动顶部小白条。
- 工具栏提供歌曲信息、±0.5s、上一曲、播放/暂停、下一曲、设置（字号 ±）、锁定和关闭；播放/暂停状态随时间轴更新。
- 锁定窗口时，尝试 `WS_EX_LAYERED | WS_EX_TRANSPARENT` 穿透到下层程序；**Windows / DirectComposition 实机行为待验证**。
- 歌词源：网易云 YRC / LRC 为首选；不可用时查询 LRCLIB，只接受匹配歌曲名、歌手和时长的记录。LRCLIB 同步逐词仅在有效 Lyricsfile 提供词时间时启用；否则回退 LRC。QQ/Kugou QRC/KRC 尚未接入，不能宣称完整复刻 TaskbarLyrics。

## 安装

1. 在该分支对应 Actions 成功记录的 Artifacts 中下载 `FloatingCloud-plugin-win64`。
2. 解压获取 `FloatingCloud-v0.4.1.plugin`，完全退出网易云，把旧版 `.plugin` 移到独立的备份目录。
3. 将新文件放入 `C:\betterncm\plugins\`，不要改动 `plugins_runtime`。
4. 重启网易云音乐，在 BetterNCM → FloatingCloud 打开桌面浮窗。

## 验收

- 两行歌词大小一致，连续多次切句不抽动。
- 带逐词时间的歌曲应随词移动遮罩；暂停时停住，跳转后立即重定位。
- 单击歌词区域显示工具栏，拖拽主行和副行可移动整个浮窗；操作按钮不应误触拖动。
- 暂停按钮能反映实际播放状态；±0.5s 调整播放位置。
- **重点：**锁定后能点击歌词下方的桌面图标或其他程序；如果没穿透或透明背景消失，暂时在 BetterNCM 插件设置页“解除浮窗锁定”，不要继续沿用该版本。
- 无进度条，不修改内置桌面歌词。

## 已完成自动验证

GitHub Actions Windows 2022 x64：`node --test`、JS 语法检查、HTML 自动生成 / 内嵌 JS 检查、MSVC DLL 编译、`.plugin` 打包通过。

尚未做真实网易云 3.1.42 + WebView2 的鼠标穿透、拖动与各歌词源 HTTP 请求测试；这些仍是测试版风险。
