# FloatingCloud 一键安装器 · BetterNCM + InfLink-rs + FloatingCloud

这个安装器以 **一键完成所有依赖** 为目标：支持 Windows x64 和当前 FloatingCloud 要求的网易云音乐 **3.1.42**。

## 用户只需做什么

下载并打开 `FloatingCloud-Setup.exe`，确认自动识别的网易云路径，点击 **一键安装 / 修复**。

安装器会依次：

1. 优先读取注册表 `App Paths\\cloudmusic.exe`（与 BetterNCM 官方安装器相同的检测入口），并回退到常见安装目录、卸载注册表；找不到时才提供手动选择。
2. 检测网易云版本、是否正在运行、是否已装 BetterNCM。
3. **缺少 BetterNCM**：向用户说明将安装第三方程序并获得同意，从 EXE 内已嵌入的 **BetterNCM 1.3.4 官方 x64 DLL** 提取经过构建校验的原始文件，必要时申请管理员权限，放在网易云安装目录并命名为 `msimg32.dll`；按官方逻辑补齐缺失的 Microsoft VC++ x86/x64 运行库。这样不会再因 GitCode 适配目录返回 HTTP 406 而中断。
4. **自动部署 InfLink-rs**：安装器在构建时从作者的 [GitHub Releases](https://github.com/apoint123/inflink-rs/releases) 获取并验证**未经修改**的 `InfLink-rs.plugin`，作为嵌入式资源分发；若已安装同版或更新版则跳过。
5. **自动部署 FloatingCloud**：从 EXE 内置的 `.plugin` 安装，在更换版本前备份用户已有的插件包；保留设置。
6. 检查安装后的文件，提示完成并启动网易云音乐。

已有 BetterNCM 的用户**不需要再次下载或覆盖** BetterNCM；直接安装 InfLink-rs 和 FloatingCloud。手动选择路径是检测失败后的备用功能，不是正常安装步骤。

## 其他功能

- **在线更新 FC**：可选，获取 Github 最新正式版 `.plugin`；共享代理节点导致 API 限流时可以继续使用本机离线安装。
- **本地导入 FC**：离线选择用户已有的 `.plugin` 文件。
- **BetterNCM 官方备用**：如果系统权限或旧版本遗留文件阻止安装，可以转用其官方安装器；正常首次安装不再访问 GitCode。
- **第三方许可**：可查看随 EXE 嵌入的 InfLink-rs GPL-3.0-only 完整许可文本。
- 自动检测 `BETTERNCM_PROFILE` 环境变量，也允许手动选择数据目录；备份位于 `<BetterNCM 数据目录>\\floatingcloud-backups`。

## 第三方代码与分发说明

- [BetterNCM](https://github.com/std-microblock/chromatic/tree/1.3.4) (GPL-3.0)：构建时从原项目最后一版 BetterNCM **v1.3.4** Release 获取未修改的 `BetterNCMII.dll` x64，并校验 PE 结构及记录 SHA-256；安装器内置原版 DLL、GPL 许可文本及对应版本源码链接。用户许可安装后才会写入网易云目录。另参考 [BetterNCM-Installer](https://github.com/std-microblock/BetterNCM-Installer) 的注册表定位与 VC++ 依赖检查实现，安装器逻辑为独立 C# 实现。
- [InfLink-rs](https://github.com/apoint123/inflink-rs) by apoint123 (GPL-3.0-only)：原始 `.plugin` 不修改，单独存放并安装，不与 FC 插件文件合并；安装包附带完整 GPL 许可并提供对应原始源代码仓库。InfLink-rs 的版本取决于构建时作者发布的最新正式版。
- [Microsoft VC++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)：缺少运行库时从微软官方 HTTPS 地址下载安装。

第三方组件均在安装时透明展示，用户可以拒绝管理员权限请求，遇到不符合版本或下载校验错误时不会强制安装。

## 开发 / 打包

GitHub Actions 的 [Build FloatingCloud Offline Setup](../.github/workflows/installer.yml) 在 Windows：

1. 编译 FloatingCloud 的 native.dll + 自包含歌词助手，打包并校验 `.plugin`。
2. 下载并校验 InfLink-rs 官方正式 Release 插件包，以及 BetterNCM v1.3.4 官方 DLL，获取对应 GPL 文本。
3. 将 FC、InfLink-rs 两个独立 `.plugin`、BetterNCM 的 DLL 和各自许可作为资源嵌入 `FloatingCloud-Setup.exe`。
4. 构建自包含 Windows x64 EXE，在 Actions Artifacts 中提供安装器和 FC 插件供测试。

由于新增了外部依赖下载，CI 必须成功验证 InfLink-rs 包，才会生成可分发的 EXE。

### 当前仍需实机验证

- 网易云 3.1.42 注册表路径识别（常见路径与自定义目录）。
- 从**尚未安装 BetterNCM**的电脑，安装 BetterNCM DLL、VC++ 运行库以及两款插件。
- 非管理员/系统保护目录的 UAC 提权体验。
- 已安装 BetterNCM 或已有 InfLink-rs 的重复安装与版本更新。
- 网易云启动后确认 InfLinkApi 工作与 FloatingCloud 歌词显示。

CI 成功只能说明代码编译、打包校验通过；这不等于真实 Windows 环境已全部验证完成。
