<div align="center">

# FloatingCloud ☁️

### 把日常写成一首歌
*Turning ordinary days into a song.*

适用于 Windows 的网易云音乐透明桌面歌词插件。  
让歌词融入桌面，而不是挡住桌面。

[**下载最新正式版**](https://github.com/YuuFong/FloatingCloud/releases/latest) · [**一键安装**](#快速开始) · [**功能介绍**](#功能亮点) · [**问题反馈**](https://github.com/YuuFong/FloatingCloud/issues)

</div>

---

## 认识 FloatingCloud

**FloatingCloud** 基于 [BetterNCM](https://github.com/std-microblock/BetterNCM) 与 [InfLink-rs](https://github.com/apoint123/inflink-rs)，通过独立的 Native / WebView2 透明窗口显示歌词。

它不拦截网易云音乐自带的桌面歌词，而是提供一套可调节外观、行为与歌词来源的独立悬浮窗。无论是中文、日文或英文歌曲，还是没有歌词的纯音乐，都能有适合的桌面呈现方式。

## 功能亮点

- **双行歌词与逐词高亮**：支持 YRC 时间轴、平滑滚动、可调行间距和滚动速度。
- **多语言译文**：支持对应翻译；没有译文的歌曲仍正常显示双行歌词。
- **副歌辉光**：在可识别的高亮段落为主行字体增加柔和光晕，强度和范围可调。
- **纯音乐频谱**：识别纯音乐后显示音频频谱，提供间距、柱高及显示策略设置。
- **自由布置桌面**：支持悬浮窗移动、锁定、宽度、字体、字号、颜色等个性化设置。
- **多个歌词来源**：借助 TaskbarLyrics 的歌词源尝试 QQ 音乐、酷狗、网易云和 LRCLIB；支持本地 LRC/QRC/KRC 等歌词文件与目录检测，实际可用性依歌曲而异。
- **版本检查**：设置页显示当前版本；可手动检查更新，打开设置页时按日缓存检查结果，不会在播放时热替换组件。

## 效果展示

FloatingCloud 支持中文、日文、英文歌词与双行译文，还可以在识别到纯音乐时显示动态频谱。桌面效果采用透明浮窗，可与壁纸自然融合。

> 本项目的真实运行截图正在整理为仓库展示素材。欢迎参阅下方的安装说明和设置介绍。

## 快速开始

### 方式一：一键安装（推荐）

从 [**Releases · 最新正式版**](https://github.com/YuuFong/FloatingCloud/releases/latest) 下载 **`FloatingCloud-Setup.exe`**，运行后点击 **「一键安装 / 修复」**。

安装器将自动识别网易云音乐路径，并按需部署 **BetterNCM → InfLink-rs → FloatingCloud**。三个组件的程序文件随安装器提供；通常不需要自行安装 BetterNCM 或手动寻找 InfLink-rs。安装时可能弹出 Windows 管理员权限确认。

安装完成后启动网易云音乐，在 BetterNCM 的 FloatingCloud 设置中打开桌面浮窗即可。安装器还支持本地导入、版本更新、备份旧版与自定义目录。

### 方式二：手动安装

如果电脑上已有兼容的 BetterNCM 和 InfLink-rs：

1. 从 [Releases](https://github.com/YuuFong/FloatingCloud/releases/latest) 下载 `FloatingCloud-v0.4.38.plugin`（或最新版本文件）。
2. 关闭网易云音乐，将 **原始 `.plugin` 文件** 放入 BetterNCM 的 `plugins` 目录（常见为 `C:\betterncm\plugins`；也可能由 `BETTERNCM_PROFILE` 指定），不要解压。
3. 移走旧版 FloatingCloud 安装包，重新启动网易云音乐，在插件设置中打开桌面浮窗。

详细安装方式及已知限制见 [**安装器文档**](installer/README.md)。

## 兼容性

| 项目 | 当前支持范围 |
| --- | --- |
| 系统 | Windows x64 |
| 网易云音乐 | **3.1.42**（例如 3.1.42.205594） |
| 插件框架 | BetterNCM（通过一键安装器自动部署） |
| 插件依赖 | InfLink-rs（通过一键安装器自动部署） |
| 最新正式版 | [v0.4.38](https://github.com/YuuFong/FloatingCloud/releases/tag/v0.4.38) |

**注意：** 此版本尚未适配网易云音乐 3.1.43 及其他未列出的版本。安装器并不包含网易云音乐客户端本身。由于安装器尚未进行代码签名，Windows SmartScreen 可能提示安全确认；建议仅从本仓库官方 Release 下载。

## 常见问题

**Q：已经安装 BetterNCM 了，还会重新安装一遍吗？**  
不会。安装器会检测现有加载器，并自动处理缺少的 InfLink-rs 与 FloatingCloud。

**Q：需要开代理吗？**  
初次离线安装不需要访问 GitHub API。缺少微软 VC++ 运行库时可能需要联网；插件的在线更新检查也需要连接 GitHub，某些共享代理节点可能遇到 API 限流。

**Q：为什么设置里显示“高于最新正式版”？**  
在正式版发布之前，测试构建的版本号可能比 GitHub 最新 Release 新。可手动点击「检查更新」刷新状态。

**Q：修改设置需要重启吗？**  
大部分外观设置自动保存并可实时预览；诊断模式等特定选项需要重启网易云音乐。

## 开发与构建

本项目由以下主要部分构成：

| 目录 | 内容 |
| --- | --- |
| `plugin/` | BetterNCM 插件设置页、歌词渲染与配置 |
| `native/` | Windows 原生透明窗体、WebView2 与频谱 |
| `lyric-helper/` | 歌词获取辅助程序 |
| `installer/` | Windows 一键安装器及第三方组件校验 |
| `tools/` | 构建脚本、回归测试与离线测试 |
| `.github/workflows/` | 自动构建与验证 |
| `release-notes/` | 正式版更新说明 |

Windows 开发环境下运行 `tools/build-windows.ps1` 构建插件包。需要 NuGet CLI、CMake、Windows C++ 构建工具、Python 与 .NET 8 SDK。完整打包环境以仓库 GitHub Actions 工作流为准。

保留的单元测试和集成测试均位于 `tools/`；历史 `TESTING-v0.4.x.md` 测试记录可通过 Git 历史查看，不再堆放在仓库根目录。

## 致谢与许可

FloatingCloud 使用或参考了以下独立开源项目：

- [BetterNCM / BetterNCM Installer](https://github.com/std-microblock/BetterNCM-Installer)：网易云音乐插件框架及安装方案。
- [InfLink-rs](https://github.com/apoint123/inflink-rs)：播放状态与时间轴信息。
- [TaskbarLyrics](https://github.com/ANYNC/TaskbarLyrics)：部分歌词来源与显示逻辑的参考。

第三方组件保留其各自许可证，请参阅 [`plugin/THIRD_PARTY_LICENSE.txt`](plugin/THIRD_PARTY_LICENSE.txt)、[`plugin/vendor/`](plugin/vendor/) 及 [安装器许可说明](installer/README.md)。

欢迎通过 [Issues](https://github.com/YuuFong/FloatingCloud/issues) 反馈问题或提出建议。

---

<div align="center"><sub>FloatingCloud · 把日常写成一首歌</sub></div>
