// Uses exactly TaskbarLyrics.Core v1.7.4 sources + Lyricify.Lyrics.Helper.
// No direct Netease calls: QQ Music / Kugou / LRCLIB only.
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using TaskbarLyrics.Core.Abstractions;
using TaskbarLyrics.Core.Models;
using TaskbarLyrics.Core.Services;

record Request(string TrackKey, string Title, string Artist, string Album, double DurationMs);
record WordResult(string text, double start, double duration);
record LineResult(double time, double duration, string text, string translation, WordResult[] words, string kind);
record Response(string trackKey, string provider, string kind, bool pureMusic, LineResult[] lines, string? error);

static class Program
{
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

    static async Task<Response> Lookup(Request q)
    {
        if (q.Title.Length is < 1 or > 300 || q.Artist.Length > 300 || q.Album.Length > 300)
            return new Response(q.TrackKey,"","none",false,[], "invalid metadata");
        var track = new TrackIdentity(q.TrackKey,q.Title,[q.Artist],q.Album,
            TimeSpan.FromMilliseconds(Math.Max(0,q.DurationMs)),"External",null,[]);
        var plan=LyricSearchPlanner.CreatePlan(track);
        ILyricSource[] providers = [new QqMusicLyricSource(),new KugouLyricSource(),new LrcLibLyricSource()];
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(12));
        var parser=new LyricifyPayloadParser();
        var decoder=new LyricifyPayloadDecoder();
        foreach (var provider in providers)
        {
            try {
                // Each provider keeps its native discovery and QRC/KRC decoder.
                var options=(await provider.SearchAsync(plan,timeout.Token))
                    .Where(c=>IsMatching(c,q))
                    .OrderBy(c=> Math.Abs(c.Duration.TotalMilliseconds-q.DurationMs))
                    .Take(3).ToArray();
                foreach(var candidate in options) {
                    try {
                        var raw=await provider.FetchAsync(candidate,timeout.Token);
                        if(raw is null)continue;
                        var decoded=raw.IsEncrypted && decoder.CanDecode(raw.Format)
                            ? await decoder.DecodeAsync(raw,timeout.Token)
                            : new DecodedLyricPayload(raw.ProviderId,raw.CandidateId,raw.Format,
                                raw.OriginalLyrics,raw.TranslationLyrics,raw.IsPureMusic,raw.Diagnostics);
                        if(decoded.IsPureMusic)
                            return new Response(q.TrackKey,provider.ProviderId.Value,"instrumental",true,[],null);
                        if(!parser.CanParse(decoded.Format))continue;
                        var parsed=await parser.ParseAsync(decoded,timeout.Token);
                        if(parsed.Lines.Count==0)continue;
                        if(parsed.TimingKind==LyricTimingKind.Unsynced)continue; // never invent timings
                        var lines=parsed.Lines.Where(x=>!x.IsInformationLine)
                            .Take(500)
                            .Select(line=>new LineResult(
                                line.StartTime.TotalMilliseconds,
                                line.EndTime is null?0:Math.Max(0,(line.EndTime.Value-line.StartTime).TotalMilliseconds),
                                line.Text,
                                line.Translation ?? string.Empty,
                                line.Segments.Select(seg=>new WordResult(seg.Text,
                                    seg.StartTime.TotalMilliseconds,
                                    (seg.EndTime-seg.StartTime).TotalMilliseconds)).ToArray(),
                                line.Segments.Count>0?"timed":"lrc"))
                            .ToArray();
                        if(lines.Length>0)
                            return new Response(q.TrackKey,provider.ProviderId.Value,
                                lines.Any(x=>x.words.Length>0)?"timed":"lrc",
                                false,lines,null);
                    }catch(OperationCanceledException){throw;}
                    catch(Exception){ /* one bad candidate shouldn't suppress other sources */ }
                }
            }catch(OperationCanceledException){break;}
            catch(Exception){ /* continue to fallback sources */ }
        }
        return new Response(q.TrackKey,"","none",false,[], "no verified timed lyrics");
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
            var result=await Lookup(q);
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
