using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text.Json;
using Microsoft.Win32;

namespace FloatingCloud.Setup;

// The main button is a complete dependency-aware installation, not a shortcut to a third-party page.
internal sealed partial class SetupForm
{
    private const string InfLinkResource = "FloatingCloud.Setup.InfLinkPlugin";
    private const string BetterNcmCatalog =
        "https://gitcode.net/qq_21551787/bncm-data-pack2/-/raw/master/betterncm/betterncm3.json";
    private const string InfLinkSource = "https://github.com/apoint123/inflink-rs";
    private readonly Label _infLink = NewLabel(247);
    private readonly ProgressBar _progress = new()
    {
        Left = 24, Top = 383, Width = 465, Height = 10,
        Style = ProgressBarStyle.Continuous
    };

    private static string? FindAppPath()
    {
        // BetterNCM Installer obtains the registered App Paths value first.
        foreach (var hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            try
            {
                using var registry = RegistryKey.OpenBaseKey(hive, view);
                using var key = registry.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\cloudmusic.exe");
                var registered = (key?.GetValue(null) as string)?.Trim().Trim('"');
                if (!string.IsNullOrWhiteSpace(registered) && File.Exists(registered)
                    && Path.GetFileName(registered).Equals("cloudmusic.exe", StringComparison.OrdinalIgnoreCase))
                    return Path.GetFullPath(registered);
            }
            catch (Exception) { /* Fall back to uninstall registry and known locations. */ }
        }
        return null;
    }

    private static bool IsBetterNcmInstalled(string? ncm)
    {
        return !string.IsNullOrWhiteSpace(ncm) &&
               File.Exists(Path.Combine(Path.GetDirectoryName(ncm)!, "msimg32.dll"));
    }

    private bool HasInflink()
    {
        var directory = Path.Combine(_profile, "plugins");
        return Directory.Exists(directory) && Directory
            .EnumerateFiles(directory, "*.plugin", SearchOption.TopDirectoryOnly)
            .Any(path => IsInflinkPackage(path));
    }

    private static bool IsInflinkPackage(string path)
    {
        try
        {
            using var zip = ZipFile.OpenRead(path);
            var entry = zip.GetEntry("manifest.json");
            if (entry is null) return false;
            using var stream = entry.Open();
            using var json = JsonDocument.Parse(stream);
            return json.RootElement.TryGetProperty("name", out var name) &&
                   name.GetString()?.Equals("InfLink-rs", StringComparison.OrdinalIgnoreCase) == true;
        }
        catch (Exception) { return false; }
    }

    private static void VerifyNcmExe(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path) ||
            !Path.GetFileName(path).Equals("cloudmusic.exe", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("找不到网易云音乐。请手动选择 cloudmusic.exe。");
        var fileVersion = FileVersionInfo.GetVersionInfo(path).FileVersion ?? "";
        var productVersion = FileVersionInfo.GetVersionInfo(path).ProductVersion ?? "";
        if (!new[] { fileVersion, productVersion }.Any(v =>
                System.Text.RegularExpressions.Regex.IsMatch(v, @"(^|\D)3\.1\.42(?:\D|$)")))
            throw new InvalidOperationException($"网易云版本不符合 FloatingCloud 要求（识别到 {fileVersion} / {productVersion}，需要 3.1.42）。");
        if (Process.GetProcessesByName("cloudmusic").Length != 0 ||
            Process.GetProcessesByName("cloudmusicn").Length != 0)
            throw new InvalidOperationException("请先完全退出网易云音乐，包括系统托盘中的后台进程，然后重试。");
        if (File.Exists(Path.Combine(Path.GetDirectoryName(path)!, "cloudmusicn.exe")))
            throw new InvalidOperationException("检测到旧版 BetterNCM 的 cloudmusicn.exe，请先使用官方工具迁移旧版。");
    }

