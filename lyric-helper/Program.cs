// Uses exactly TaskbarLyrics.Core v1.7.4 sources + Lyricify.Lyrics.Helper.
// No Netease lyric calls. QQ/Kugou/LRCLIB online, TBL LocalLyricProvider offline.
using System.Text;
using System.Net.NetworkInformation;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using TaskbarLyrics.Core.Abstractions;
using TaskbarLyrics.Core.Models;
using TaskbarLyrics.Core.Services;

record Request(string TrackKey, string Title, string Artist, string Album, double DurationMs,
    string Mode = "online-first", string[]? LocalFolders = null, bool OfflineHint = false,
    long NcmId = 0, bool ChorusEnabled = false, bool ChorusOnly = false);
record ChorusSegment(double startMs, double endMs);
record WordResult(string text, double start, double duration);
record LineResult(double time, double duration, string text, string translation, WordResult[] words, string kind);
record Response(string trackKey, string provider, string kind, bool pureMusic, LineResult[] lines,
    string? error, ChorusSegment[]? chorus = null);

static class Program
{
    private static readonly HttpClient ChorusClient = new();
    // This optional NetEase endpoint returns explicit start/end milliseconds.
    // Never infer an end from a single marker or query on the NCM UI thread.
    static async Task<ChorusSegment[]> LookupChorus(Request q, CancellationToken token)
    {
        if(!q.ChorusEnabled || q.NcmId<=0 || q.DurationMs<=0 || q.OfflineHint ||
            q.Mode=="local-only")return [];
        try {
            var ids=Uri.EscapeDataString($"[{q.NcmId}]");
            var json=await ChorusClient.GetStringAsync(
                $"https://music.163.com/api/song/chorus?ids={ids}",token);
            using var doc=JsonDocument.Parse(json);
            var root=doc.RootElement;
            if(!root.TryGetProperty("code",out var code) || code.GetInt32()!=200 ||
                !root.TryGetProperty("chorus",out var entries) ||
                entries.ValueKind!=JsonValueKind.Array)return [];
            var result=new List<ChorusSegment>();
            foreach(var entry in entries.EnumerateArray().Take(12)) {
                if(!entry.TryGetProperty("id",out var songId) || songId.GetInt64()!=q.NcmId ||
                    !entry.TryGetProperty("startTime",out var startValue) ||
                    !entry.TryGetProperty("endTime",out var endValue))continue;
                var start=startValue.GetDouble();var end=endValue.GetDouble();
                if(double.IsFinite(start) && double.IsFinite(end) && start>=0 &&
                   end-start>=1000 && end-start<=120000 && end<=q.DurationMs+1000)
                    result.Add(new ChorusSegment(start,end));
            }
            return result.OrderBy(s=>s.startMs).ToArray();
        }catch(Exception e) when (e is HttpRequestException or OperationCanceledException or
            JsonException or InvalidOperationException or FormatException) { return []; }
    }
    private static string Norm(string? s) =>
        Regex.Replace((s ?? "").Normalize(NormalizationForm.FormKC).ToLowerInvariant(),
            @"[\p{P}\p{S}\s]", "");

    private static bool IsMatching(SourceTrackCandidate c, Request req)
    {
        var t = Norm(req.Title);
        if (t.Length == 0 || Norm(c.Title) != t) return false;
        var desired = Norm(req.Artist);
        var artists = c.Artists.Select(Norm).Where(v=>v.Length>0).ToArray();
        if (desired.Length>0 && !artists.Any(a=>a==desired || a.Contains(desired) || desired.Contains(a)))
            return false;
        if (req.DurationMs>1000 && c.Duration.TotalMilliseconds>0 &&
            Math.Abs(c.Duration.TotalMilliseconds-req.DurationMs)>5000) return false;
        return true;
    }

