# FloatingCloud

网易云音乐的透明桌面歌词插件，提供双行滚动、逐词高亮、翻译、副歌辉光和纯音乐频谱。

## 安装

1. 从 [Releases](https://github.com/YuuFong/FloatingCloud/releases) 下载 `FloatingCloud-v0.4.37.plugin`。
2. 在 BetterNCM 中安装插件并重启网易云音乐。
3. 在插件设置中打开桌面浮窗。需要译文时开启“外文歌曲优先显示对应翻译”。

当前构建面向 Windows x64、网易云音乐 3.1.42 和 BetterNCM。歌词获取依次尝试 TaskbarLyrics 的 QQ 音乐、酷狗、网易云和 LRCLIB 来源，也支持本地歌词文件。歌词来源和译文可用性会因歌曲而异。

## 构建

Windows 环境下运行 `tools/build-windows.ps1`；脚本会构建原生组件、歌词获取助手并打包 `.plugin`。本项目使用的 TaskbarLyrics 代码及许可见 `plugin/THIRD_PARTY_LICENSE.txt`。