    private async Task CompleteSetupAsync()
    {
        VerifyNcmExe(_cloudMusic);
        var infLinkReady = Assembly.GetExecutingAssembly().GetManifestResourceInfo(InfLinkResource) is not null;
        if (!infLinkReady)
            throw new InvalidOperationException("安装器未包含 InfLink-rs，请使用包含所有依赖的完整安装器。");
        var betterWasMissing = !IsBetterNcmInstalled(_cloudMusic);
        if (betterWasMissing)
        {
            var answer = MessageBox.Show(this,
                "没有检测到 BetterNCM。\n\n接下来将从官方适配目录下载 BetterNCM，安装到网易云音乐目录（可能弹出 Windows 管理员权限确认），然后自动安装 FloatingCloud 和 InfLink-rs。\n\n是否继续？",
                "一键部署三项组件", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (answer != DialogResult.Yes) return;
            SetStatus("步骤 1/3 · 获取 BetterNCM 官方兼容版本…");
            _progress.Value = 10;
            await InstallBetterNcmAsync(_cloudMusic!);
        }
        if (!IsBetterNcmInstalled(_cloudMusic))
            throw new InvalidOperationException("BetterNCM 还没有安装成功。请查看上方错误信息。");

        _progress.Value = 55;
        SetStatus("步骤 2/3 · 正在安装 InfLink-rs…");
        var inflinkResult = await InstallBundledInflinkAsync();
        _progress.Value = 78;
        SetStatus("步骤 3/3 · 正在安装 FloatingCloud…");
        await InstallBundledAsync();
        _progress.Value = 100;
        RefreshEnvironment();
        SetStatus("已完成：BetterNCM、InfLink-rs、FloatingCloud。重启网易云音乐即可使用。");
        MessageBox.Show(this,
            "三个组件已部署完成！\n\nBetterNCM：已安装\nInfLink-rs：" + inflinkResult +
            "\nFloatingCloud：已安装\n\n现在可以启动网易云音乐，在 BetterNCM 中打开桌面歌词。",
            "FloatingCloud 安装完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private async Task InstallBetterNcmAsync(string ncmExe)
    {
        if (IsBetterNcmInstalled(ncmExe)) return;
        var ncmVersion = new Version(3, 1, 42);
        JsonDocument catalog;
        try
        {
            using var response = await _http.GetAsync(BetterNcmCatalog);
            response.EnsureSuccessStatusCode();
            catalog = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                "无法读取 BetterNCM 官方适配目录。请检查校园网连接，也可使用官方 BetterNCM Installer 安装后重新点击一键部署。\n" + ex.Message, ex);
        }

        string? dllUrl = null;
        using (catalog)
        {
            if (!catalog.RootElement.TryGetProperty("versions", out var entries) ||
                entries.ValueKind != JsonValueKind.Object)
                throw new InvalidDataException("BetterNCM 官方适配目录数据格式有变化，拒绝猜测兼容 DLL。");
            foreach (var entry in entries.EnumerateObject())
            {
                if (!MatchesVersion(ncmVersion, entry.Name)) continue;
                if (entry.Value.TryGetProperty("url_x64", out var file))
                {
                    dllUrl = file.GetString();
                    break;
                }
            }
        }
        if (string.IsNullOrWhiteSpace(dllUrl))
            throw new InvalidOperationException("BetterNCM 官方目录中没有找到支持网易云 3.1.42 x64 的 DLL，请使用其官方安装器确认兼容版本。");

        var uri = new Uri(dllUrl);
        if (uri.Scheme != Uri.UriSchemeHttps || string.IsNullOrWhiteSpace(uri.Host))
            throw new InvalidDataException("BetterNCM 提供的下载地址不是 HTTPS，已停止。");
        var temp = Path.Combine(Path.GetTempPath(), "FloatingCloud-BetterNCM-" +
            Guid.NewGuid().ToString("N") + ".dll");
        try
        {
            SetStatus("步骤 1/3 · 下载 BetterNCM DLL…");
            await DownloadFileAsync(uri, temp, 100L * 1024 * 1024);
            if (!IsPeFile(temp, 0x8664))
                throw new InvalidDataException("下载的 BetterNCM 文件不是有效的 x64 Windows DLL。");
            VerifyNcmExe(ncmExe);
            var destination = Path.Combine(Path.GetDirectoryName(ncmExe)!, "msimg32.dll");
            try
            {
                File.Copy(temp, destination, overwrite: false);
            }
            catch (UnauthorizedAccessException)
            {
                // Request elevation only for writing to the protected NCM directory.
                SetStatus("步骤 1/3 · Windows 正在请求安装 BetterNCM 的管理员权限…");
                using var elevated = Process.Start(new ProcessStartInfo
                {
                    FileName = Environment.ProcessPath ??
                        throw new InvalidOperationException("无法定位安装器程序路径"),
                    Arguments = $"--install-betterncm \"{temp}\" \"{ncmExe}\"",
                    Verb = "runas",
                    UseShellExecute = true
                }) ?? throw new InvalidOperationException("无法启动管理员权限安装步骤");
                await Task.Run(elevated.WaitForExit);
                if (elevated.ExitCode != 0)
                    throw new InvalidOperationException("管理员权限安装 BetterNCM 未完成（已取消或出现错误）。");
            }
            if (!File.Exists(destination))
                throw new IOException("BetterNCM DLL 写入失败；请确认网易云目录允许写入。");
        }
        finally { try { File.Delete(temp); } catch (IOException) { } }
    }

    internal static bool RunElevatedBetterNcmInstall(string dll, string ncmExe)
    {
        try
        {
            if (!Path.GetFileName(ncmExe).Equals("cloudmusic.exe", StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(ncmExe) || !IsPeFile(dll, 0x8664))
                return false;
            var destination = Path.Combine(Path.GetDirectoryName(ncmExe)!, "msimg32.dll");
            if (File.Exists(destination)) return false;
            File.Copy(dll, destination, overwrite: false);
            return File.Exists(destination);
        }
        catch { return false; }
    }

    // Compatible with the simple semver ranges returned in BetterNCM's versions catalog.
    internal static bool MatchesVersion(Version version, string range)
    {
        var terms = range.Replace(",", " ").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (terms.Length == 0) return false;
        foreach (var term in terms)
        {
            var match = System.Text.RegularExpressions.Regex.Match(term,
                @"^(>=|<=|>|<|=|\^|~)?v?(\d+)\.(\d+)\.(\d+)$");
            if (!match.Success) return false;
            var op = match.Groups[1].Value;
            var reference = new Version(int.Parse(match.Groups[2].Value),
                int.Parse(match.Groups[3].Value), int.Parse(match.Groups[4].Value));
            var comparison = version.CompareTo(reference);
            var valid = op switch
            {
                ">=" => comparison >= 0,
                "<=" => comparison <= 0,
                ">" => comparison > 0,
                "<" => comparison < 0,
                "^" => comparison >= 0 && version.Major == reference.Major,
                "~" => comparison >= 0 && version.Major == reference.Major && version.Minor == reference.Minor,
                _ => comparison == 0
            };
            if (!valid) return false;
        }
        return true;
    }

    private static bool IsPeFile(string path, ushort expectedMachine)
    {
        try
        {
            using var file = File.OpenRead(path);
            using var reader = new BinaryReader(file);
            if (file.Length < 512 || reader.ReadUInt16() != 0x5A4D) return false;
            file.Position = 0x3c;
            var peOffset = reader.ReadInt32();
            if (peOffset < 64 || peOffset + 24 > file.Length) return false;
            file.Position = peOffset;
            if (reader.ReadUInt32() != 0x00004550) return false;
            return reader.ReadUInt16() == expectedMachine;
        }
        catch { return false; }
    }

    private async Task DownloadFileAsync(Uri url, string path, long maxSize)
    {
        using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > maxSize)
            throw new InvalidDataException("下载文件超过大小限制。");
        await using var stream = await response.Content.ReadAsStreamAsync();
        await using var output = new FileStream(path, FileMode.CreateNew);
        var buffer = new byte[65536];
        long total = 0;
        int n;
        while ((n = await stream.ReadAsync(buffer)) > 0)
        {
            total += n;
            if (total > maxSize) throw new InvalidDataException("下载文件超过大小限制。");
            await output.WriteAsync(buffer.AsMemory(0, n));
        }
    }

    private async Task<string> InstallBundledInflinkAsync()
    {
        await using var bundled = Assembly.GetExecutingAssembly().GetManifestResourceStream(InfLinkResource)
            ?? throw new InvalidDataException("安装器未包含 InfLink-rs.plugin。");
        var temp = Path.Combine(Path.GetTempPath(), "FloatingCloud-InfLink-" +
            Guid.NewGuid().ToString("N") + ".plugin");
        try
        {
            await using (var output = new FileStream(temp, FileMode.CreateNew))
                await bundled.CopyToAsync(output);

            string incomingVersion;
            using (var zip = ZipFile.OpenRead(temp))
            {
                var manifest = zip.GetEntry("manifest.json")
                    ?? throw new InvalidDataException("InfLink-rs 插件包没有 manifest。");
                using var document = JsonDocument.Parse(manifest.Open());
                var root = document.RootElement;
                if (root.GetProperty("name").GetString() != "InfLink-rs" ||
                    zip.GetEntry("backend.dll") is null || zip.GetEntry("index.js") is null)
                    throw new InvalidDataException("内置的 InfLink-rs 安装包不完整。");
                incomingVersion = root.GetProperty("version").GetString() ?? "";
                if (!Version.TryParse(incomingVersion, out _))
                    throw new InvalidDataException("InfLink-rs 版本号无效。");
            }

            var pluginDir = Path.Combine(_profile, "plugins");
            Directory.CreateDirectory(pluginDir);
            var existing = Directory.EnumerateFiles(pluginDir, "*.plugin")
                .Where(IsInflinkPackage).ToArray();
            foreach (var path in existing)
            {
                try
                {
                    using var zip = ZipFile.OpenRead(path);
                    using var document = JsonDocument.Parse(zip.GetEntry("manifest.json")!.Open());
                    var version = document.RootElement.GetProperty("version").GetString();
                    if (Version.TryParse(version, out var installed) &&
                        Version.TryParse(incomingVersion, out var bundledVersion) &&
                        installed.CompareTo(bundledVersion) >= 0)
                        return "已有 v" + version + "（无需更改）";
                }
                catch (Exception) { /* Replace corrupted older package after backup. */ }
            }

            var dest = Path.Combine(pluginDir, "InfLink-rs.plugin");
            var backups = Path.Combine(_profile, "floatingcloud-backups");
            Directory.CreateDirectory(backups);
            foreach (var old in existing)
            {
                var name = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + "-" +
                    Guid.NewGuid().ToString("N")[..6] + "-" + Path.GetFileName(old);
                File.Copy(old, Path.Combine(backups, name), overwrite: false);
            }
            var staging = Path.Combine(pluginDir, ".InfLink-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                File.Copy(temp, staging);
                File.Move(staging, dest, overwrite: true);
                foreach (var old in existing)
                    if (!old.Equals(dest, StringComparison.OrdinalIgnoreCase)) File.Delete(old);
            }
            finally { if (File.Exists(staging)) File.Delete(staging); }
            if (!IsInflinkPackage(dest))
                throw new IOException("InfLink-rs 安装结果校验失败。");
            return "已安装 v" + incomingVersion;
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}
