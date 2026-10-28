using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace FloatingCloud.Setup;

// The setup runs per-user and never modifies BetterNCM's plugins_runtime or config.
// It only writes ZIP .plugin archives into a confirmed BetterNCM plugin folder.
internal sealed record Inspection(
    string? CloudMusicExe, string Version, bool Supported, bool IsX64,
    bool BetterNcmPresent, string? PluginDirectory, bool InfLinkPresent,
    bool FloatingCloudPresent, string? FloatingCloudVersion)
{
    public bool CanInstall => CloudMusicExe is not null && Supported && IsX64;
}

internal static class SetupEngine
{
    internal const string PluginFileName = "FloatingCloud.plugin";
    internal const string InfLinkFileName = "InfLink-rs.plugin";
    internal const string UpstreamInstallerUrl =
        "https://github.com/std-microblock/BetterNCM-Installer/releases/download/1.2.0/betterncm_installer.exe";
    internal const string InfLinkUrl =
        "https://github.com/apoint123/inflink-rs/releases/download/v3.4.0/InfLink-rs.plugin";
    private const long MaxPluginBytes = 120L * 1024 * 1024;
    private const long MaxExecutableBytes = 40L * 1024 * 1024;
    private static readonly HttpClient Client = new(new HttpClientHandler { AllowAutoRedirect = true })
    {
        Timeout = TimeSpan.FromSeconds(60)
    };
    private static readonly string LocalData =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FloatingCloud");
    internal static string? ManuallySelectedExe { get; set; }
    internal static string? ManuallySelectedPluginDir { get; set; }

    internal static Inspection Inspect()
    {
        var exe = FindCloudMusic();
        string version = "";
        bool supported = false, isX64 = false, installed = false;
        if(exe is not null)
        {
            try
            {
                version = FileVersionInfo.GetVersionInfo(exe).FileVersion ?? "";
                supported = Regex.IsMatch(version, @"^3\.1\.42(?:\.|$)");
                isX64 = Is64BitPe(exe);
                installed = File.Exists(Path.Combine(Path.GetDirectoryName(exe)!, "msimg32.dll"));
            }
            catch(Exception) { /* display diagnostics rather than assuming support */ }
        }
        var pluginDir = FindPluginDirectory(installed);
        var inf = pluginDir is not null && FindPlugins(pluginDir, "inflink").Count > 0;
        var fcPaths = pluginDir is null ? [] : FindPlugins(pluginDir, "fc");
        string? currentVersion = null;
        if(fcPaths.Count > 0)
        {
            try { currentVersion = ReadManifest(fcPaths[0]).Version; }
            catch { /* unreadable archive is not a positive installation */ }
        }
        return new Inspection(exe,version,supported,isX64,installed,pluginDir,inf,
            fcPaths.Count > 0,currentVersion);
    }

    private static string? FindCloudMusic()
    {
        if(IsCloudExe(ManuallySelectedExe))return Path.GetFullPath(ManuallySelectedExe!);
        var dirs = new List<string>();
        foreach(var process in Process.GetProcessesByName("cloudmusic"))
        {
            try { var path = process.MainModule?.FileName; if(IsCloudExe(path))return path; }
            catch { } finally { process.Dispose(); }
        }
        foreach(var root in new[]{Registry.CurrentUser,Registry.LocalMachine})
        foreach(var view in new[]{RegistryView.Registry64, RegistryView.Registry32})
        {
            try
            {
                using var baseKey = RegistryKey.OpenBaseKey(root == Registry.CurrentUser ?
                    RegistryHive.CurrentUser : RegistryHive.LocalMachine, view);
                using var uninstall = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall");
                if(uninstall is null)continue;
                foreach(var name in uninstall.GetSubKeyNames())
                {
                    using var entry = uninstall.OpenSubKey(name);
                    var label = entry?.GetValue("DisplayName") as string ?? "";
                    if(!label.Contains("网易云音乐",StringComparison.OrdinalIgnoreCase) &&
                       !label.Contains("NetEase CloudMusic",StringComparison.OrdinalIgnoreCase) &&
                       !label.Contains("Cloud Music",StringComparison.OrdinalIgnoreCase))continue;
                    if(entry?.GetValue("InstallLocation") is string loc)dirs.Add(loc);
                    if(entry?.GetValue("DisplayIcon") is string icon)
                    {
                        var raw=icon.Trim('"').Split(',')[0].Trim('"');
                        if(IsCloudExe(raw))return raw;
                        var directory=Path.GetDirectoryName(raw);
                        if(!string.IsNullOrWhiteSpace(directory))dirs.Add(directory);
                    }
                }
            }catch { /* no permission to inspect one registry view */ }
        }
        dirs.AddRange(new[]{
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"NetEase","CloudMusic"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"NetEase","CloudMusic"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","NetEase","CloudMusic"),
            @"C:\Program Files (x86)\NetEase\CloudMusic",
            @"C:\Program Files\NetEase\CloudMusic"
        });
        foreach(var dir in dirs.Where(d=>!string.IsNullOrWhiteSpace(d)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                var candidate=Path.Combine(dir,"cloudmusic.exe");
                if(IsCloudExe(candidate))return Path.GetFullPath(candidate);
            }catch { }
        }
        return null;
    }

