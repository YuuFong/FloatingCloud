# FloatingCloud 一键安装器（Windows x64）

本目录包含一个独立的 .NET 8 Windows Forms 安装/更新工具。用户无需自行安装 .NET：GitHub Actions 将其打包为自包含的单个 `FloatingCloud-Setup.exe`。

## 使用步骤

1. 已安装网易云音乐 **3.1.42（x64）** 的 Windows 电脑下载并运行 `FloatingCloud-Setup.exe`。
2. 若界面显示缺少 BetterNCM，点击「安装 BetterNCM」，打开 [官方 BetterNCM Installer](https://github.com/std-microblock/BetterNCM-Installer/releases/latest)，安装后启动一次网易云音乐让 BetterNCM 初始化数据目录。
3. 完全关闭网易云音乐，包括托盘中的后台进程。
4. 返回 Setup 点击「重新检测」，再点击「一键安装 / 检查更新」。
5. Setup 从 [本项目最新正式 Release](https://github.com/YuuFong/FloatingCloud/releases/latest) 获取 `FloatingCloud-v*.plugin`，校验插件身份与关键组件，并将原始 `.plugin` 文件放进 BetterNCM 的 `plugins` 目录。
6. 重新启动网易云音乐，在插件设置页开启桌面歌词浮窗。

无法访问 GitHub 时，可先从 Releases 下载 `.plugin`，使用「从本地 .plugin 安装」。

## 功能与限制

- 识别常见安装目录及 Windows 卸载注册表；自定义网易云路径可手动选择 `cloudmusic.exe`。
- 检查 BetterNCM 加载器 `msimg32.dll` 与数据目录；允许手动选择 BetterNCM 数据目录，优先使用 `BETTERNCM_PROFILE` 环境变量。
- 当前版本严格限定网易云音乐 3.1.42，**不自动降级/升级网易云、不跳过版本检查**。
- 仅从本项目官方 GitHub Release 自动下载；校验 ZIP/manifest slug、版本以及原生 DLL 和歌词助手，不运行下载的 EXE。
- 不修改 BetterNCM 主程序、网易云安装目录和用户配置；仅维护 `plugins/FloatingCloud-v*.plugin`。
- 要求安装时关闭网易云。更新时覆盖相同版本文件并移除旧版同名模式包；不会删除插件设置。
- **不会静默安装 BetterNCM**，而是引导用户到其官方安装器，避免未经确认修改第三方程序。
- GitHub Release API 不可达、发布包缺失或系统不符合条件时明确报错，支持本地安装。
- 无自动后台更新：每次需要用户手动打开 Setup 检查更新。无需管理员权限即可使用的前提是 BetterNCM 数据目录允许当前用户写入。

## 构建

使用带有 .NET 8 SDK 的 Windows：

```powershell
dotnet publish installer/FloatingCloud.Setup.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -o dist/installer
```

或从 GitHub Actions 运行 **Build FloatingCloud Setup**，下载构建产物 `FloatingCloud-Setup-win-x64`。

在仓库新发布正式 Release 时，工作流会尝试将 `FloatingCloud-Setup.exe` 自动附加到该 Release。**首次发布之前，请在真实 Windows 电脑上测试网易云安装检测、BetterNCM 自定义数据目录、更新和正常卸载流程**。自包含 EXE 在未签名时可能触发 Windows SmartScreen，需要建立可信发布与签名流程。

## 开发者说明

安装器是单独的分发工具，不属于 BetterNCM 插件代码；核心插件 `.plugin` 仍由根目录 `tools/build-windows.ps1` 生成。为避免将发布安装器与插件二进制的构建耦合，Setup 在安装时通过 Release API 下载当前发布的已编译插件包。

BetterNCM 官方安装器：[std-microblock/BetterNCM-Installer](https://github.com/std-microblock/BetterNCM-Installer)。
