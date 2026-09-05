const $ = (id) => document.getElementById(id);
let selectedChannel = null;

try { selectedChannel = JSON.parse(localStorage.getItem('ytpdf_channel') || 'null'); } catch {}
$('key').value = localStorage.getItem('youtube_api_key') || '';

function setStatus(text, type = '') {
  const el = $('status');
  el.className = 'status' + (type ? ' ' + type : '');
  el.innerHTML = text || '';
}
function working(text) { setStatus(`<span class="spinner"></span>${text}`); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function safeFileName(s) { return String(s || 'Transcript').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Transcript'; }
function normalizeUrl(s) {
  try {
    const u = new URL(s.trim());
    if (!/youtube\.com|youtu\.be/.test(u.hostname)) throw new Error();
    return u.toString();
  } catch { throw new Error('Paste a valid YouTube link.'); }
}
function getVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.split('/').filter(Boolean)[0] || 'video';
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const p = u.pathname.split('/').filter(Boolean), i = p.findIndex(x => ['shorts','embed','live'].includes(x));
    if (i >= 0 && p[i + 1]) return p[i + 1];
  } catch {}
  return 'video';
}
function fmtDate(s) { if (!s) return ''; try { return new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(s)); } catch { return ''; } }

function requireSearchKey() {
  const key = $('key').value.trim() || localStorage.getItem('youtube_api_key') || '';
  if (!key) {
    $('apiDetails').open = true;
    $('key').focus();
    setStatus('Add your free YouTube Data API key to use search.', 'error');
    throw new Error('API key required.');
  }
  return key;
}

async function apiJson(url, options = {}) {
  const r = await fetch(url, options);
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const msg = data?.error?.message || data?.message || data?.error || `API error ${r.status}`;
    throw new Error(typeof msg === 'string' ? msg : `API error ${r.status}`);
  }
  return data;
}
function ytSearchUrl(params = {}) {
  const q = new URLSearchParams({ part:'snippet', maxResults:'15', key:requireSearchKey(), ...params });
  return `https://www.googleapis.com/youtube/v3/search?${q.toString()}`;
}
function normalizeSearch(items = []) {
  return items.map(item => {
    const sn = item.snippet || {}, id = item.id || {};
    if (id.kind === 'youtube#video') return {
      type:'video', id:id.videoId, title:sn.title || 'Untitled',
      thumbnail:sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || '',
      uploadDate:sn.publishedAt || '', channel:{id:sn.channelId || '', name:sn.channelTitle || ''}
    };
    if (id.kind === 'youtube#channel') return {
      type:'channel', id:id.channelId, title:sn.channelTitle || sn.title || 'YouTube channel',
      thumbnail:sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || ''
    };
    return null;
  }).filter(Boolean);
}
function cleanSegments(content, exact = false) {
  const raw = Array.isArray(content) ? content.map(x => typeof x === 'string' ? x : (x.text || '')) : [String(content || '')];
  const lines = []; let prev = '';
  for (let t of raw) {
    t = t.replace(/\s+/g,' ').trim();
    if (!t) continue;
    if (!exact && /^\[(music|applause|laughter|silence|foreign)\]$/i.test(t)) continue;
    if (t === prev) continue;
    prev = t; lines.push(t);
  }
  if (exact) return lines.join('\n');
  let text = lines.join(' ').replace(/\s+([,.;!?])/g,'$1').replace(/([.!?])\s+/g,'$1\n\n');
  if (text.split('\n\n').length < 3 && text.length > 700) {
    const words = text.split(/\s+/), paras = [];
    for (let i = 0; i < words.length; i += 110) paras.push(words.slice(i, i + 110).join(' '));
    text = paras.join('\n\n');
  }
  return text.trim();
}