    private static bool IsCloudExe(string? path) =>
        !string.IsNullOrWhiteSpace(path) &&
        string.Equals(Path.GetFileName(path),"cloudmusic.exe",StringComparison.OrdinalIgnoreCase) &&
        File.Exists(path);

    private static bool Is64BitPe(string exe)
    {
        using var stream=File.OpenRead(exe);
        using var reader=new BinaryReader(stream);
        if(stream.Length<256)return false;
        stream.Seek(0x3c,SeekOrigin.Begin);
        var header=reader.ReadInt32();
        if(header<=0||header+6>=stream.Length)return false;
        stream.Seek(header,SeekOrigin.Begin);
        return reader.ReadUInt32()==0x4550 && reader.ReadUInt16()==0x8664;
    }

    private static string? FindPluginDirectory(bool installed)
    {
        if(IsPluginDir(ManuallySelectedPluginDir))return ManuallySelectedPluginDir;
        var candidates=new[]{
            @"C:\betterncm\plugins",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"BetterNCM","plugins"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BetterNCM","plugins")
        };
        foreach(var path in candidates)
            if(Directory.Exists(path))return path;
        // If BetterNCM's known data root exists, it is safe to initialize
        // its plugins child folder on first setup. Otherwise prompt the user.
        if(installed && Directory.Exists(@"C:\betterncm"))
            return @"C:\betterncm\plugins";
        return null;
    }

    private static bool IsPluginDir(string? directory)
    {
        if(string.IsNullOrWhiteSpace(directory)||!Directory.Exists(directory))return false;
        try { return string.Equals(Path.GetFileName(Path.GetFullPath(directory).TrimEnd('\\')),
            "plugins",StringComparison.OrdinalIgnoreCase); }catch{return false;}
    }

    private static List<string> FindPlugins(string folder, string kind)
    {
        var hits=new List<string>();
        try
        {
            if(!Directory.Exists(folder))return hits;
            foreach(var file in Directory.EnumerateFiles(folder,"*.plugin",SearchOption.TopDirectoryOnly))
            {
                try
                {
                    var id=ReadManifest(file);
                    if(kind=="fc" && id.Slug=="floatingcloud-lite")hits.Add(file);
                    if(kind=="inflink" && id.Name.Equals("InfLink-rs",StringComparison.OrdinalIgnoreCase))hits.Add(file);
                }
                catch { /* do not touch unknown or damaged third-party files */ }
            }
        }catch { }
        return hits;
    }

    private sealed record PluginId(string Name,string Slug,string Version);
    private static PluginId ReadManifest(string path)
    {
        using var stream=File.OpenRead(path);
        return ReadManifest(stream);
    }
    private static PluginId ReadManifest(Stream stream)
    {
        using var zip=new ZipArchive(stream,ZipArchiveMode.Read,true);
        var entry=zip.GetEntry("manifest.json") ?? throw new InvalidDataException("缺少 manifest.json");
        if(entry.Length > 256*1024)throw new InvalidDataException("manifest.json 过大");
        using var jsonStream=entry.Open();
        using var doc=JsonDocument.Parse(jsonStream);
        var root=doc.RootElement;
        string Get(string name) => root.TryGetProperty(name,out var v) && v.ValueKind==JsonValueKind.String
            ? v.GetString()??"" : "";
        return new PluginId(Get("name"),Get("slug"),Get("version"));
    }

