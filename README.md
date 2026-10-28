# FloatingCloud

网易云音乐的透明桌面歌词插件，提供双行滚动、逐词高亮、翻译、副歌辉光和纯音乐频谱。

## 安装

**普通用户（推荐）**

从 [Releases](https://github.com/YuuFong/FloatingCloud/releases) 下载 `FloatingCloud-Setup.exe`（提供该附件的版本），双击运行。Setup 会检查网易云版本与 BetterNCM、在线下载 FloatingCloud 并部署到插件目录；缺少 BetterNCM 时会引导打开其官方安装器。具体步骤、限制见 [安装器说明](installer/README.md)。

**手动安装**

1. 从 [Releases](https://github.com/YuuFong/FloatingCloud/releases) 下载最新版本的 `.plugin` 文件（例如 `FloatingCloud-v0.4.38.plugin`）。
2. 将 `.plugin` 文件放入 BetterNCM 的插件目录（通常是 `C:\betterncm\plugins`，也可能使用自定义数据目录）；**不要解压**。
3. 重启网易云音乐，在插件设置中打开桌面浮窗。需要译文时开启“外文歌曲优先显示对应翻译”。

当前构建面向 Windows x64、网易云音乐 3.1.42 和 BetterNCM。歌词获取依次尝试 TaskbarLyrics 的 QQ 音乐、酷狗、网易云和 LRCLIB 来源，也支持本地歌词文件。歌词来源和译文可用性会因歌曲而异。

## 检查更新

FloatingCloud v0.4.38 起，插件设置页顶部提供 **「插件版本与更新」**。打开设置页时会联网检查 GitHub 最新**正式** Release（24 小时内仅自动检查一次），也可以随时手动点击「检查更新」。发现有较新版本并且包含对应的 `.plugin` 安装包时，显示下载入口。

此功能仅检测和提示，**不会在播放期间热替换原生 DLL 或自动安装文件**。前往 [Releases](https://github.com/YuuFong/FloatingCloud/releases) 下载新版插件或安装器后，关闭网易云音乐再安装，重启生效。联网失败会显示原因，不影响歌词播放；如果当前开发版高于最新正式 Release，也会明确提示。

## 构建

Windows 环境下运行 `tools/build-windows.ps1`；脚本会构建原生组件、歌词获取助手并打包 `.plugin`。本项目使用的 TaskbarLyrics 代码及许可见 `plugin/THIRD_PARTY_LICENSE.txt`。

安装器可在 GitHub Actions 的 **Build FloatingCloud Setup** 工作流中生成，或参照 [安装器开发文档](installer/README.md) 编译。