function makePdfBlob(title, channel, sourceUrl, transcript) {
  if (!window.jspdf) throw new Error('PDF library did not load.');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm',format:'a4',compress:true});
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
  const left = 18, right = 18, top = 20, bottom = 18, textW = pageW - left - right;
  let y = top;
  doc.setProperties({title,subject:'YouTube transcript',author:channel || '',creator:'YouTube → PDF'});
  doc.setFont('helvetica','bold'); doc.setFontSize(18);
  const titleLines = doc.splitTextToSize(title,textW); doc.text(titleLines,left,y); y += titleLines.length * 7 + 2;
  doc.setFont('helvetica','normal'); doc.setTextColor(100); doc.setFontSize(9);
  if (channel) { doc.text(channel,left,y); y += 5; }
  const urlLines = doc.splitTextToSize(sourceUrl,textW); doc.text(urlLines,left,y); y += urlLines.length * 4 + 8;
  doc.setTextColor(20); doc.setFontSize(11);
  for (const para of transcript.split(/\n{2,}/).map(x => x.trim()).filter(Boolean)) {
    for (const line of doc.splitTextToSize(para,textW)) {
      if (y > pageH - bottom) { doc.addPage(); y = top; }
      doc.text(line,left,y); y += 5.4;
    }
    y += 3.2;
  }
  return doc.output('blob');
}
function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
}

const DB_NAME='youtubePdfHistory', DB_VERSION=1, STORE='pdfs';
function openDb() {
  return new Promise((resolve,reject) => {
    const req = indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const st = db.createObjectStore(STORE,{keyPath:'id'}); st.createIndex('createdAt','createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function historyAll() {
  const db = await openDb();
  const items = await new Promise((res,rej) => { const r = db.transaction(STORE,'readonly').objectStore(STORE).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
  db.close(); return items.sort((a,b)=>b.createdAt-a.createdAt);
}
async function historyPut(item) {
  const db=await openDb(); await new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(item);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)}); db.close();
  const items=await historyAll(); for(const old of items.slice(30)) await historyDelete(old.id);
}
async function historyDelete(id) { const db=await openDb(); await new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)}); db.close(); }
async function historyClear() { const db=await openDb(); await new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();tx.oncomplete=res;tx.onerror=()=>rej(tx.error)}); db.close(); }
function historyDate(ms) { try { return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(ms)); } catch { return new Date(ms).toLocaleString(); } }
async function renderHistory() {
  const list = $('historyList');
  try {
    const items = await historyAll();
    if (!items.length) { list.innerHTML='<div class="empty">No PDFs yet.</div>'; return; }
    list.innerHTML = items.map(item => `<div class="history-item"><div class="history-title">${escapeHtml(item.title)}</div><div class="history-meta">${escapeHtml(historyDate(item.createdAt))}</div><div class="history-actions"><button class="history-download" data-download="${escapeHtml(item.id)}" type="button">Download again</button><button class="history-delete" data-delete="${escapeHtml(item.id)}" type="button">Delete</button></div></div>`).join('');
    list.querySelectorAll('[data-download]').forEach(btn => btn.onclick = async () => { const item=(await historyAll()).find(x=>x.id===btn.dataset.download); if(item?.blob) downloadBlob(item.blob,item.filename); });
    list.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = async () => { await historyDelete(btn.dataset.delete); await renderHistory(); });
  } catch { list.innerHTML='<div class="empty">History unavailable in this browser.</div>'; }
}

async function generatePdf(videoUrl, hint = {}) {
  const lang = $('lang').value.trim() || 'en';
  working('Getting captions…');
  const tr = await apiJson(`https://api.freetranscriptapi.com/v1/transcript?video_url=${encodeURIComponent(videoUrl)}&lang=${encodeURIComponent(lang)}`);
  if (!Array.isArray(tr.transcript) || !tr.transcript.length) throw new Error('No transcript was returned for this video.');
  working('Cleaning transcript…');
  const text = cleanSegments(tr.transcript, $('mode').value === 'exact');
  const videoId = getVideoId(videoUrl);
  const hintChannel = typeof hint.channel === 'string' ? hint.channel : (hint.channel?.name || hint.channel?.title || '');
  const title = String(tr.title || hint.title || `YouTube Transcript — ${videoId}`).trim();
  working(`Creating “${escapeHtml(title)}”…`);
  const blob = makePdfBlob(title,hintChannel,videoUrl,text);
  const filename = `${safeFileName(title)} - ${videoId}.pdf`;
  try { await historyPut({id:`${videoId}-${Date.now()}`,title,filename,createdAt:Date.now(),blob}); await renderHistory(); } catch {}
  downloadBlob(blob,filename);
  setStatus('PDF created and saved to History ✓','success');
}