    private static void ValidatePayload(string archive,string expectedKind)
    {
        var id=ReadManifest(archive);
        if(expectedKind=="fc" && id.Slug!="floatingcloud-lite")
            throw new InvalidDataException("FC 文件校验失败：slug 不一致");
        if(expectedKind=="inflink" && !id.Name.Equals("InfLink-rs",StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("InfLink-rs 文件校验失败：插件名称不一致");
        using var zip=ZipFile.OpenRead(archive);
        if(expectedKind=="fc" && (zip.GetEntry("native.dll") is null ||
            zip.GetEntry("FloatingCloudLyrics.exe") is null ||
            zip.GetEntry("desktop.html") is null))
            throw new InvalidDataException("FC 插件包缺少 Native 或歌词模块");
        if(expectedKind=="inflink" && zip.GetEntry("backend.dll") is null)
            throw new InvalidDataException("InfLink-rs 插件包缺少 backend.dll");
    }

    private static async Task DownloadAsync(string url, string file,long maxBytes, CancellationToken ct)
    {
        using var request=new HttpRequestMessage(HttpMethod.Get,url);
        using var response=await Client.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,ct);
        response.EnsureSuccessStatusCode();
        if(response.RequestMessage?.RequestUri?.Scheme != Uri.UriSchemeHttps ||
           response.Content.Headers.ContentLength > maxBytes)
            throw new InvalidDataException("下载地址或大小不符合安全限制");
        await using var net=await response.Content.ReadAsStreamAsync(ct);
        await using var disk=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None,65536,true);
        var buffer=new byte[65536];
        long total=0;
        while(true)
        {
            int got=await net.ReadAsync(buffer,ct);
            if(got==0)break;
            total+=got;
            if(total>maxBytes)throw new InvalidDataException("文件超过大小限制");
            await disk.WriteAsync(buffer.AsMemory(0,got),ct);
        }
    }

    internal static async Task RunOfficialInstallerAsync(Action<string> report,CancellationToken ct)
    {
        Directory.CreateDirectory(LocalData);
        var temp=Path.Combine(Path.GetTempPath(),"FloatingCloud-BetterNCM-"+Guid.NewGuid().ToString("N")+".exe");
        try
        {
            report("从 BetterNCM 官方 GitHub Release 获取 Installer II…");
            await DownloadAsync(UpstreamInstallerUrl,temp,MaxExecutableBytes,ct);
            report("已下载上游 Installer II；将打开官方安装界面。");
            // The upstream program owns its install decisions and any UAC prompts.
            using var p=Process.Start(new ProcessStartInfo(temp){UseShellExecute=true});
            if(p is null)throw new InvalidOperationException("无法启动官方安装器");
            await p.WaitForExitAsync(ct);
        }
        finally { TryDelete(temp); }
    }

    internal static async Task EnsureCloudClosedAsync(Action<string> report,CancellationToken ct)
    {
        var processes=Process.GetProcessesByName("cloudmusic");
        if(processes.Length==0)return;
        report("正在请求网易云音乐正常退出…");
        foreach(var p in processes)
        {
            using(p)
            {
                try { if(!p.HasExited)p.CloseMainWindow(); }
                catch { }
            }
        }
        for(var t=0;t<80;t++)
        {
            ct.ThrowIfCancellationRequested();
            var stillRunning=Process.GetProcessesByName("cloudmusic");
            var count=stillRunning.Length;
            foreach(var p in stillRunning)p.Dispose();
            if(count==0)return;
            await Task.Delay(100,ct);
        }
        throw new IOException("网易云音乐仍在运行。请保存播放状态并手动完全退出后重试（不会强制结束进程）。");
    }