    // TBL LocalLyricProvider indexes only explicitly chosen music directories
    // plus the Windows Music known folder. No full-disk scanning.
    static string[] LocalRoots(Request q)
    {
        var candidates = (q.LocalFolders ?? []).Take(12).Concat([
            Environment.GetFolderPath(Environment.SpecialFolder.MyMusic)
        ]);
        var roots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(var raw in candidates)
        {
            if(string.IsNullOrWhiteSpace(raw) || raw.Length > 1024)continue;
            try {
                var path = Path.GetFullPath(Environment.ExpandEnvironmentVariables(raw.Trim().Trim('"')));
                if(Path.IsPathFullyQualified(path) && Directory.Exists(path))roots.Add(path);
            } catch(Exception e) when (e is ArgumentException or NotSupportedException or PathTooLongException) { }
        }
        return roots.ToArray();
    }
    static async Task<Response?> LookupLocal(Request q, CancellationToken token)
    {
        var roots=LocalRoots(q);
        if(roots.Length==0)return null;
        var track=new TrackInfo(q.TrackKey,q.Title,q.Artist,q.Album,"Local",
            TimeSpan.FromMilliseconds(Math.Max(0,q.DurationMs)));
        // Both the provider and its index are TBL v1.7.4 implementations.
        // The index populates asynchronously: polling avoids treating an
        // initially empty index snapshot as "no lyric file exists".
        using var provider=new LocalLyricProvider(roots);
        var timer=Stopwatch.StartNew();
        while(!token.IsCancellationRequested && timer.ElapsedMilliseconds<2800)
        {
            var doc=await provider.GetLyricsAsync(track,token);
            if(doc is { IsPureMusic:true })
                return new Response(q.TrackKey,"Local","instrumental",true,[],null);
            if(doc?.Lines is { Count: >0 } entries)
            {
                var ordered=entries.Where(line=>!string.IsNullOrWhiteSpace(line.Text))
                    .OrderBy(line=>line.Timestamp).Take(500).ToArray();
                var lines=ordered.Select((line,i)=>new LineResult(
                    line.Timestamp.TotalMilliseconds,
                    i+1<ordered.Length?Math.Max(0,(ordered[i+1].Timestamp-line.Timestamp).TotalMilliseconds):5000,
                    line.Text,line.Translation??string.Empty,
                    // TBL local provider estimates per-character positions for
                    // plain LRC! Do not label those guessed syllables as true
                    // word synchronization. Preserve real line timing only.
                    [],"lrc")).ToArray();
                if(lines.Length>0)return new Response(q.TrackKey,"Local","lrc",false,lines,null);
            }
            await Task.Delay(140,token);
        }
        return null;
    }
    static async Task<Response?> LookupOnline(Request q, CancellationToken token)
    {
        var track=new TrackIdentity(q.TrackKey,q.Title,[q.Artist],q.Album,
            TimeSpan.FromMilliseconds(Math.Max(0,q.DurationMs)),"External",null,[]);
        var plan=LyricSearchPlanner.CreatePlan(track);
        ILyricSource[] providers=[new QqMusicLyricSource(),new KugouLyricSource(),new LrcLibLyricSource()];
        async Task<Response?> TryProvider(ILyricSource provider)
        {
            var parser=new LyricifyPayloadParser();
            var decoder=new LyricifyPayloadDecoder();
            try {
                var candidates=(await provider.SearchAsync(plan,token))
                    .Where(c=>IsMatching(c,q))
                    .OrderBy(c=>Math.Abs(c.Duration.TotalMilliseconds-q.DurationMs))
                    .Take(3).ToArray();
                foreach(var candidate in candidates)
                {
                    try {
                        var raw=await provider.FetchAsync(candidate,token);
                        if(raw is null)continue;
                        var decoded=raw.IsEncrypted && decoder.CanDecode(raw.Format)
                            ? await decoder.DecodeAsync(raw,token)
                            : new DecodedLyricPayload(raw.ProviderId,raw.CandidateId,raw.Format,
                                raw.OriginalLyrics,raw.TranslationLyrics,raw.IsPureMusic,raw.Diagnostics);
                        if(decoded.IsPureMusic)
                            return new Response(q.TrackKey,provider.ProviderId.Value,"instrumental",true,[],null);
                        if(!parser.CanParse(decoded.Format))continue;
                        var parsed=await parser.ParseAsync(decoded,token);
                        if(parsed.Lines.Count==0||parsed.TimingKind==LyricTimingKind.Unsynced)continue;
                        var lines=parsed.Lines.Where(x=>!x.IsInformationLine)
                            .Take(500).Select(line=>new LineResult(
                                line.StartTime.TotalMilliseconds,
                                line.EndTime is null?0:Math.Max(0,(line.EndTime.Value-line.StartTime).TotalMilliseconds),
                                line.Text,line.Translation??string.Empty,
                                line.Segments.Select(seg=>new WordResult(seg.Text,
                                    seg.StartTime.TotalMilliseconds,
                                    (seg.EndTime-seg.StartTime).TotalMilliseconds)).ToArray(),
                                line.Segments.Count>0?"timed":"lrc")).ToArray();
                        if(lines.Length>0)return new Response(q.TrackKey,provider.ProviderId.Value,
                            lines.Any(l=>l.words.Length>0)?"timed":"lrc",false,lines,null);
                    }catch(OperationCanceledException){throw;}
                    catch(Exception){ }
                }
            }catch(OperationCanceledException){return null;}
            catch(Exception){ }
            return null;
        }
        // Search all TBL sources together so a slow endpoint does not hold up
        // a valid result from another source.
        var pending=providers.Select(TryProvider).ToList();
        while(pending.Count>0)
        {
            var completed=await Task.WhenAny(pending);
            pending.Remove(completed);
            var result=await completed;
            if(result is {pureMusic:true} or {lines.Length:>0})return result;
        }
        return null;
    }
    static async Task<Response> Lookup(Request q)
    {
        if(q.Title.Length is <1 or >300 || q.Artist.Length>300 || q.Album.Length>300 ||
            !double.IsFinite(q.DurationMs) || q.DurationMs<0 || q.DurationMs>86400000)
            return new Response(q.TrackKey,"","none",false,[],"invalid metadata");

        var mode=q.Mode is "online-first" or "local-first" or "local-only"
            ? q.Mode : "online-first";
        // Interface availability is only a hint. User-controlled local-only
        // remains deterministic on planes/trains even with a captive Wi-Fi.
        bool online=mode!="local-only" && !q.OfflineHint && NetworkInterface.GetIsNetworkAvailable();
        using var total=new CancellationTokenSource(TimeSpan.FromSeconds(11));
        Response? local=null, remote=null;
        if(mode=="local-first" || !online)
        {
            try {local=await LookupLocal(q,total.Token);}catch(OperationCanceledException){}
            if(local is {pureMusic:true})return local;
            if(local is {lines.Length:>0})return local;
        }
        if(online)
        {
            // Bound the *whole online chain*, not 8 s per provider. Online
            // failures must never block a train user's local files indefinitely.
            using var onlineTimeout=CancellationTokenSource.CreateLinkedTokenSource(total.Token);
            onlineTimeout.CancelAfter(TimeSpan.FromSeconds(7));
            try {remote=await LookupOnline(q,onlineTimeout.Token);}catch(OperationCanceledException){}
            if(remote is {pureMusic:true})return remote;
            if(remote is {lines.Length:>0})return remote;
        }
        if(local is null)
        {
            try {local=await LookupLocal(q,total.Token);}catch(OperationCanceledException){}
            if(local is {pureMusic:true})return local;
            if(local is {lines.Length:>0})return local;
        }
        return local??remote??new Response(q.TrackKey,"","none",false,[],
            online?"no verified online or local timed lyrics":"offline-no-local-lyrics");
    }

    public static async Task<int> Main(string[] args)
    {
        if(args.Length!=2)return 2;
        var output=args[1];
        try {
            // Input is base64-encoded JSON, not shell interpolated metadata.
            var input=Encoding.UTF8.GetString(Convert.FromBase64String(args[0]));
            var q=JsonSerializer.Deserialize<Request>(input,
                new JsonSerializerOptions{PropertyNameCaseInsensitive=true});
            if(q is null)return 3;
            using var chorusTimeout=new CancellationTokenSource(TimeSpan.FromSeconds(3));
            var result=q.ChorusOnly
                ? new Response(q.TrackKey,"","none",false,[],null,
                    await LookupChorus(q,chorusTimeout.Token))
                : await Lookup(q);
            await File.WriteAllTextAsync(output,JsonSerializer.Serialize(result),new UTF8Encoding(false));
            return 0;
        }catch(Exception e) {
            try {
                var response=new Response("","","none",false,[],e.GetType().Name);
                await File.WriteAllTextAsync(output,JsonSerializer.Serialize(response),new UTF8Encoding(false));
            }catch{ /* parent treats absent output as unavailable */ }
            return 1;
        }
    }
}
