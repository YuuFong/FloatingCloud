using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace FloatingCloud.Setup;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        // Used by CI without opening a graphical window.
        if(args.Contains("--selftest",StringComparer.OrdinalIgnoreCase))return SetupEngine.SelfTest();
        ApplicationConfiguration.Initialize();
        Application.Run(new SetupWindow());
        return 0;
    }
}

internal sealed class SetupWindow : Form
{
    private readonly Label header = new();
    private readonly Label client = new();
    private readonly Label framework = new();
    private readonly Label bridge = new();
    private readonly Label current = new();
    private readonly Label folder = new();
    private readonly TextBox log = new();
    private readonly Button install = new();
    private readonly Button locateClient = new();
    private readonly Button locatePlugins = new();
    private readonly Button refresh = new();
    private Inspection state = new(null,"",false,false,false,null,false,false,null);
    private bool installing;

    public SetupWindow()
    {
        Text="FloatingCloud · 一键安装器";
        ClientSize=new Size(590,560);
        MinimumSize=new Size(580,550);
        StartPosition=FormStartPosition.CenterScreen;
        Font=new Font("Microsoft YaHei UI",9.5f);
        BackColor=Color.FromArgb(247,249,253);
        ForeColor=Color.FromArgb(42,49,61);
        AutoScaleMode=AutoScaleMode.Font;
        var layout=new TableLayoutPanel
        {
            Dock=DockStyle.Fill,Padding=new Padding(22),ColumnCount=1,RowCount=11,
            BackColor=BackColor
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,55));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,34));
        for(int i=0;i<4;i++)layout.RowStyles.Add(new RowStyle(SizeType.Absolute,34));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,30));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,40));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,54));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,22));
        Controls.Add(layout);
        header.Text="☁ FloatingCloud Setup";
        header.Font=new Font("Microsoft YaHei UI",19,FontStyle.Bold);
        header.TextAlign=ContentAlignment.MiddleLeft;
        header.Dock=DockStyle.Fill;
        layout.Controls.Add(header,0,0);
        var subtitle=NewLabel("环境检查 · 安装 · 修复   |   v0.1.0 测试版",Color.FromArgb(111,118,133));
        layout.Controls.Add(subtitle,0,1);
        layout.Controls.Add(client,0,2);
        layout.Controls.Add(framework,0,3);
        layout.Controls.Add(bridge,0,4);
        layout.Controls.Add(current,0,5);
        foreach(var item in new[]{client,framework,bridge,current})
        {
            item.Dock=DockStyle.Fill;
            item.TextAlign=ContentAlignment.MiddleLeft;
            item.Font=new Font("Microsoft YaHei UI",10);
        }
        folder.Dock=DockStyle.Fill;
        folder.ForeColor=Color.FromArgb(99,108,124);
        folder.AutoEllipsis=true;
        folder.TextAlign=ContentAlignment.MiddleLeft;
        layout.Controls.Add(folder,0,6);

        var choose=new FlowLayoutPanel {Dock=DockStyle.Fill,FlowDirection=FlowDirection.LeftToRight};
        locateClient.Text="定位网易云";locatePlugins.Text="选择插件目录";refresh.Text="重新检查";
        foreach(var b in new[]{locateClient,locatePlugins,refresh})
        {
            b.AutoSize=true;b.Height=31;b.FlatStyle=FlatStyle.System;
            choose.Controls.Add(b);
        }
        layout.Controls.Add(choose,0,7);
        install.Text="一键安装 / 修复 FloatingCloud";
        install.Dock=DockStyle.Fill;
        install.BackColor=Color.FromArgb(73,108,205);
        install.ForeColor=Color.White;
        install.Font=new Font("Microsoft YaHei UI",11,FontStyle.Bold);
        install.FlatStyle=FlatStyle.Flat;
        install.FlatAppearance.BorderSize=0;
        layout.Controls.Add(install,0,8);
        log.Multiline=true;log.ScrollBars=ScrollBars.Vertical;log.ReadOnly=true;
        log.Dock=DockStyle.Fill;log.BackColor=Color.White;
        log.Font=new Font("Consolas",9);
        layout.Controls.Add(log,0,9);
        layout.Controls.Add(NewLabel(
            "安装包内置 FC；缺少依赖时使用上游官方来源。不会删除你的 FC 设置。",
            Color.FromArgb(110,117,130)),0,10);

        Shown+=(_,_)=>RefreshScan();
        refresh.Click+=(_,_)=>RefreshScan();
        locateClient.Click+=(_,_)=>SelectClient();
        locatePlugins.Click+=(_,_)=>SelectPluginFolder();
        install.Click+=async (_,_)=>await InstallClicked();
    }

    private static Label NewLabel(string text,Color color)=>new()
    {
        Text=text,ForeColor=color,Dock=DockStyle.Fill,
        TextAlign=ContentAlignment.MiddleLeft,AutoEllipsis=true
    };

    private void Append(string message)
    {
        if(InvokeRequired){BeginInvoke(()=>Append(message));return;}
        log.AppendText("["+DateTime.Now.ToString("HH:mm:ss")+"] "+message+Environment.NewLine);
    }

    private void RefreshScan()
    {
        if(installing)return;
        state=SetupEngine.Inspect();
        client.Text="网易云音乐：" + (state.CloudMusicExe is null ? "未找到（请定位客户端）"
            : state.Version+" · "+(state.Supported && state.IsX64?"兼容":"当前版本或架构不兼容"));
        framework.Text="BetterNCM II："+(state.BetterNcmPresent?"检测到注入 DLL":"未检测到，将调用官方安装器");
        bridge.Text="InfLink-rs："+(state.InfLinkPresent?"已找到（保留现有版本）":"未检测到，将安装官方 v3.4.0");
        current.Text="FloatingCloud："+(state.FloatingCloudPresent
            ?"已安装 "+(state.FloatingCloudVersion??"未知版本"):"未发现现有插件");
        folder.Text="BetterNCM 插件目录："+(state.PluginDirectory??"未识别，可手动选择");
        install.Enabled=state.CanInstall;
        install.Text=state.CanInstall?"一键安装 / 修复 FloatingCloud":"请先选择兼容的网易云 3.1.42 x64";
    }

    private void SelectClient()
    {
        using var dialog=new OpenFileDialog{
            Title="请选择网易云音乐 cloudmusic.exe",
            Filter="网易云音乐 (cloudmusic.exe)|cloudmusic.exe",
            CheckFileExists=true
        };
        if(dialog.ShowDialog(this)!=DialogResult.OK)return;
        SetupEngine.ManuallySelectedExe=dialog.FileName;
        RefreshScan();
    }

    private void SelectPluginFolder()
    {
        using var dialog=new FolderBrowserDialog{
            Description="选择 BetterNCM 的 plugins 文件夹（不是 plugins_runtime）",
            UseDescriptionForTitle=true
        };
        if(dialog.ShowDialog(this)!=DialogResult.OK)return;
        if(!dialog.SelectedPath.EndsWith(@"\plugins",StringComparison.OrdinalIgnoreCase))
        {
            MessageBox.Show(this,"请选择名称为 plugins 的目录，不要选择 plugins_runtime。","目录无效",
                MessageBoxButtons.OK,MessageBoxIcon.Warning);
            return;
        }
        SetupEngine.ManuallySelectedPluginDir=dialog.SelectedPath;
        RefreshScan();
    }

    private async Task InstallClicked()
    {
        if(installing)return;
        installing=true;
        install.Enabled=false;
        locateClient.Enabled=locatePlugins.Enabled=refresh.Enabled=false;
        var report=(Action<string>)Append;
        try
        {
            if(!state.CanInstall)throw new InvalidOperationException("网易云版本或架构不兼容");
            Append("准备检查并部署 FloatingCloud…");
            if(!state.BetterNcmPresent)
            {
                var permission=MessageBox.Show(this,
                    "没有检测到 BetterNCM 的注入 DLL。\n\n接下来将从官方 GitHub Release 下载并运行 BetterNCM Installer II。该上游程序可能有自己的交互界面和 Windows UAC 提示。\n\n要继续吗？",
                    "安装 BetterNCM 依赖",MessageBoxButtons.YesNo,MessageBoxIcon.Question);
                if(permission!=DialogResult.Yes){Append("用户取消了 BetterNCM 安装。");return;}
                await SetupEngine.EnsureCloudClosedAsync(report,CancellationToken.None);
                await SetupEngine.RunOfficialInstallerAsync(report,CancellationToken.None);
                state=SetupEngine.Inspect();
                if(!state.BetterNcmPresent)
                    throw new InvalidOperationException("官方 BetterNCM 安装尚未生效。请先完成它的安装，然后重新点击检测。");
            }
            if(state.PluginDirectory is null)
                throw new InvalidOperationException(
                    "当前无法确认 BetterNCM 插件目录。请先启动一次网易云完成 BetterNCM 初始化，或点击「选择插件目录」定位到现有 plugins 文件夹。");
            await SetupEngine.InstallAsync(state,report,CancellationToken.None);
            MessageBox.Show(this,"FloatingCloud 已部署完成！\n\n现在可以启动网易云音乐，进入 BetterNCM → FloatingCloud 打开桌面歌词。",
                "安装成功",MessageBoxButtons.OK,MessageBoxIcon.Information);
        }
        catch(Exception e)
        {
            Append("失败："+e.Message);
            MessageBox.Show(this,e.Message+"\n\n已有的 FC 插件会尽可能回滚，备份存放在用户本地 FloatingCloud 目录。",
                "未完成安装",MessageBoxButtons.OK,MessageBoxIcon.Warning);
        }
        finally
        {
            installing=false;
            locateClient.Enabled=locatePlugins.Enabled=refresh.Enabled=true;
            RefreshScan();
        }
    }
}