async function busy(button, text, fn) {
  const original = button.textContent; button.disabled = true; button.textContent = text;
  try { return await fn(); } finally { button.disabled = false; button.textContent = original; }
}
function renderVideoResults(container, results) {
  if (!results.length) { container.innerHTML='<div class="empty">No videos found. Try another search.</div>'; return; }
  container.innerHTML = results.map((r,i)=>`<div class="result">${r.thumbnail?`<img class="thumb" src="${escapeHtml(r.thumbnail)}" alt="">`:'<div></div>'}<div><div class="rtitle">${escapeHtml(r.title)}</div><div class="rmeta">${escapeHtml([r.channel?.name,fmtDate(r.uploadDate)].filter(Boolean).join(' · '))}</div><button class="video-btn" data-vi="${i}" type="button">Make PDF</button></div></div>`).join('');
  container.querySelectorAll('[data-vi]').forEach(btn => btn.onclick = async () => {
    const r = results[Number(btn.dataset.vi)], url = `https://www.youtube.com/watch?v=${encodeURIComponent(r.id)}`;
    try { await busy(btn,'Creating PDF…',()=>generatePdf(url,{title:r.title,channel:r.channel})); } catch(e) { setStatus(e.message || 'Could not create PDF.','error'); }
  });
}

$('save').onclick = () => {
  const key = $('key').value.trim();
  if (!key) { setStatus('Paste a YouTube Data API key first.','error'); return; }
  localStorage.setItem('youtube_api_key',key);
  $('key').classList.add('saved'); $('save').textContent='Saved ✓'; setStatus('YouTube search key saved ✓','success');
  setTimeout(()=>{$('save').textContent='Save key';$('key').classList.remove('saved')},1600);
};
$('clearHistory').onclick = async () => { await historyClear(); await renderHistory(); setStatus('History cleared.','success'); };

function switchMain(which) {
  const url = which === 'url';
  $('urlTab').classList.toggle('active',url); $('searchTab').classList.toggle('active',!url);
  $('urlPane').classList.toggle('active',url); $('searchPane').classList.toggle('active',!url); setStatus('');
}
$('urlTab').onclick=()=>switchMain('url'); $('searchTab').onclick=()=>switchMain('search');
function switchSearch(which) {
  const videos = which === 'videos';
  $('videoSearchTab').classList.toggle('active',videos); $('channelSearchTab').classList.toggle('active',!videos);
  $('generalVideoSearch').classList.toggle('active',videos); $('channelSearchMode').classList.toggle('active',!videos); setStatus('');
}
$('videoSearchTab').onclick=()=>switchSearch('videos'); $('channelSearchTab').onclick=()=>switchSearch('channels');

$('go').onclick = async () => {
  try { const url=normalizeUrl($('url').value); await busy($('go'),'Creating PDF…',()=>generatePdf(url)); }
  catch(e) { setStatus(e.message || 'Could not create PDF.','error'); }
};
$('findGeneralVideos').onclick = async () => {
  const q=$('generalVideoQuery').value.trim(), box=$('generalVideoResults');
  if(!q){setStatus('Type a video title or topic first.','error');return;}
  try {
    box.innerHTML='<div class="loading-card"><span class="spinner"></span>Searching YouTube…</div>'; working('Searching YouTube videos…');
    await busy($('findGeneralVideos'),'Searching…',async()=>{
      const d=await apiJson(ytSearchUrl({q,type:'video',order:'relevance'}));
      const results=normalizeSearch(d.items||[]).filter(x=>x.type==='video'); renderVideoResults(box,results); setStatus(`${results.length} video${results.length===1?'':'s'} found.`,'success');
    });
  } catch(e) { box.innerHTML=''; if(e.message!=='API key required.') setStatus(e.message||'Search failed.','error'); }
};

