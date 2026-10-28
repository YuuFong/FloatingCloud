# FloatingCloud v0.4.3 Beta — Windows 实装/回归测试

**分支**：`fix/tbl-sources-spectrum-v043`（基于 v0.4.2，不直接覆盖 main）。

## 改动

1. **歌词切句闪烁**：参照 TBL `finalizeTransition`，冻结 track 与 line 的所有过渡，先设置最终透明度，再更新双行内容、字体变换和位置，强制布局同步后恢复动画。第三行只作缓冲，严格在双行视口外。
2. **歌词源不再调用网易云接口**：当前播放歌曲的标题/歌手/进度仍来自 BetterNCM/InfLink-rs，但删除了 `/api/song/lyric/v1` 请求。内置 `FloatingCloudLyrics.exe`：基于 **TaskbarLyrics v1.7.4** 的 `TaskbarLyrics.Core` 及其 **Lyricify.Lyrics.Helper**，依次查询 QQ 音乐（QRC）、酷狗（KRC）和 LRCLIB（LRC）；提供真实逐词时间时高亮，否则只作行级扫描。歌词源候选必须匹配标题、歌手和时长（允许 5s 误差）。辅助 JS 保留 LRCLIB 检索作为非原生环境降级路径。**不伪造逐词时间戳。**
3. **纯音乐频谱**：新增 `native/spectrum.cpp`。仅在有歌曲播放但没有同步歌词时使用 WASAPI loopback 在本机采集系统输出音频，进行 Hann 窗 + FFT + 21 对数频段和包络平滑。前端动画按 TBL 的 rise/fall 与 5–22px 柱状风格渲染；关闭浮窗时停止采集。**这采集系统输出而非网易云专属音频，未做音频录制和网络上传。**
4. **工具栏**：移至歌词上方较近的位置（29px），去掉底板、边框与阴影，只保留图标；点击歌词展开、3.5 秒自动隐藏、锁定立即隐藏；默认不显示歌曲进度条。
5. **许可证**：TBL MIT 原始版权保留在 `plugin/vendor/LICENSE-TaskbarLyrics.txt`，TBL 原始转场规划器在 `plugin/vendor/tbl-presentation.js`，歌词 helper 通过构建时锁定 v1.7.4 源代码重用。

## 打包与安装

1. Actions 构建成功后，在对应运行的 **Artifacts** 下载 `FloatingCloud-plugin-win64`。
2. 解压获取 `FloatingCloud-v0.4.3.plugin`，不需单独安装 .NET 或把 Helper.exe 手工复制到其他目录。
3. 完全退出网易云，将原 `.plugin` 备份到 `plugins` 以外的文件夹；把新版放进 `C:\betterncm\plugins\`；重启网易云。
4. 不要直接编辑 `plugins_runtime`。

## 验收重点

- 连续切句时第二行是否依然闪白；字号主行大 2px。
- 纯音乐、无歌词歌曲时是否出现随音量变化的 21 根频谱条；静音时是否落到基线；暂停后是否停止。
- 鼠标单击歌词后控件自动消失；工具栏位于歌词上方且没有半透明底板；锁定时工具栏应当消失。
- QQ、酷狗等有逐词歌词的歌曲是否显示正确来源及自然逐词扫描；同名异版本不得误配。
- 如果音频输出设备切换导致频谱暂时不动，重新打开浮窗；当前采集线程有自动重试。
- 原来 v0.4.2 的 Win32 穿透兼容性仍需实机验证。

## 限制

- TBL 的完整内存缓存、搜索并行调度与智能音源匹配评分尚未全部移植。当前优先级 QQ → 酷狗 → LRCLIB，查询为顺序执行，极端情况下可能需要十余秒。
- TBL 的部分歌词 UI 动画与频谱原生应用代码没有一比一移植；复用了 TBL Core provider + 转场规划器，Win32/JS 是适配版本。
- Windows x64、网易云 3.1.42；尚未进行使用者机器上的长时间稳定性和歌词源网络验证。
