import { useEffect, useMemo, useState } from 'react';
import type { BlurayAnalysis, BlurayProgress, BlurayQuality, BlurayRecommendation, BlurayTitle, BlurayTranscodeSettings, ExternalSubtitle } from './shared/blurayTypes';
import { qualitySettings } from './shared/blurayRecommendations';

const qualityInfo: Record<BlurayQuality, [string, string]> = {
  archival: ['收藏级', 'CRF 16 · x265 slow，优先保留纹理与暗部细节'],
  high: ['高画质', 'CRF 18 · 体积与画质更均衡'], balanced: ['适度压缩', 'CRF 20 · 更小体积'],
  remux: ['无损封装', '不重编码视频，仅整理轨道与封装'],
};

export default function App() {
  const [analysis, setAnalysis] = useState<BlurayAnalysis>();
  const [selectedId, setSelectedId] = useState('');
  const [recommendation, setRecommendation] = useState<BlurayRecommendation>();
  const [settings, setSettings] = useState<BlurayTranscodeSettings>();
  const [progress, setProgress] = useState<BlurayProgress>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const title = useMemo(() => analysis?.titles.find((entry) => entry.id === selectedId), [analysis, selectedId]);

  useEffect(() => window.bluray.onQueueEvent((event) => { setProgress(event.progress); if (event.progress.status !== 'running') setBusy(false); }), []);
  useEffect(() => { void window.bluray.getSystemStatus().then((value) => { if (!value.ready) setError(value.error); }); }, []);

  const loadTitle = async (next: BlurayTitle) => {
    setSelectedId(next.id); const rec = await window.bluray.recommend(next); setRecommendation(rec);
    setSettings({ ...rec.settings, externalSubtitles: [], outputPath: '' }); setProgress(undefined);
  };
  const selectDisc = async () => {
    const path = await window.bluray.selectBdmvFolder(); if (!path) return;
    setBusy(true); setError(undefined); setAnalysis(undefined);
    try { const result = await window.bluray.analyzeBdmv(path); setAnalysis(result); await loadTitle(result.titles.find((t) => t.id === result.recommendedTitleId) ?? result.titles[0]); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const setQuality = (quality: BlurayQuality) => {
    if (!settings) return; const next = qualitySettings(quality);
    setSettings({ ...settings, quality, videoCodec: next.codec, crf: next.crf, preset: next.preset });
  };
  const addSubtitles = async () => {
    if (!settings) return; const paths = await window.bluray.selectSubtitleFiles();
    const additions: ExternalSubtitle[] = paths.map((path) => ({ path, name: fileName(path), language: inferLanguage(path), title: fileName(path).replace(/\.[^.]+$/, ''), default: false, forced: /forced/i.test(path) }));
    setSettings({ ...settings, externalSubtitles: [...settings.externalSubtitles, ...additions.filter((item) => !settings.externalSubtitles.some((old) => old.path === item.path))] });
  };
  const chooseOutput = async () => {
    if (!settings || !analysis) return; const path = await window.bluray.chooseOutputPath(`${analysis.discName}_收藏版.mkv`);
    if (path) setSettings({ ...settings, outputPath: path });
  };
  const start = async () => {
    if (!title || !settings) return; if (!settings.outputPath) { await chooseOutput(); return; }
    setBusy(true); setError(undefined); setProgress({ status: 'running', progress: 0, stage: '正在准备转码' });
    try { await window.bluray.startTranscode(title, settings); } catch (e) { setError(message(e)); setBusy(false); }
  };

  return <div className="app-shell">
    <header><div className="brand"><span className="disc">BD</span><div><b>TransLite Blu-ray</b><small>收藏级原盘优化工具 · Windows x64</small></div></div><span className="offline">本地离线处理</span></header>
    <main>
      <section className="hero"><div><span className="eyebrow">BLU-RAY ARCHIVE WORKFLOW</span><h1>保留光影与声音，<br/>精炼一张蓝光原盘</h1><p>自动识别主影片、HDR、杜比视界、无损音轨与原盘字幕，输出一个便于收藏的 MKV。</p></div><button className="primary" onClick={() => void selectDisc()} disabled={busy}>{busy && !progress ? '正在扫描播放列表…' : analysis ? '重新选择原盘' : '选择 BDMV 文件夹'}</button></section>
      {error && <div className="alert"><b>无法继续</b><span>{error}</span></div>}
      {!analysis && <section className="empty"><div className="folder">BDMV</div><h2>选择完整的蓝光文件夹</h2><p>需要包含 BDMV/PLAYLIST 与 BDMV/STREAM。工具会分析 MPLS 播放列表，而不是简单选择最大的 M2TS。</p><button className="secondary" onClick={() => void selectDisc()} disabled={busy}>浏览文件夹</button></section>}
      {analysis && title && settings && <>
        <section className="disc-summary"><div><span>原盘</span><strong>{analysis.discName}</strong><small>{analysis.playlistCount} 个播放列表 · 找到 {analysis.titles.length} 个有效标题</small></div><div className="stat"><span>推荐主影片</span><b>{formatTime(title.durationSeconds)}</b><small>{formatBytes(title.sizeBytes)} · {title.clips.length} 个片段</small></div><div className="stat"><span>画面</span><b>{title.video.width}×{title.video.height}</b><small>{formatHdr(title)} · {title.video.fps.toFixed(3)} fps</small></div></section>
        {[...analysis.warnings, ...title.warnings, ...(recommendation?.warnings ?? [])].map((warning, i) => <div className="warning" key={`${i}-${warning}`}>⚠ {warning}</div>)}
        <section className="workspace">
          <aside><h3>标题 / 播放列表</h3>{analysis.titles.slice(0, 30).map((item) => <button className={item.id === title.id ? 'title-item active' : 'title-item'} key={item.id} disabled={busy} onClick={() => void loadTitle(item)}><b>{item.playlistName}{item.id === analysis.recommendedTitleId && <em>推荐</em>}</b><span>{formatTime(item.durationSeconds)} · {formatBytes(item.sizeBytes)}</span>{item.duplicateOf && <small>与 {item.duplicateOf} 重复</small>}</button>)}</aside>
          <div className="editor">
            <Section title="源视频信息"><div className="facts"><Fact label="编码" value={`${title.video.codec.toUpperCase()} ${title.video.profile ?? ''}`}/><Fact label="色彩" value={`${title.video.colorPrimaries ?? '未知'} / ${title.video.colorTransfer ?? '未知'}`}/><Fact label="位深" value={`${title.video.bitDepth ?? '?'} bit · ${title.video.pixelFormat ?? ''}`}/><Fact label="章节" value={`${title.chaptersSeconds.length} 个`}/></div></Section>
            <Section title="收藏质量"><div className="quality-grid">{(Object.keys(qualityInfo) as BlurayQuality[]).map((id) => <button key={id} className={settings.quality === id ? 'quality active' : 'quality'} disabled={busy} onClick={() => setQuality(id)}><b>{qualityInfo[id][0]}</b><span>{qualityInfo[id][1]}</span></button>)}</div>{settings.videoCodec === 'hevc' && <label className="range">精细调整 CRF <input type="range" min="14" max="22" value={settings.crf} disabled={busy} onChange={(e) => setSettings({...settings, crf:Number(e.target.value)})}/><b>{settings.crf}</b><small>数值越低，画质越高、文件越大</small></label>}<p className="recommend">建议：{recommendation?.summary}</p></Section>
            <Section title={`音轨 · 已选 ${settings.audioStreamIndexes.length}/${title.audioTracks.length}`}><div className="tracks">{title.audioTracks.map((track) => <Track key={track.streamIndex} checked={settings.audioStreamIndexes.includes(track.streamIndex)} label={`${lang(track.language)} · ${track.codec.toUpperCase()} ${track.profile ?? ''}`} detail={`${track.channels ?? '?'} 声道${track.lossless ? ' · 无损' : ''}${track.atmos ? ' · Atmos' : ''}`} onChange={() => setSettings({...settings,audioStreamIndexes:toggle(settings.audioStreamIndexes,track.streamIndex)})}/>)}</div></Section>
            <Section title={`原盘字幕 · 已选 ${settings.subtitleStreamIndexes.length}/${title.subtitleTracks.length}`}><div className="tracks">{title.subtitleTracks.length ? title.subtitleTracks.map((track) => <Track key={track.streamIndex} checked={settings.subtitleStreamIndexes.includes(track.streamIndex)} label={`${lang(track.language)} · ${track.codec.toUpperCase()}`} detail={`${track.title ?? '原盘图形字幕'}${track.forced ? ' · 强制' : ''}`} onChange={() => setSettings({...settings,subtitleStreamIndexes:toggle(settings.subtitleStreamIndexes,track.streamIndex)})}/>) : <p className="muted">该标题未检测到内置字幕。</p>}</div></Section>
            <Section title="外部字幕"><button className="secondary compact" disabled={busy} onClick={() => void addSubtitles()}>＋ 添加 SRT / ASS / SUP</button>{settings.externalSubtitles.map((sub,index) => <div className="external" key={sub.path}><b>{sub.name}</b><input value={sub.language} aria-label="语言代码" onChange={(e)=>setSettings({...settings,externalSubtitles:settings.externalSubtitles.map((x,i)=>i===index?{...x,language:e.target.value}:x)})}/><label><input type="checkbox" checked={sub.default} onChange={(e)=>setSettings({...settings,externalSubtitles:settings.externalSubtitles.map((x,i)=>i===index?{...x,default:e.target.checked}:x)})}/> 默认</label><button onClick={()=>setSettings({...settings,externalSubtitles:settings.externalSubtitles.filter((_,i)=>i!==index)})}>移除</button></div>)}</Section>
            <Section title="输出文件"><div className="output"><code>{settings.outputPath || '尚未选择保存位置'}</code><button className="secondary compact" disabled={busy} onClick={() => void chooseOutput()}>选择位置</button></div></Section>
          </div>
        </section>
        {progress && <section className={`progress ${progress.status}`}><div><b>{progress.stage}</b><span>{Math.round(progress.progress*100)}%{progress.speed ? ` · ${progress.speed.toFixed(2)}x` : ''}{progress.etaSeconds ? ` · 剩余约 ${formatTime(progress.etaSeconds)}` : ''}</span></div><div className="bar"><i style={{width:`${progress.progress*100}%`}}/></div>{progress.error && <p>{progress.error}</p>}{progress.technicalLog && <details><summary>技术日志</summary><pre>{progress.technicalLog}</pre></details>}</section>}
        <footer><div><b>{settings.videoCodec === 'copy' ? '无损重新封装' : `HEVC 10-bit · CRF ${settings.crf} · ${settings.preset}`}</b><small>音轨与字幕直接复制，输出 Matroska MKV</small></div>{progress?.status === 'completed' && progress.outputPath ? <><button className="secondary" onClick={()=>void window.bluray.showInFolder(progress.outputPath!)}>打开所在文件夹</button><button className="primary" onClick={()=>void window.bluray.openOutput(progress.outputPath!)}>播放文件</button></> : busy ? <button className="danger" onClick={()=>void window.bluray.cancelTranscode()}>取消转码</button> : <button className="primary" disabled={!settings.outputPath} onClick={()=>void start()}>开始收藏级转码</button>}</footer>
      </>}
    </main>
  </div>;
}

function Section({title,children}:{title:string;children:React.ReactNode}) { return <section className="section"><h3>{title}</h3>{children}</section>; }
function Fact({label,value}:{label:string;value:string}) { return <div><span>{label}</span><b>{value}</b></div>; }
function Track({checked,label,detail,onChange}:{checked:boolean;label:string;detail:string;onChange:()=>void}) { return <label className="track"><input type="checkbox" checked={checked} onChange={onChange}/><span><b>{label}</b><small>{detail}</small></span></label>; }
function toggle(values:number[],value:number) { return values.includes(value)?values.filter((x)=>x!==value):[...values,value]; }
function message(e:unknown){return e instanceof Error?e.message:String(e)}
function fileName(path:string){return path.split(/[\\/]/).pop()??path}
function inferLanguage(path:string){const p=path.toLowerCase();return /\.eng\.|english/.test(p)?'eng':/\.jpn\.|japanese/.test(p)?'jpn':/\.cht\.|traditional/.test(p)?'zht':/\.chs\.|chinese|中文/.test(p)?'zho':'und'}
function lang(value:string){return ({eng:'英语',jpn:'日语',zho:'中文',chi:'中文',zht:'繁体中文',und:'未知语言'} as Record<string,string>)[value]??value}
function formatHdr(title:BlurayTitle){const h=title.video.hdrType;return h==='dolby-vision'?`Dolby Vision P${title.video.dolbyVisionProfile??'?'}`:h==='hdr10'?'HDR10':h==='hlg'?'HLG':h==='sdr'?'SDR':'HDR'}
function formatTime(s:number){const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=Math.round(s%60);return `${h?`${h}:`:''}${String(m).padStart(h?2:1,'0')}:${String(x).padStart(2,'0')}`}
function formatBytes(n:number){const g=n/1024**3;return g>=1?`${g.toFixed(1)} GB`:`${(n/1024**2).toFixed(0)} MB`}