function showSelectedChannel() {
  const picker=$('channelPicker'),browser=$('channelBrowser');
  if(!selectedChannel){picker.style.display='block';browser.style.display='none';return;}
  picker.style.display='none';browser.style.display='block';
  $('selectedChannel').innerHTML=`${selectedChannel.thumbnail?`<img class="avatar" src="${escapeHtml(selectedChannel.thumbnail)}" alt="">`:''}<div class="info"><div class="small">Selected channel</div><div class="name">${escapeHtml(selectedChannel.name)}</div></div><button id="changeChannel" class="change" type="button">Change</button>`;
  $('videoSearchLabel').textContent=`Search ${selectedChannel.name}`;
  $('changeChannel').onclick=()=>{selectedChannel=null;localStorage.removeItem('ytpdf_channel');$('channelResults').innerHTML='';$('videoResults').innerHTML='';showSelectedChannel();setStatus('');};
}
$('findChannel').onclick = async () => {
  const q=$('channelQuery').value.trim(),box=$('channelResults');
  if(!q){setStatus('Type a channel name first.','error');return;}
  try {
    box.innerHTML='<div class="loading-card"><span class="spinner"></span>Searching channels…</div>'; working('Searching channels…');
    await busy($('findChannel'),'Searching…',async()=>{
      const d=await apiJson(ytSearchUrl({q,type:'channel'})); const results=normalizeSearch(d.items||[]).filter(x=>x.type==='channel');
      if(!results.length){box.innerHTML='<div class="empty">No channels found.</div>';setStatus('No channels found.');return;}
      box.innerHTML=results.map((r,i)=>`<div class="result channel" data-ci="${i}">${r.thumbnail?`<img class="avatar" src="${escapeHtml(r.thumbnail)}" alt="">`:'<div></div>'}<div><div class="rtitle">${escapeHtml(r.title)}</div><div class="rmeta">YouTube channel</div></div><button class="pick" type="button">Select</button></div>`).join('');
      box.querySelectorAll('[data-ci]').forEach(el=>el.onclick=()=>{const r=results[Number(el.dataset.ci)];selectedChannel={id:r.id,name:r.title,thumbnail:r.thumbnail||''};localStorage.setItem('ytpdf_channel',JSON.stringify(selectedChannel));showSelectedChannel();setStatus(`Selected ${selectedChannel.name} ✓`,'success');});
      setStatus(`${results.length} channel${results.length===1?'':'s'} found.`,'success');
    });
  } catch(e) { box.innerHTML=''; if(e.message!=='API key required.') setStatus(e.message||'Search failed.','error'); }
};
$('findVideos').onclick = async () => {
  if(!selectedChannel)return;
  const term=$('videoQuery').value.trim(),box=$('videoResults');
  try {
    box.innerHTML=`<div class="loading-card"><span class="spinner"></span>Searching ${escapeHtml(selectedChannel.name)}…</div>`; working(`Searching ${escapeHtml(selectedChannel.name)}…`);
    await busy($('findVideos'),'Searching…',async()=>{
      const params={type:'video',channelId:selectedChannel.id,order:term?'relevance':'date'}; if(term)params.q=term;
      const d=await apiJson(ytSearchUrl(params)); const results=normalizeSearch(d.items||[]).filter(x=>x.type==='video'); renderVideoResults(box,results); setStatus(`${results.length} video${results.length===1?'':'s'} found in ${selectedChannel.name}.`,results.length?'success':'');
    });
  } catch(e) { box.innerHTML=''; if(e.message!=='API key required.') setStatus(e.message||'Search failed.','error'); }
};

$('generalVideoQuery').addEventListener('keydown',e=>{if(e.key==='Enter')$('findGeneralVideos').click()});
$('channelQuery').addEventListener('keydown',e=>{if(e.key==='Enter')$('findChannel').click()});
$('videoQuery').addEventListener('keydown',e=>{if(e.key==='Enter')$('findVideos').click()});

showSelectedChannel(); renderHistory();
