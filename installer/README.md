# FloatingCloud 离线一键安装器（Windows x64）

安装器采用 .NET 8 Windows Forms，并且把**完整构建且校验过的 `.plugin` 文件嵌入同一个自包含的 EXE**。第一次安装 FloatingCloud 不依赖 GitHub API，不要求用户安装 .NET 运行时。

## 最简单的使用方法

1. 从 GitHub Releases 下载 `FloatingCloud-Setup.exe`，双击运行。
2. Setup 自动检测网易云音乐 3.1.42 和 BetterNCM，若路径不对可手动选择。
3. 如果缺少 BetterNCM，点击「安装 BetterNCM」打开**官方**安装器，完成后启动网易云一次以创建数据目录，再完全退出网易云（包括托盘）。
4. 点击「一键离线安装」即可从 EXE 内置包部署 FloatingCloud，**全程不需要 GitHub API**。
5. 重启网易云，在 BetterNCM 设置页打开 FloatingCloud 的桌面歌词。

已经安装 FloatingCloud 的用户可重复使用安装器：它会备份原有插件包到 BetterNCM 数据目录下的 `floatingcloud-backups`，替换安装包，不删除既有设置。检测到更新后的包更旧时会询问是否降级。

## 其他按钮

- **在线检查更新**：可选；通过 GitHub Releases API 下载最新正式版插件，不影响离线安装。代理节点共享 IP 被限流（403/429）时会有明确提示。
- **本地安装 .plugin**：选择用户已经下载的插件包，不需要联网。
- **安装 BetterNCM**：打开 [官方 BetterNCM 安装器](https://github.com/std-microblock/BetterNCM-Installer/releases/latest)，**不静默安装或篡改第三方程序**。
- **选择网易云路径、选择插件数据目录**：支持自定义安装位置和 `BETTERNCM_PROFILE` 环境变量。

## 兼容性与安全设计

- 仅支持 Windows x64 和当前插件清单声明的网易云音乐 **3.1.42**。
- 必须已安装 BetterNCM，原生加载器 `msimg32.dll` 必须在网易云目录中。
- 安装之前必须彻底关闭网易云音乐；不会在播放时覆盖原生 DLL。
- `.plugin` 必须是含有 `floatingcloud-lite` 标识、版本号和关键组件的 ZIP 包。
- 插件旧版本会先备份；保留 BetterNCM 配置和插件设置。
- EXE 尚未签名，Windows SmartScreen 可能发出提示；首次公开发布前必须在 Windows 实机验证路径检测、安装和回滚。
- 安装器不会在后台自动检查或静默安装任何更新。

## 构建流程

GitHub Actions 的 [Build FloatingCloud Offline Setup](../.github/workflows/installer.yml) 在 Windows runner：

1. 运行 JavaScript 测试、编译 C++ `native.dll` 和 .NET 歌词助手；
2. 校验生成的 `FloatingCloud-v<manifest版本>.plugin`；
3. 复制完整包到 `dist/bundled/FloatingCloud.plugin`；
4. 编译 `FloatingCloud-Setup.exe`，将插件包以嵌入式资源 `FloatingCloud.Setup.BundledPlugin` 打包进去；
5. 上传 Actions Artifacts（含 EXE 和单独的 `.plugin` 供测试）。

发布匹配的 GitHub Release 时，工作流还会把 EXE 和对应 `.plugin` 一并附加到该 Release。

本地编译也必须先运行 `tools/build-windows.ps1`，然后将 `.plugin` 复制到 `dist/bundled/FloatingCloud.plugin` 再运行：

```powershell
dotnet publish installer/FloatingCloud.Setup.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -p:IncludeNativeLibrariesForSelfExtract=true -o dist/installer
```

离线安装器仅内置 FloatingCloud，不内置网易云音乐或 BetterNCM。