    internal static async Task InstallAsync(Inspection state,Action<string> report,CancellationToken ct)
    {
        if(!state.CanInstall)throw new InvalidOperationException(
            "需要 Windows x64 网易云音乐 3.1.42；请选择正确的客户端安装位置。");
        if(!state.BetterNcmPresent)throw new InvalidOperationException("请先完成官方 BetterNCM 安装。");
        var folder=state.PluginDirectory;
        if(!IsPluginDir(folder))
        {
            var knownDefault=string.Equals(folder,@"C:\betterncm\plugins",
                StringComparison.OrdinalIgnoreCase);
            if(knownDefault && Directory.Exists(@"C:\betterncm"))
                Directory.CreateDirectory(folder!);
        }
        if(!IsPluginDir(folder))throw new InvalidOperationException(
            "尚未识别 BetterNCM 插件目录。请先启动一次装有 BetterNCM 的网易云，或手动选择现有的 plugins 文件夹。");

        Directory.CreateDirectory(LocalData);
        var staging=Path.Combine(LocalData,"staging");
        Directory.CreateDirectory(staging);
        var transaction=Path.Combine(LocalData,"Backups",DateTime.Now.ToString("yyyyMMdd-HHmmss")+"-"+Guid.NewGuid().ToString("N")[..6]);
        Directory.CreateDirectory(transaction);
        var tempFc=Path.Combine(staging,Guid.NewGuid().ToString("N")+".part");
        var tempInf=Path.Combine(staging,Guid.NewGuid().ToString("N")+".part");
        var backups=new List<(string Original,string Saved)>();
        var deployed=new List<string>();
        try
        {
            report("读取内置 FloatingCloud 插件包…");
            await using(var output=new FileStream(tempFc,FileMode.CreateNew,FileAccess.Write,FileShare.None,65536,true))
            await using(var input=Assembly.GetExecutingAssembly().GetManifestResourceStream("FloatingCloud.Payload.plugin")
                ?? throw new InvalidOperationException("安装器缺少内置 FC 插件包"))
            {
                await input.CopyToAsync(output,ct);
            }
            ValidatePayload(tempFc,"fc");
            var requiredInf=FindPlugins(folder,"inflink").Count==0;
            if(requiredInf)
            {
                report("检测到未安装 InfLink-rs，正在下载官方 v3.4.0…");
                await DownloadAsync(InfLinkUrl,tempInf,MaxPluginBytes,ct);
                ValidatePayload(tempInf,"inflink");
            }
            else report("检测到 InfLink-rs，保留用户已有版本。");

            await EnsureCloudClosedAsync(report,ct);
            ct.ThrowIfCancellationRequested();
            // Resolve existing installations by manifest, not filename. Unknown
            // archives and plugins_dev are never touched.
            var old=FindPlugins(folder,"fc");
            if(requiredInf)old.AddRange(FindPlugins(folder,"inflink"));
            var fcTarget=Path.Combine(folder,PluginFileName);
            var infTarget=Path.Combine(folder,InfLinkFileName);
            foreach(var target in new[]{fcTarget,requiredInf?infTarget:null}.Where(x=>x is not null))
                if(File.Exists(target!) && !old.Contains(target!,StringComparer.OrdinalIgnoreCase))
                    throw new IOException("目标路径已有非目标插件文件，拒绝覆盖："+target);

            report("备份已有 FC 插件，准备原子替换…");
            foreach(var path in old)
            {
                var saved=Path.Combine(transaction,Path.GetFileName(path));
                // Distinct manifest-matched filenames should not collide.
                if(File.Exists(saved))throw new IOException("备份文件名冲突："+saved);
                File.Move(path,saved);
                backups.Add((path,saved));
            }
            File.Move(tempFc,fcTarget);
            deployed.Add(fcTarget);
            if(requiredInf)
            {
                File.Move(tempInf,infTarget);
                deployed.Add(infTarget);
            }
            report("安装完成：FC 和所需插件已部署到 "+folder);
            report("旧版本已备份至 "+transaction);
            report("请重新启动网易云音乐加载新插件。");
        }
        catch
        {
            foreach(var path in deployed)TryDelete(path);
            foreach(var (original,saved) in backups.AsEnumerable().Reverse())
            {
                try { if(!File.Exists(original)&&File.Exists(saved))File.Move(saved,original); }
                catch { report("恢复旧版失败，请查看备份："+saved); }
            }
            throw;
        }
        finally
        {
            TryDelete(tempFc);
            TryDelete(tempInf);
        }
    }

    private static void TryDelete(string path)
    {
        try { if(File.Exists(path))File.Delete(path); }catch { }
    }

    internal static int SelfTest()
    {
        try
        {
            using var resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("FloatingCloud.Payload.plugin")
                ?? throw new InvalidDataException("embedded payload missing");
            var id=ReadManifest(resource);
            if(id.Slug!="floatingcloud-lite")return 2;
            if(!Regex.IsMatch("3.1.42.123",@"^3\.1\.42(?:\.|$)"))return 3;
            if(Regex.IsMatch("3.1.43.0",@"^3\.1\.42(?:\.|$)"))return 4;
            if(Path.GetFileName(PluginFileName)!="FloatingCloud.plugin")return 5;
            Console.WriteLine("PASS: bundled FC manifest and supported version gating");
            return 0;
        }
        catch(Exception e) { Console.Error.WriteLine(e);return 1; }
    }
}
