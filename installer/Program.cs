using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Win32;

namespace FloatingCloud.Setup;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length == 3 && args[0] == "--install-betterncm")
        {
            Environment.ExitCode = SetupForm.RunElevatedBetterNcmInstall(args[1], args[2]) ? 0 : 1;
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new SetupForm());
    }
}

internal sealed partial class SetupForm : Form
{
    private const string OfficialBetterNcm = "https://github.com/std-microblock/BetterNCM-Installer/releases/latest";
    private const string ReleaseApi = "https://api.github.com/repos/YuuFong/FloatingCloud/releases/latest";
    private const string AllowedDownload = "https://github.com/YuuFong/FloatingCloud/releases/download/";
    private const long MaxPackageBytes = 250L * 1024 * 1024;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(3) };
    private readonly Label _ncm = NewLabel(103);
    private readonly Label _better = NewLabel(143);
    private readonly Label _profileLabel = NewLabel(183);
    private readonly Label _installed = NewLabel(223);
    private readonly Label _status = NewLabel(452);
    private const string BundledResource = "FloatingCloud.Setup.BundledPlugin";
    private readonly Button _install = NewButton("一键安装 / 修复", 22, 312, 142);
    private readonly Button _updateOnline = NewButton("在线更新 FC", 186, 312, 142);
    private readonly Button _local = NewButton("本地导入 FC", 350, 312, 142);
    private readonly Button _official = NewButton("BetterNCM 官方备用", 22, 365, 148);
    private readonly Button _chooseNcm = NewButton("选择网易云路径", 180, 365, 148);
    private readonly Button _chooseProfile = NewButton("选择插件数据目录", 338, 365, 150);
    private readonly Button _refresh = NewButton("重新检测", 378, 506, 110);
    private readonly Button _licenses = NewButton("第三方许可", 24, 506, 130);
    private string? _cloudMusic;
    private string _profile = Environment.GetEnvironmentVariable("BETTERNCM_PROFILE", EnvironmentVariableTarget.User)
        ?? Environment.GetEnvironmentVariable("BETTERNCM_PROFILE", EnvironmentVariableTarget.Machine)
        ?? Environment.GetEnvironmentVariable("BETTERNCM_PROFILE")
        ?? @"C:\betterncm";
    private bool _busy;

    internal SetupForm()
    {
        Text = "FloatingCloud · 一键安装";
        ClientSize = new Size(515, 555);
        MinimumSize = MaximumSize = Size;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(248, 250, 254);
        Font = new Font("Microsoft YaHei UI", 9F);
        ForeColor = Color.FromArgb(37, 47, 69);

        _http.DefaultRequestHeaders.UserAgent.ParseAdd("FloatingCloud-Setup/0.5 (GitHub)");
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));

        Controls.Add(new Label {
            Text = "FloatingCloud", Left = 22, Top = 18, Width = 470, Height = 42,
            Font = new Font("Microsoft YaHei UI", 20F, FontStyle.Bold)
        });
        Controls.Add(new Label {
            Text = "自动安装 BetterNCM + InfLink-rs + FloatingCloud · Windows x64",
            Left = 24, Top = 64, Width = 468, Height = 27,
            ForeColor = Color.FromArgb(103, 116, 145)
        });
        foreach (var label in new[] { _ncm, _better, _profileLabel, _installed, _infLink, _status })
            Controls.Add(label);

        _install.BackColor = Color.FromArgb(57, 98, 210);
        _install.ForeColor = Color.White;
        _install.FlatStyle = FlatStyle.Flat;
        _install.FlatAppearance.BorderSize = 0;
        _install.Click += async (_, _) => await BusyAsync(CompleteSetupAsync);
        _updateOnline.Click += async (_, _) => await BusyAsync(InstallFromGithubAsync);
        _local.Click += async (_, _) => await BusyAsync(InstallFromLocalAsync);
        _official.Click += (_, _) => OpenUrl(OfficialBetterNcm);
        _chooseNcm.Click += (_, _) => ChooseCloudMusic();
        _chooseProfile.Click += (_, _) => ChooseProfile();
        _refresh.Click += (_, _) => RefreshEnvironment();
        _licenses.Click += (_, _) => ShowThirdPartyLicenses();
        foreach (var button in new[] { _install, _updateOnline, _local, _official, _chooseNcm, _chooseProfile, _refresh, _licenses })
            Controls.Add(button);

        Controls.Add(_progress);
        _status.ForeColor = Color.FromArgb(89, 99, 116);
        _status.Height = 54;
        _status.Width = 475;
        _status.Text = "准备检查环境。";
        Shown += (_, _) => RefreshEnvironment();
    }

    private static Label NewLabel(int top) => new()
    {
        Left = 24, Top = top, Width = 475, Height = 35, AutoEllipsis = true
    };

    private static Button NewButton(string text, int x, int y, int width) => new()
    {
        Text = text, Left = x, Top = y, Width = width, Height = 41,
        FlatStyle = FlatStyle.System
    };

    private void SetStatus(string message) => _status.Text = message;

    private void RefreshEnvironment()
    {
        _cloudMusic = File.Exists(_cloudMusic) ? _cloudMusic : FindCloudMusic();
        var version = _cloudMusic is null ? "" : GetCloudMusicVersion(_cloudMusic);
        _ncm.Text = _cloudMusic is null
            ? "网易云音乐：未检测到（可手动选择）"
            : $"网易云音乐：{version}  ·  {(_cloudMusic.Length > 50 ? Path.GetFileName(Path.GetDirectoryName(_cloudMusic)) : _cloudMusic)}";
        _better.Text = _cloudMusic is null ? "BetterNCM：等待检测"
            : File.Exists(Path.Combine(Path.GetDirectoryName(_cloudMusic)!, "msimg32.dll"))
              ? "BetterNCM：检测到加载器" : "BetterNCM：未检测到加载器，请先安装";
        _profileLabel.Text = $"插件数据目录：{_profile}";
        var pluginDir = Path.Combine(_profile, "plugins");
        _installed.Text = Directory.Exists(pluginDir)
            ? "已安装插件：" + (string.Join("、", Directory.GetFiles(pluginDir, "FloatingCloud-v*.plugin")
                .Select(Path.GetFileName).Take(3)) is var names && names.Length > 0 ? names : "未发现 FloatingCloud")
            : "插件目录：尚未建立（安装 BetterNCM 并启动网易云后再检测）";
        _infLink.Text = HasInflink() ? "InfLink-rs：已安装" : "InfLink-rs：未检测到（一键安装时自动部署）";
        if (!_busy) SetStatus("一键安装会自动检查并部署 BetterNCM + InfLink-rs + FloatingCloud。");
    }

    private static string GetCloudMusicVersion(string executable)
    {
        try
        {
            var info = FileVersionInfo.GetVersionInfo(executable);
            return info.ProductVersion ?? info.FileVersion ?? "未知版本";
        }
        catch { return "未知版本"; }
    }

    private static string? FindCloudMusic()
    {
        var appPath = FindAppPath();
        if (appPath is not null) return appPath;
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
        };
        foreach (var root in roots)
        {
            foreach (var relative in new[] { @"NetEase\CloudMusic\cloudmusic.exe", @"Netease\CloudMusic\cloudmusic.exe", @"CloudMusic\cloudmusic.exe" })
            {
                var path = Path.Combine(root, relative);
                if (File.Exists(path)) return path;
            }
        }
        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            try
            {
                using var baseKey = RegistryKey.OpenBaseKey(hive, view);
                using var uninstall = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall");
                if (uninstall is null) continue;
                foreach (var name in uninstall.GetSubKeyNames())
                {
                    using var key = uninstall.OpenSubKey(name);
                    var display = key?.GetValue("DisplayName") as string ?? "";
                    if (!display.Contains("网易云音乐") && !display.Contains("CloudMusic", StringComparison.OrdinalIgnoreCase)) continue;
                    var location = key?.GetValue("InstallLocation") as string;
                    if (string.IsNullOrWhiteSpace(location)) continue;
                    var path = Path.Combine(location.Trim('"'), "cloudmusic.exe");
                    if (File.Exists(path)) return path;
                }
            }
            catch (Exception) { /* Restricted registry keys are optional. */ }
        }
        return null;
    }

    private void ChooseCloudMusic()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "请选择网易云音乐的 cloudmusic.exe",
            Filter = "cloudmusic.exe|cloudmusic.exe",
            CheckFileExists = true
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _cloudMusic = dialog.FileName;
            RefreshEnvironment();
        }
    }

    private void ChooseProfile()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择 BetterNCM 数据目录（里面应有 plugins 文件夹）",
            SelectedPath = Directory.Exists(_profile) ? _profile : ""
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _profile = dialog.SelectedPath;
            RefreshEnvironment();
        }
    }

    private void CheckRequirements()
    {
        if (_cloudMusic is null || !File.Exists(_cloudMusic))
            throw new InvalidOperationException("未检测到网易云音乐。请点击「选择网易云路径」。");
        var version = GetCloudMusicVersion(_cloudMusic);
        // FloatingCloud's current manifest only supports >=3.1.42 <3.1.43.
        if (!System.Text.RegularExpressions.Regex.IsMatch(version, @"(^|\D)3\.1\.42(?:\D|$)"))
            throw new InvalidOperationException($"当前网易云版本为 {version}；此插件只支持 3.1.42，请不要强制安装。");
        if (!File.Exists(Path.Combine(Path.GetDirectoryName(_cloudMusic)!, "msimg32.dll")))
            throw new InvalidOperationException("未检测到 BetterNCM。请先点击「安装 BetterNCM」使用官方安装器。");
        if (!Directory.Exists(_profile))
            throw new InvalidOperationException("BetterNCM 数据目录不存在。请先启动安装过 BetterNCM 的网易云，或手动选择正确目录。");
        if (Process.GetProcessesByName("cloudmusic").Length != 0)
            throw new InvalidOperationException("请先完全退出网易云音乐（包括托盘），然后重新点击安装。");
    }

    private async Task BusyAsync(Func<Task> job)
    {
        if (_busy) return;
        _busy = true;
        foreach (var button in new[] { _install, _updateOnline, _local, _chooseNcm, _chooseProfile, _refresh }) button.Enabled = false;
        try { await job(); }
        catch (Exception e)
        {
            SetStatus("未完成：" + e.Message);
            MessageBox.Show(this, e.Message, "FloatingCloud 安装未完成", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            _busy = false;
            foreach (var button in new[] { _install, _updateOnline, _local, _chooseNcm, _chooseProfile, _refresh }) button.Enabled = true;
            var previous = _status.Text;
            RefreshEnvironment();
            SetStatus(previous);
        }
    }

    private async Task InstallBundledAsync(bool showCompletion = true)
    {
        CheckRequirements();
        SetStatus("正在验证安装器内置的 FloatingCloud 插件包…");
        var assembly = Assembly.GetExecutingAssembly();
        await using var source = assembly.GetManifestResourceStream(BundledResource)
            ?? throw new InvalidOperationException("内置插件包缺失，请从官方 GitHub Actions / Releases 重新下载完整安装器。");
        var temp = Path.Combine(Path.GetTempPath(), "FloatingCloud-" + Guid.NewGuid().ToString("N") + ".plugin");
        try
        {
            await using (var target = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                await source.CopyToAsync(target);
            InstallPlugin(temp);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    private async Task InstallFromGithubAsync()
    {
        CheckRequirements();
        SetStatus("正在读取 GitHub 最新发布信息…");
        using var releaseResponse = await _http.GetAsync(ReleaseApi);
        if (releaseResponse.StatusCode is System.Net.HttpStatusCode.Forbidden or System.Net.HttpStatusCode.TooManyRequests)
            throw new InvalidOperationException("GitHub API 请求受限，可能是共享代理节点被限流。可以切换网络，或直接使用内置离线安装功能。");
        releaseResponse.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await releaseResponse.Content.ReadAsStringAsync());
        var assets = document.RootElement.GetProperty("assets").EnumerateArray();
        var asset = assets.FirstOrDefault(item =>
            item.GetProperty("name").GetString() is string name &&
            name.StartsWith("FloatingCloud-v", StringComparison.OrdinalIgnoreCase) &&
            name.EndsWith(".plugin", StringComparison.OrdinalIgnoreCase));
        if (asset.ValueKind == JsonValueKind.Undefined)
            throw new InvalidOperationException("最新 Release 没有找到 FloatingCloud-v*.plugin，请先发布插件包，或使用本地安装。");

        var url = asset.GetProperty("browser_download_url").GetString() ?? "";
        if (!url.StartsWith(AllowedDownload, StringComparison.Ordinal))
            throw new InvalidOperationException("下载来源不是本项目的官方 GitHub Release，已取消操作。");
        var size = asset.GetProperty("size").GetInt64();
        if (size <= 0 || size > MaxPackageBytes)
            throw new InvalidOperationException("插件包大小超出安全限制。");

        var temp = Path.Combine(Path.GetTempPath(), "FloatingCloud-" + Guid.NewGuid().ToString("N") + ".plugin");
        try
        {
            SetStatus("正在下载插件包，请不要关闭程序…");
            using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();
            await using var source = await response.Content.ReadAsStreamAsync();
            await using (var target = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                var buffer = new byte[65536];
                long total = 0;
                int read;
                while ((read = await source.ReadAsync(buffer)) != 0)
                {
                    total += read;
                    if (total > MaxPackageBytes) throw new InvalidDataException("下载超过大小限制。");
                    await target.WriteAsync(buffer.AsMemory(0, read));
                }
            }
            InstallPlugin(temp);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }

    private Task InstallFromLocalAsync()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "选择 FloatingCloud 的 .plugin 插件包",
            Filter = "BetterNCM 插件|*.plugin",
            CheckFileExists = true
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return Task.CompletedTask;
        CheckRequirements();
        InstallPlugin(dialog.FileName);
        return Task.CompletedTask;
    }

    private void InstallPlugin(string file)
    {
        if (new FileInfo(file).Length is <= 0 or > MaxPackageBytes)
            throw new InvalidDataException("插件包为空或超过大小限制。");
        string version;
        using (var archive = ZipFile.OpenRead(file))
        {
            var manifest = archive.GetEntry("manifest.json")
                ?? throw new InvalidDataException("插件包缺少 manifest.json。");
            if (archive.GetEntry("native.dll") is null ||
                archive.GetEntry("FloatingCloudLyrics.exe") is null ||
                archive.GetEntry("main.js") is null || archive.GetEntry("desktop.html") is null)
                throw new InvalidDataException("插件包缺少完整的原生组件、歌词助手或桌面显示文件。");
            using var stream = manifest.Open();
            using var document = JsonDocument.Parse(stream);
            var root = document.RootElement;
            if (root.GetProperty("slug").GetString() != "floatingcloud-lite")
                throw new InvalidDataException("不是 FloatingCloud 插件包。");
            version = root.GetProperty("version").GetString() ?? "";
            if (!System.Text.RegularExpressions.Regex.IsMatch(version, @"^\d+\.\d+\.\d+$"))
                throw new InvalidDataException("插件包的版本号无效。");
        }
        var pluginDir = Path.Combine(_profile, "plugins");
        Directory.CreateDirectory(pluginDir);
        var filename = $"FloatingCloud-v{version}.plugin";
        var destination = Path.Combine(pluginDir, filename);
        var previous = Directory.GetFiles(pluginDir, "FloatingCloud-v*.plugin");
        // Avoid silently downgrading an installed version.
        var incoming = Version.Parse(version);
        var existingVersions = previous
            .Select(path => Path.GetFileNameWithoutExtension(path))
            .Select(name => name.StartsWith("FloatingCloud-v", StringComparison.OrdinalIgnoreCase)
                ? name["FloatingCloud-v".Length..] : "")
            .Select(text => Version.TryParse(text, out var parsed) ? parsed : null)
            .Where(v => v is not null)
            .ToList();
        if (existingVersions.Any(v => v!.CompareTo(incoming) > 0) &&
            MessageBox.Show(this, $"已安装的 FloatingCloud 版本高于 v{version}。是否仍要降级？",
                "确认降级", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
            return;

        var staging = Path.Combine(pluginDir, "." + Guid.NewGuid().ToString("N") + ".tmp");
        var backups = Path.Combine(_profile, "floatingcloud-backups");
        try
        {
            // Never delete an older package before the new package has been copied.
            File.Copy(file, staging, overwrite: false);
            if (previous.Length > 0)
            {
                Directory.CreateDirectory(backups);
                foreach (var old in previous)
                {
                    var unique = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + "-" +
                        Guid.NewGuid().ToString("N")[..6] + "-" + Path.GetFileName(old);
                    File.Copy(old, Path.Combine(backups, unique), overwrite: false);
                }
            }
            File.Move(staging, destination, overwrite: true);
            foreach (var old in previous)
                if (!string.Equals(old, destination, StringComparison.OrdinalIgnoreCase))
                    File.Delete(old);
        }
        finally { if (File.Exists(staging)) File.Delete(staging); }
        SetStatus($"已安装 FloatingCloud v{version}。重新启动网易云音乐后生效。");
        if (showCompletion)
            MessageBox.Show(this, $"FloatingCloud v{version} 已安装到 BetterNCM！\n\n重启网易云音乐后，在插件设置中开启桌面浮窗。", "安装成功", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void ShowThirdPartyLicenses()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("FloatingCloud.Setup.InfLinkLicense");
        if (stream is null) { OpenUrl("https://github.com/apoint123/inflink-rs/blob/main/LICENSE"); return; }
        using var reader = new StreamReader(stream);
        using var dialog = new Form
        {
            Text = "第三方组件许可 · InfLink-rs (GPL-3.0-only)",
            Size = new Size(690, 560), StartPosition = FormStartPosition.CenterParent
        };
        var licenseText = new TextBox
        {
            Multiline = true, ReadOnly = true, Dock = DockStyle.Fill,
            ScrollBars = ScrollBars.Vertical, Font = new Font("Consolas", 10),
            Text = "InfLink-rs by apoint123\\r\\nSource: https://github.com/apoint123/inflink-rs\\r\\n\\r\\n" + reader.ReadToEnd()
        };
        dialog.Controls.Add(licenseText);
        dialog.ShowDialog(this);
    }

    private static void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception e) { MessageBox.Show("打开浏览器失败：" + e.Message); }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _http.Dispose();
        base.Dispose(disposing);
    }
}
