# FloatingCloud Setup v0.1 — Windows 一键部署（测试版）

目标：普通用户只下载一个 EXE，无须自行处理 .plugin、plugins_runtime、Native DLL。安装器内置完整 FC v0.4.7 Beta 插件包。

## 下载和使用

打开 GitHub Actions → FloatingCloud Setup Win64 → 成功构建 → Artifacts → FloatingCloud-Setup-win64。解压后双击 FloatingCloud-Setup-v0.1.0.exe。

支持：Windows 10/11 x64 + 网易云音乐 3.1.42 x64。当前没有代码签名，Windows SmartScreen 可能显示未知发布者；请从自己的 GitHub 仓库获取并核对来源。

## 安装流程

1. 检测 cloudmusic.exe（正在运行的进程、系统卸载登记或常见路径），检查版本 3.1.42、架构 x64。
2. 探测网易云目录里的 msimg32.dll（BetterNCM 注入 DLL）。缺失时，经用户确认后下载并启动官方 BetterNCM Installer II 1.2.0。上游安装器有自己的窗口或 UAC，暂不保证零额外交互。
3. 识别现有 BetterNCM plugins 目录，优先 C:\betterncm\plugins，也支持现有 AppData 目录或手动选择；只在已存在的 C:\betterncm 根目录下自动创建 plugins 子目录。
4. 从 EXE 内嵌资源提取 FloatingCloud.plugin，读取 ZIP 内 manifest.json，要求 slug 为 floatingcloud-lite，且 Native DLL、桌面 HTML、歌词帮助程序齐全。
5. 如果没有 InfLink-rs，下载其官方 v3.4.0 .plugin，检查插件身份和 backend.dll；如果已安装，保留现有版本。
6. 正常请求关闭网易云，不强制杀进程。
7. 只根据插件 manifest 确认旧 FC，移动到 %LOCALAPPDATA%\FloatingCloud\Backups\时间戳-随机号，然后部署新插件；失败时尝试恢复旧包。
8. 只写 plugins，不碰 plugins_runtime，不删除用户配置。用户重新打开网易云后，BetterNCM 再加载 FC。

## 安全和兼容限制

- 当前是 v0.1 验证版，尚未进行用户 Windows 实机安装测试；CI 完成编译及无 GUI 自检不等于 Windows 上的每种安装情况都通过。
- BetterNCM Installer II 与 InfLink-rs 均来自各自官方 GitHub Release。InfLink-rs v3.4.0 已固定官方发布 SHA-256 并验证 ZIP 身份；BetterNCM Installer II v1.2.0 的官方 Release 暂未提供 SHA-256 digest，正式发布前仍需固定校验值并验证数字签名。
- msimg32.dll 存在并不代表 BetterNCM 已成功载入；要在用户电脑实际验证。
- 如果默认路径不存在、客户端自定义设置无法识别，安装器会要求用户选择已有 plugins 目录，而不是盲目写入。
- 只在缺失时下载第三方依赖，FC 本体始终离线可用；首次部署依赖时仍需联网。
- 尚无发布版在线更新与卸载器；下一版支持 Release 版本检查、修复、卸载与稳定回滚。

## 构建

先在 Windows 执行 tools/build-windows.ps1 生成 FloatingCloud-v0.4.7.plugin，然后发布 installer/FloatingCloud.Setup.csproj：

    dotnet publish installer/FloatingCloud.Setup.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o build/setup

使用 FloatingCloud.Setup.exe --selftest 检查内嵌包与目标版本规则。
GitHub Actions 配置在 .github/workflows/installer-windows.yml。
