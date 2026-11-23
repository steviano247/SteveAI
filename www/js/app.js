/* SteveAI app — powered by STEVEXA */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const C = window.CONFIG;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('sai_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sai_' + k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { localStorage.removeItem('sai_' + k); } catch (e) { } }
  };

  const SESS = {
    get(k, d) { try { const v = sessionStorage.getItem('sai_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem('sai_' + k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { sessionStorage.removeItem('sai_' + k); } catch (e) { } }
  };
  const keptToken = LS.get('token', null);
  const S = {
    keep: keptToken !== null,
    token: keptToken || SESS.get('token', null), user: keptToken ? LS.get('user', null) : SESS.get('user', null), cfg: LS.get('cfg', null),
    chats: LS.get('chats', []), cur: LS.get('cur', null), busy: false, plan: null, pendingPlan: LS.get('pending', null)
  };

  /* ---------------- helpers ---------------- */
  const isNative = () => !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  const plugin = n => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins[n]) || null;

  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms || 2400);
  }
  function modal(o) {
    $('#mIcon').textContent = o.icon || 'ℹ️'; $('#mTitle').textContent = o.title || ''; $('#mText').textContent = o.text || '';
    const b = $('#mBtns'); b.innerHTML = '';
    (o.buttons || [{ label: 'OK' }]).forEach(x => {
      const el = document.createElement('button'); el.className = 'btn ' + (x.cls || 'primary'); el.textContent = x.label;
      el.onclick = () => { closeModal(); x.fn && x.fn(); }; b.appendChild(el);
    });
    $('#modal').classList.add('on');
  }
  function closeModal() { $('#modal').classList.remove('on'); }
  function openExternal(url) {
    const B = plugin('Browser');
    if (B && B.open) { B.open({ url }).catch(() => window.open(url, '_blank')); } else window.open(url, '_blank');
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (_) { } t.remove(); }
    toast('Copied ✓');
  }
  function fmtLeft(ms) {
    const m = Math.max(1, Math.ceil(ms / 60000)); const h = Math.floor(m / 60);
    return h ? h + 'h ' + (m % 60) + 'm' : m + 'm';
  }
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function api(action, data) {
    if (!C.API_URL || C.API_URL.indexOf('PASTE_') === 0) throw new Error('App is not connected yet: set API_URL in www/js/config.js');
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 150000);
    try {
      const r = await fetch(C.API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action, token: S.token }, data || {})), signal: ctl.signal, redirect: 'follow'
      });
      return await r.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The request took too long. Please try again.');
      if (/not connected/.test(e.message)) throw e;
      throw new Error('Network problem. Check your internet and try again.');
    } finally { clearTimeout(to); }
  }

  /* ---------------- markdown ---------------- */
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-ext="1">$1</a>');
    return s;
  }
  function blocks(t) {
    const lines = t.split('\n'); let out = '', list = null, para = [];
    const flushP = () => { if (para.length) { out += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
    const flushL = () => { if (list) { out += '</' + list + '>'; list = null; } };
    for (const ln of lines) {
      let m;
      if (!ln.trim()) { flushP(); flushL(); continue; }
      if ((m = ln.match(/^(#{1,3})\s+(.*)/))) { flushP(); flushL(); out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; continue; }
      if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { flushP(); if (list !== 'ul') { flushL(); out += '<ul>'; list = 'ul'; } out += '<li>' + inline(m[1]) + '</li>'; continue; }
      if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (list !== 'ol') { flushL(); out += '<ol>'; list = 'ol'; } out += '<li>' + inline(m[1]) + '</li>'; continue; }
      if ((m = ln.match(/^>\s?(.*)/))) { flushP(); flushL(); out += '<blockquote>' + inline(m[1]) + '</blockquote>'; continue; }
      flushL(); para.push(ln);
    }
    flushP(); flushL(); return out;
  }
  function md(src) {
    const parts = String(src).split('```'); let h = '';
    parts.forEach((p, i) => {
      if (i % 2) {
        const nl = p.indexOf('\n'); let lang = '', code = p;
        if (nl > -1) { lang = p.slice(0, nl).trim(); code = p.slice(nl + 1); }
        h += `<div class="code"><div class="code-h"><span>${esc(lang || 'code')}</span><button data-copy>Copy</button></div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`;
      } else h += blocks(p);
    });
    return h;
  }

  /* ---------------- screens ---------------- */
  function show(id) {
    ['intro', 'auth', 'chat'].forEach(x => $('#' + x).classList.toggle('hidden', x !== id));
  }
  function overlayOpen(id) { $('#' + id).classList.add('on'); if (id !== 'upgrade') { } updateScrim(); }
  function overlayClose(id) { $('#' + id).classList.remove('on'); updateScrim(); }
  function updateScrim() { $('#scrim').classList.toggle('on', $('#drawer').classList.contains('on')); }
  function topOverlay() {
    for (const id of ['modal', 'upgrade', 'settings', 'drawer']) if ($('#' + id).classList.contains('on')) return id;
    return null;
  }
  function closeTop() {
    if (!$('#attMenu').classList.contains('hidden')) { closeAttMenu(); return true; }
    const t = topOverlay(); if (!t) return false;
    if (t === 'modal') closeModal(); else overlayClose(t); return true;
  }

  /* ---------------- splash (5s) ---------------- */
  function startSplash() {
    const sp = $('#splash'); const t0 = Date.now();
    sp.classList.add('run');
    const done = () => {
      const wait = Math.max(0, C.SPLASH_MS - (Date.now() - t0));
      setTimeout(() => { sp.classList.add('out'); setTimeout(() => sp.remove(), 700); route(); }, wait);
    };
    done();
  }

  async function route() {
    if (S.token && S.user) {
      show('chat'); initChat();
      refreshMe(true); autoUpdateCheck();
    } else if (!LS.get('intro', false)) { show('intro'); }
    else { show('auth'); }
  }

  /* ---------------- intro ---------------- */
  let slide = 0;
  function setSlide(n) {
    slide = n; $$('.slide').forEach((s, i) => s.classList.toggle('on', i === n));
    $$('.dots i').forEach((d, i) => d.classList.toggle('on', i === n));
    $('#introNext').textContent = n === 2 ? 'Get started' : 'Next';
  }
  $('#introNext').onclick = () => { if (slide < 2) setSlide(slide + 1); else { LS.set('intro', true); show('auth'); } };
  $('#introSkip').onclick = () => { LS.set('intro', true); show('auth'); };

  /* ---------------- auth ---------------- */
  function tab(up) {
    $('#tabUp').classList.toggle('on', up); $('#tabIn').classList.toggle('on', !up);
    $('#formUp').classList.toggle('hidden', !up); $('#formIn').classList.toggle('hidden', up);
    $('#authSub').textContent = up ? 'Create your free account in seconds' : 'Welcome back — log in to continue';
  }
  $('#tabUp').onclick = () => tab(true); $('#tabIn').onclick = () => tab(false);
  $$('[data-eye]').forEach(b => b.onclick = () => { const i = b.parentElement.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; });

  function busyBtn(btn, on, label) {
    btn.disabled = on; btn.innerHTML = on ? '<span class="spin"></span> Please wait…' : label;
  }
  function saveAuth() {
    if (!S.token) return;
    const st = S.keep ? LS : SESS, other = S.keep ? SESS : LS;
    st.set('token', S.token); st.set('user', S.user); other.del('token'); other.del('user');
  }
  async function authDone(r, keep) {
    S.token = r.token; S.user = r.user; S.keep = keep; saveAuth();
    if (r.config) { S.cfg = r.config; LS.set('cfg', S.cfg); }
    show('chat'); initChat(); refreshMe(true); autoUpdateCheck();
  }
  $('#formUp').onsubmit = async e => {
    e.preventDefault(); const err = $('#errUp'); err.textContent = '';
    const email = $('#suEmail').value.trim().toLowerCase(), username = $('#suUser').value.trim(), password = $('#suPass').value;
    if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(email)) return err.textContent = 'Please enter a valid Gmail address (name@gmail.com).';
    if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) return err.textContent = 'Username: 3–20 letters, numbers, . - or _';
    if (password.length < 6) return err.textContent = 'Password must be at least 6 characters.';
    busyBtn($('#btnUp'), true);
    try {
      const r = await api('signup', { email, username, password, invite: $('#suInv').value.trim(), keep: $('#suKeep').checked });
      if (!r.ok) err.textContent = r.error || 'Could not sign up.'; else await authDone(r, $('#suKeep').checked);
    } catch (x) { err.textContent = x.message; }
    busyBtn($('#btnUp'), false, 'Create free account');
  };
  $('#formIn').onsubmit = async e => {
    e.preventDefault(); const err = $('#errIn'); err.textContent = '';
    const id = $('#liId').value.trim(), password = $('#liPass').value;
    if (!id || !password) return err.textContent = 'Enter your Gmail/username and password.';
    busyBtn($('#btnIn'), true);
    try {
      const r = await api('login', { id, password, keep: $('#liKeep').checked });
      if (!r.ok) err.textContent = r.error || 'Could not log in.'; else await authDone(r, $('#liKeep').checked);
    } catch (x) { err.textContent = x.message; }
    busyBtn($('#btnIn'), false, 'Log in');
  };

  async function refreshMe(silent) {
    try {
      const r = await api('me');
      if (r.ok) {
        S.user = r.user; saveAuth(); if (r.config) { S.cfg = r.config; LS.set('cfg', S.cfg); }
        if (S.user.plan !== 'free' && S.pendingPlan) { S.pendingPlan = null; LS.del('pending'); }
        paintUser(); if (!silent) toast('Plan synced ✓'); return true;
      }
      if (r.error === 'SESSION') { logout(true); modal({ icon: '🔐', title: 'Session expired', text: 'Please log in again.' }); }
    } catch (e) { if (!silent) toast(e.message); }
    return false;
  }
  function logout(quiet) {
    if (!quiet && S.token) api('logout').catch(() => { });
    S.token = null; S.user = null; LS.del('token'); LS.del('user'); SESS.del('token'); SESS.del('user');
    pend = []; renderAtts(); closeAll(); show('auth'); tab(false);
  }
  function closeAll() { ['settings', 'upgrade', 'drawer'].forEach(id => $('#' + id).classList.remove('on')); updateScrim(); }

  /* ---------------- usage ---------------- */
  function usage() {
    const u = S.user || {}; let used = u.used || 0;
    if (u.resetAt && Date.now() >= u.resetAt) { used = 0; }
    const limit = u.limit || 5; return { used, limit, left: Math.max(0, limit - used), resetAt: used ? u.resetAt : null, plan: u.plan || 'free' };
  }
  function paintUser() {
    const u = S.user; if (!u) return; const q = usage();
    const pill = $('#pill'); $('#pillTxt').textContent = q.left + ' left';
    pill.className = 'pill' + (q.plan === 'pro' ? ' pro' : '') + (q.left === 0 ? ' low' : '');
    const initial = (u.username || 'S')[0].toUpperCase();
    $('#dAv').textContent = initial; $('#sAv').textContent = initial; $('#dName').textContent = u.username;
    $('#sName').textContent = u.username; $('#sMail').textContent = u.email;
    const name = q.plan === 'pro' ? 'Pro' : q.plan === 'go' ? 'Go' : 'Free';
    $('#dPlan').textContent = name + ' plan'; const b = $('#sBadge'); b.textContent = name; b.className = 'badge ' + q.plan;
    $('#sBar').style.width = Math.min(100, (q.used / q.limit) * 100) + '%';
    let t = q.used + ' of ' + q.limit + ' prompts used';
    if (q.resetAt) t += ' · resets in ' + fmtLeft(q.resetAt - Date.now());
    if (u.planExpiry) t += ' · plan valid until ' + new Date(u.planExpiry).toLocaleDateString();
    $('#sUse').textContent = t;
    $('#sInvite').textContent = u.inviteCode || '–'; $('#sVer').textContent = 'Version ' + C.APP_VERSION;
    $('#btnUpgrade').textContent = q.plan === 'free' ? '⭐ Upgrade plan' : '⭐ Manage / renew plan';
  }
  setInterval(() => { if (S.user && !$('#chat').classList.contains('hidden')) paintUser(); }, 30000);

  /* ---------------- chat ---------------- */
  const STARTERS = [
    ['💬', 'Smart Chat', 'Ask me anything', 'linear-gradient(135deg,#1e90ff,#2b57ff)', 'Hi SteveAI! Tell me something interesting I probably do not know.'],
    ['⌨️', 'Code Assistant', 'Write & debug code', 'linear-gradient(135deg,#a24bff,#6a2cff)', 'Help me write a clean JavaScript function that debounces another function, and explain how it works.'],
    ['📈', 'Data & Analysis', 'Insights & numbers', 'linear-gradient(135deg,#27d17f,#0a9b5a)', 'Explain how to analyse a sales dataset step by step: what to clean, what to calculate and which charts to make.'],
    ['🎨', 'Image Studio', 'Create images from words', 'linear-gradient(135deg,#ffb41f,#ff7a00)', 'Generate an image of a futuristic Lagos skyline at sunset, ultra detailed, cinematic lighting'],
    ['🌐', 'Web & Research', 'Summaries & facts', 'linear-gradient(135deg,#2aa8ff,#1b63ff)', 'Create a clear beginner roadmap for learning IoT and embedded systems, with free resources.'],
    ['🚀', 'Task Automation', 'Plans & workflows', 'linear-gradient(135deg,#34d36b,#0aa04f)', 'Help me automate a weekly report using Google Sheets and Apps Script. Give the steps and code.']
  ];
  function curChat() { return S.chats.find(c => c.id === S.cur) || null; }
  /* generated pictures are kept only for the newest few so the phone's storage never fills up */
  function pruneImgs(keep) {
    let n = 0;
    S.chats.forEach(c => c.messages.forEach(m => { if (m.img) { n++; } }));
    let drop = Math.max(0, n - keep);
    for (let i = S.chats.length - 1; i >= 0 && drop > 0; i--) {
      const ms = S.chats[i].messages;
      for (let j = 0; j < ms.length && drop > 0; j++) if (ms[j].img) { delete ms[j].img; ms[j].imgGone = true; drop--; }
    }
  }
  /* text pulled out of attached documents is kept only for the newest few, same idea as pictures */
  function pruneDocs(keep) {
    let n = 0; S.chats.forEach(c => c.messages.forEach(m => { if (m.docs && m.docs.length) n++; }));
    let drop = Math.max(0, n - keep);
    for (let i = S.chats.length - 1; i >= 0 && drop > 0; i--) {
      const ms = S.chats[i].messages;
      for (let j = 0; j < ms.length && drop > 0; j++) if (ms[j].docs && ms[j].docs.length) { ms[j].docs = ms[j].docs.map(d => ({ name: d.name, text: '(contents no longer stored on this device)' })); drop--; }
    }
  }
  function saveChats() {
    S.chats = S.chats.slice(0, 40); pruneImgs(6); pruneDocs(5);
    try { localStorage.setItem('sai_chats', JSON.stringify(S.chats)); }
    catch (e) { pruneImgs(0); pruneDocs(0); try { localStorage.setItem('sai_chats', JSON.stringify(S.chats)); } catch (_) { } }
    LS.set('cur', S.cur);
  }
  const IMG_RE = /^\/(image|imagine|img|draw)\b|\b(generate|create|make|draw|design|paint|illustrate|render|produce|sketch|imagine|give me|show me|i want|i need|get me)\b[^.?!\n]{0,80}?\b(images?|pictures?|photos?|pics?|illustrations?|logos?|posters?|wallpapers?|artworks?|drawings?|paintings?|icons?|banners?|flyers?|thumbnails?|avatars?|portraits?|stickers?|cartoons?|mockups?|memes?|graphics?)\b|^\s*(please\s+)?(draw|sketch|paint|illustrate|imagine)\b/i;
  const looksLikeImage = t => IMG_RE.test(t) && !/\b(code|script|python|javascript|function|program|snippet)\b/i.test(t) || /^\/(image|imagine|img|draw)\b/i.test(t);
  function shrinkImg(src, max, q) {
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        try {
          const k = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
          const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', q));
        } catch (e) { res(src); }
      };
      im.onerror = () => res(src); im.src = src;
    });
  }
  async function saveImage(src) {
    const name = 'SteveAI-' + Date.now() + '.jpg';
    const FS = plugin('Filesystem'), SH = plugin('Share');
    try {
      if (FS && SH) {
        const w = await FS.writeFile({ path: name, data: src.split(',')[1], directory: 'CACHE' });
        await SH.share({ title: 'SteveAI image', url: w.uri, dialogTitle: 'Save or share image' });
        return;
      }
      const blob = await (await fetch(src)).blob(); const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'SteveAI image' }); return; }
      const a = document.createElement('a'); a.href = src; a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Saved ✓');
    } catch (e) { if (e && e.name === 'AbortError') return; toast('Could not save the image'); }
  }
  function newChat() { S.cur = null; saveChats(); renderMsgs(); renderHist(); }
  function initChat() { paintUser(); if (!curChat()) S.cur = null; renderMsgs(); renderHist(); }

  function renderEmpty() {
    const name = S.user ? S.user.username : '';
    const el = document.createElement('div'); el.className = 'empty';
    el.innerHTML = `<img src="assets/robot.png" alt=""><h2>Hi ${esc(name)} 👋</h2><p>Think • Ask • Create • Achieve</p><div class="chips"></div>`;
    const grid = $('.chips', el);
    STARTERS.forEach(s => {
      const b = document.createElement('button'); b.className = 'chip';
      b.innerHTML = `<span class="t" style="background:${s[3]}">${s[0]}</span><span><b>${s[1]}</b><small>${s[2]}</small></span>`;
      b.onclick = () => { $('#inp').value = s[4]; autoGrow(); $('#inp').focus(); };
      grid.appendChild(b);
    });
    return el;
  }
  function msgEl(m) {
    const d = document.createElement('div');
    if (m.role === 'user') {
      d.className = 'm u'; const b = document.createElement('div'); b.className = 'b';
      if (m.files && m.files.length) {
        const w = document.createElement('div'); w.className = 'ufiles';
        m.files.forEach(f => {
          if (f.thumb) { const im = document.createElement('img'); im.src = f.thumb; im.alt = f.name; w.appendChild(im); }
          else { const c = document.createElement('div'); c.className = 'ufile'; c.innerHTML = '<i>' + fileIcon(f.kind) + '</i><span></span>'; c.lastChild.textContent = f.name; w.appendChild(c); }
        });
        b.appendChild(w);
      }
      if (m.text) { const t = document.createElement('div'); t.textContent = m.text; b.appendChild(t); }
      d.appendChild(b);
    }
    else {
      d.className = 'm a';
      const pic = m.img ? `<div class="gen"><img src="${m.img}" alt="Generated image"><div class="genacts"><button data-saveimg>⬇ Save / Share</button></div></div>` : (m.imgGone ? '<div class="genold">🖼️ Image not stored on this device</div>' : '');
      d.innerHTML = `<img class="av" src="assets/robot.png" alt=""><div class="col"><div class="b">${pic}${md(m.text)}</div><div class="acts"><button data-copymsg>⧉ Copy</button></div></div>`;
      d._text = m.text;
    }
    return d;
  }
  function renderMsgs() {
    const box = $('#msgs'); box.innerHTML = '';
    const c = curChat();
    if (!c || !c.messages.length) box.appendChild(renderEmpty());
    else c.messages.forEach(m => box.appendChild(msgEl(m)));
    box.scrollTop = box.scrollHeight;
  }
  function renderHist() {
    const h = $('#hist'); h.innerHTML = '';
    if (!S.chats.length) { h.innerHTML = '<div class="mut" style="padding:12px;font-size:14px">No chats yet.</div>'; return; }
    S.chats.forEach(c => {
      const d = document.createElement('div'); d.className = 'h' + (c.id === S.cur ? ' on' : '');
      d.innerHTML = '<span></span><button aria-label="Delete">🗑</button>'; d.firstChild.textContent = c.title;
      d.firstChild.onclick = () => { S.cur = c.id; saveChats(); renderMsgs(); renderHist(); overlayClose('drawer'); };
      d.lastChild.onclick = ev => { ev.stopPropagation(); S.chats = S.chats.filter(x => x.id !== c.id); if (S.cur === c.id) S.cur = null; saveChats(); renderMsgs(); renderHist(); };
      h.appendChild(d);
    });
  }
  function autoGrow() { const t = $('#inp'); t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; }
  $('#inp').addEventListener('input', autoGrow);

  function typingEl(img) {
    const d = document.createElement('div'); d.className = 'm a'; d.id = 'typing';
    d.innerHTML = `<img class="av" src="assets/robot.png" alt=""><div class="col"><div class="typing"><div class="d"><i></i><i></i><i></i></div><span id="tlabel">${img ? 'Creating your image… 🎨' : 'SteveAI is thinking…'}</span></div></div>`;
    const labels = img ? ['Creating your image… 🎨', 'Adding the details…', 'Polishing the final look…', 'Almost ready…'] : ['SteveAI is thinking…', 'Working on your answer…', 'Almost there…']; let i = 0;
    d._iv = setInterval(() => { i = (i + 1) % labels.length; const l = $('#tlabel'); if (l) l.textContent = labels[i]; }, 3500);
    return d;
  }
  function addNotice(html) {
    const box = $('#msgs'); const n = document.createElement('div'); n.innerHTML = html; const el = n.firstElementChild; box.appendChild(el);
    box.scrollTop = box.scrollHeight; return el;
  }

  async function send() {
    if (S.busy) return;
    if (loading) { toast('Still reading your file…'); return; }
    const inp = $('#inp'); const text = inp.value.trim();
    const sent = pend.slice(); if (!text && !sent.length) return;
    const q = usage();
    let c = curChat();
    if (!c) { c = { id: uid(), title: (text || sent[0].name).slice(0, 38), ts: Date.now(), messages: [] }; S.chats.unshift(c); S.cur = c.id; }
    $$('.notice').forEach(n => n.remove());
    const um = { role: 'user', text };
    if (sent.length) {
      um.files = sent.map(a => ({ name: a.name, kind: a.kind, thumb: a.thumb || null }));
      const docs = sent.filter(a => a.kind === 'doc').map(a => ({ name: a.name, text: a.text })); if (docs.length) um.docs = docs;
    }
    const wire = sent.filter(a => a.kind === 'image' || a.kind === 'pdf').map(a => ({ name: a.name, mime: a.mime, data: a.data }));
    c.messages.push(um); saveChats();
    inp.value = ''; autoGrow(); pend = []; renderAtts(); closeAttMenu();
    const box = $('#msgs'); if ($('.empty', box)) box.innerHTML = '';
    box.appendChild(msgEl(um));
    const ty = typingEl(!sent.length && looksLikeImage(text)); box.appendChild(ty); box.scrollTop = box.scrollHeight;
    S.busy = true; $('#btnSend').disabled = true; renderHist();

    const stop = () => { clearInterval(ty._iv); ty.remove(); S.busy = false; $('#btnSend').disabled = false; };
    try {
      const r = await api('chat', { messages: c.messages.map(m => ({ role: m.role, text: modelText(m) })), attachments: wire });
      stop();
      if (r.ok) {
        const am = { role: 'assistant', text: r.text };
        if (r.image && r.image.data) am.img = await shrinkImg('data:' + (r.image.mime || 'image/png') + ';base64,' + r.image.data, 1280, 0.88);
        c.messages.push(am); saveChats();
        S.user = Object.assign(S.user, { plan: r.plan, limit: r.limit, used: r.used, resetAt: r.resetAt }); saveAuth(); paintUser();
        box.appendChild(msgEl(am)); box.scrollTop = box.scrollHeight;
      } else if (r.error === 'LIMIT') {
        c.messages.pop(); saveChats();
        S.user = Object.assign(S.user, { plan: r.plan, limit: r.limit, used: r.used, resetAt: r.resetAt }); saveAuth(); paintUser();
        box.lastElementChild && box.lastElementChild.classList.contains('m') && box.lastElementChild.remove();
        inp.value = text; autoGrow(); pend = sent; renderAtts();
        const el = addNotice(`<div class="notice"><h4>⏳ Prompt limit reached</h4><p>You have used all ${r.limit} prompts on the ${r.plan === 'free' ? 'Free' : r.plan.toUpperCase()} plan. Your quota refills in <b>${fmtLeft(r.resetAt - Date.now())}</b>. Upgrade to keep chatting now.</p><button class="btn gold">⭐ See plans</button></div>`);
        $('button', el).onclick = openUpgrade;
      } else if (r.error === 'SESSION') {
        logout(true); modal({ icon: '🔐', title: 'Session expired', text: 'Please log in again.' });
      } else {
        c.messages.pop(); saveChats(); box.lastElementChild && box.lastElementChild.classList.contains('m') && box.lastElementChild.remove();
        inp.value = text; autoGrow(); pend = sent; renderAtts();
        addNotice(`<div class="notice bad"><h4>⚠️ Something went wrong</h4><p>${esc(r.message || r.error || 'Please try again.')}</p></div>`);
      }
    } catch (e) {
      stop(); c.messages.pop(); saveChats(); box.lastElementChild && box.lastElementChild.classList.contains('m') && box.lastElementChild.remove();
      inp.value = text; autoGrow(); pend = sent; renderAtts();
      addNotice(`<div class="notice bad"><h4>⚠️ Couldn't reach SteveAI</h4><p>${esc(e.message)}</p></div>`);
    }
    box.scrollTop = box.scrollHeight;
  }
  $('#btnSend').onclick = send;
  $('#inp').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); send(); } });

  /* ---------------- attachments: camera, photos, documents ---------------- */
  const MAX_ATT = 4, MAX_RAW = 6 * 1024 * 1024, MAX_TEXT = 30000;
  let pend = [], loading = 0;
  const fileIcon = k => k === 'image' ? '🖼️' : k === 'pdf' ? '📕' : '📄';
  const extOf = n => (String(n).split('.').pop() || '').toLowerCase();
  const TEXT_EXT = 'txt md csv tsv json xml html htm css js ts py java c cpp cs php rb go rs sql yml yaml log ini sh kt swift'.split(' ');
  const IMG_EXT = 'jpg jpeg png webp gif bmp'.split(' ');

  function modelText(m) {
    let t = m.text || '';
    (m.files || []).forEach(f => { if (f.kind !== 'doc') t += (t ? '\n' : '') + '[Attached ' + (f.kind === 'pdf' ? 'PDF' : 'image') + ': ' + f.name + ']'; });
    (m.docs || []).forEach(d => { t += '\n\n[Attached file: ' + d.name + ']\n' + d.text + '\n[End of ' + d.name + ']'; });
    if (!t.trim() && m.files && m.files.length) t = 'Please look at the attached file(s) and tell me what is in them.';
    return t;
  }
  function readDataURL(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read ' + file.name)); r.readAsDataURL(file); });
  }
  function loadShrink(src, max, q) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, max / Math.max(im.width, im.height));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', q));
      };
      im.onerror = () => rej(new Error('That image format is not supported. Use JPG or PNG.'));
      im.src = src;
    });
  }

  /* tiny zip reader so Word / PowerPoint / Excel files can be read on the phone */
  async function inflateRaw(raw) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This phone cannot open Office files. Export it as PDF instead.');
    const out = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  async function unzip(buf, want) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf); let e = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('This file looks damaged or is not a supported Office file.');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {}, dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
      if (!want(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), raw = u8.subarray(start, start + csize);
      out[name] = dec.decode(method === 0 ? raw : await inflateRaw(raw));
    }
    return out;
  }
  const unxml = x => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
  const numSort = (a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0);
  async function officeText(file, ext) {
    const buf = await file.arrayBuffer();
    if (ext === 'docx') {
      const z = await unzip(buf, n => n === 'word/document.xml'); const x = z['word/document.xml'];
      if (!x) throw new Error('Could not find any text in this Word file.');
      return unxml(x.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<[^>]+>/g, ''));
    }
    if (ext === 'pptx') {
      const z = await unzip(buf, n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      return Object.keys(z).sort(numSort).map((n, i) => '--- Slide ' + (i + 1) + ' ---\n' + unxml(z[n].replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, ''))).join('\n');
    }
    const z = await unzip(buf, n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    const sst = [];
    if (z['xl/sharedStrings.xml']) (z['xl/sharedStrings.xml'].match(/<si[\s>][\s\S]*?<\/si>/g) || []).forEach(si => sst.push(unxml((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''))));
    const colN = r => { let n = 0; String(r).replace(/[A-Z]/g, ch => { n = n * 26 + ch.charCodeAt(0) - 64; }); return n - 1; };
    return Object.keys(z).filter(n => /sheet/.test(n)).sort(numSort).map((n, si) => {
      const rows = (z[n].match(/<row[\s>][\s\S]*?<\/row>/g) || []).slice(0, 400).map(row => {
        const cells = []; (row.match(/<c\s[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach(c => {
          const ref = (c.match(/\sr="([A-Z]+)\d+"/) || [])[1] || '', t = (c.match(/\st="(\w+)"/) || [])[1], v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          let val = ''; if (t === 's' && v != null) val = sst[+v] || ''; else if (t === 'inlineStr') val = unxml((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || ''); else if (v != null) val = unxml(v);
          cells[colN(ref)] = val;
        });
        return Array.from(cells, v => v == null ? '' : v).join('\t');
      });
      return '--- Sheet ' + (si + 1) + ' ---\n' + rows.join('\n');
    }).join('\n\n');
  }

  async function readAttachment(file) {
    const ext = extOf(file.name), mime = (file.type || '').toLowerCase(), id = uid();
    if (mime.indexOf('image/') === 0 || IMG_EXT.indexOf(ext) > -1) {
      if (file.size > 25 * 1024 * 1024) throw new Error(file.name + ' is too large (max 25 MB).');
      const src = await readDataURL(file);
      const full = await loadShrink(src, 1600, 0.85), thumb = await loadShrink(src, 180, 0.7);
      return { id, kind: 'image', name: file.name || 'photo.jpg', mime: 'image/jpeg', data: full.split(',')[1], thumb };
    }
    if (mime === 'application/pdf' || ext === 'pdf') {
      if (file.size > MAX_RAW) throw new Error(file.name + ' is too large (PDF max 6 MB).');
      return { id, kind: 'pdf', name: file.name, mime: 'application/pdf', data: (await readDataURL(file)).split(',')[1] };
    }
    let text;
    if (['docx', 'pptx', 'xlsx'].indexOf(ext) > -1) {
      if (file.size > 15 * 1024 * 1024) throw new Error(file.name + ' is too large (max 15 MB).');
      text = await officeText(file, ext);
    } else if (ext === 'doc' || ext === 'ppt' || ext === 'xls') {
      throw new Error('Old .' + ext + ' files are not supported. Save it as .' + ext + 'x or PDF and try again.');
    } else if (TEXT_EXT.indexOf(ext) > -1 || mime.indexOf('text/') === 0 || mime === 'application/json') {
      if (file.size > 3 * 1024 * 1024) throw new Error(file.name + ' is too large (text max 3 MB).');
      text = await file.text();
    } else throw new Error('This file type is not supported. Use PDF, Word, PowerPoint, Excel, text or an image.');
    text = String(text).replace(/\u0000/g, '').trim();
    if (!text) throw new Error('No readable text found in ' + file.name + '.');
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '\n…(file truncated after ' + MAX_TEXT.toLocaleString() + ' characters)';
    return { id, kind: 'doc', name: file.name, text };
  }
  async function addFiles(list) {
    const files = Array.from(list || []); if (!files.length) return;
    loading++; renderAtts();
    for (const f of files) {
      if (pend.length >= MAX_ATT) { toast('You can attach up to ' + MAX_ATT + ' files per message'); break; }
      try { pend.push(await readAttachment(f)); renderAtts(); } catch (e) { toast(e.message || 'Could not read ' + f.name, 3500); }
    }
    loading--; renderAtts();
  }
  function renderAtts() {
    const box = $('#atts'); box.innerHTML = '';
    pend.forEach(a => {
      const d = document.createElement('div'); d.className = 'att' + (a.thumb ? '' : ' file');
      if (a.thumb) { const im = document.createElement('img'); im.src = a.thumb; im.alt = a.name; d.appendChild(im); }
      else {
        const kb = a.kind === 'pdf' ? Math.round(a.data.length * 0.75 / 1024) : Math.round(a.text.length / 1000);
        d.innerHTML = '<span class="fi">' + fileIcon(a.kind) + '</span><div><b></b><small>' + (a.kind === 'pdf' ? kb + ' KB' : (kb || 1) + 'k characters') + '</small></div>';
        $('b', d).textContent = a.name;
      }
      const x = document.createElement('button'); x.className = 'x'; x.type = 'button'; x.setAttribute('aria-label', 'Remove'); x.textContent = '✕';
      x.onclick = () => { pend = pend.filter(p => p.id !== a.id); renderAtts(); };
      d.appendChild(x); box.appendChild(d);
    });
    if (loading) { const l = document.createElement('div'); l.className = 'att load'; l.innerHTML = '<span class="spin"></span>'; box.appendChild(l); }
    box.classList.toggle('hidden', !pend.length && !loading);
    const m = $('#msgs'); if (m) m.scrollTop = m.scrollHeight;
  }
  function closeAttMenu() { $('#attMenu').classList.add('hidden'); $('#btnAttach').classList.remove('on'); }
  $('#btnAttach').onclick = e => {
    e.stopPropagation(); const m = $('#attMenu'), open = m.classList.contains('hidden');
    m.classList.toggle('hidden', !open); $('#btnAttach').classList.toggle('on', open);
  };
  $$('#attMenu [data-att]').forEach(b => b.onclick = () => {
    const k = b.dataset.att; closeAttMenu();
    if (pend.length >= MAX_ATT) return toast('You can attach up to ' + MAX_ATT + ' files per message');
    $(k === 'camera' ? '#fCam' : k === 'image' ? '#fImg' : '#fDoc').click();
  });
  ['#fCam', '#fImg', '#fDoc'].forEach(id => $(id).addEventListener('change', e => { const f = e.target.files; addFiles(f).then(() => { e.target.value = ''; }); }));
  document.addEventListener('click', e => { if (!e.target.closest('#attMenu') && !e.target.closest('#btnAttach')) closeAttMenu(); });
  $('#inp').addEventListener('paste', e => {
    const fs = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => f.type.indexOf('image/') === 0);
    if (fs.length) { e.preventDefault(); addFiles(fs); }
  });

  // delegated clicks inside messages
  $('#msgs').addEventListener('click', e => {
    const cb = e.target.closest('[data-copy]');
    if (cb) { copy(cb.closest('.code').querySelector('code').textContent); return; }
    const si = e.target.closest('[data-saveimg]');
    if (si) { saveImage(si.closest('.gen').querySelector('img').src); return; }
    const cm = e.target.closest('[data-copymsg]');
    if (cm) { copy(cm.closest('.m')._text || ''); return; }
    const a = e.target.closest('a[data-ext]');
    if (a) { e.preventDefault(); openExternal(a.getAttribute('href')); }
  });

  /* ---------------- drawer / settings buttons ---------------- */
  $('#btnMenu').onclick = () => overlayOpen('drawer');
  $('#scrim').onclick = () => overlayClose('drawer');
  $('#btnNew').onclick = () => { newChat(); overlayClose('drawer'); };
  $('#btnSet').onclick = () => { paintUser(); overlayOpen('settings'); };
  $('#pill').onclick = () => { paintUser(); overlayOpen('settings'); };
  $$('[data-close]').forEach(b => b.onclick = () => overlayClose(b.dataset.close));
  $('#btnUpgrade').onclick = openUpgrade;
  $('#btnOut').onclick = () => modal({ icon: '👋', title: 'Log out?', text: 'You can log back in with your Gmail or username.',
    buttons: [{ label: 'Log out', cls: 'danger', fn: () => logout() }, { label: 'Cancel', cls: 'ghost' }] });
  $('#rowClear').onclick = () => modal({ icon: '🧹', title: 'Clear chat history?', text: 'This removes saved chats from this device.',
    buttons: [{ label: 'Clear', cls: 'danger', fn: () => { S.chats = []; S.cur = null; saveChats(); renderMsgs(); renderHist(); toast('Chats cleared'); } }, { label: 'Cancel', cls: 'ghost' }] });
  $('#rowRefresh').onclick = () => refreshMe(false);
  $('#rowInvite').onclick = () => {
    const code = S.user && S.user.inviteCode; if (!code) return;
    const msg = 'Join me on SteveAI — your all-in-one AI companion! Use my invite code ' + code + ' when you sign up.';
    if (navigator.share) navigator.share({ title: 'SteveAI', text: msg }).catch(() => { }); else copy(msg);
  };

  /* ---------------- upgrade / payment ---------------- */
  const PLAN_DEF = () => {
    const c = S.cfg || { go_price: 10, pro_price: 20, free_limit: 5, go_limit: 40, pro_limit: 150, window_hours: 5 };
    return [
      { id: 'free', name: 'Free', price: 0, feats: [`${c.free_limit} prompts every ${c.window_hours} hours`, 'Smart chat & code help', 'Chat history on your device'] },
      { id: 'go', name: 'Go', price: c.go_price, tag: 'POPULAR', feats: [`${c.go_limit} prompts every ${c.window_hours} hours`, 'Faster, longer answers', 'Everything in Free'] },
      { id: 'pro', name: 'Pro', price: c.pro_price, feats: [`${c.pro_limit} prompts every ${c.window_hours} hours`, 'Most advanced AI model', 'Longest answers & priority use'] }
    ];
  };
  let selPlan = null;
  async function openUpgrade() {
    overlayClose('settings'); selPlan = null; $('#payBox').innerHTML = '';
    renderPlans(); overlayOpen('upgrade');
    try { const r = await api('config'); if (r.ok) { S.cfg = r.config; LS.set('cfg', S.cfg); renderPlans(); } } catch (e) { }
  }
  function renderPlans() {
    const cur = (S.user && S.user.plan) || 'free'; const box = $('#plans'); box.innerHTML = '';
    PLAN_DEF().forEach(p => {
      const b = document.createElement('button'); b.className = 'plan ' + p.id + (selPlan === p.id ? ' sel' : '');
      b.innerHTML = `${p.tag ? '<span class="tag">' + p.tag + '</span>' : ''}<h3>${p.name} ${cur === p.id ? '<span class="cur">● Current</span>' : ''}</h3>
        <div class="price">${p.price ? '$' + p.price : '$0'}<small>${p.price ? ' / month' : ' forever'}</small></div><ul>${p.feats.map(f => '<li>' + esc(f) + '</li>').join('')}</ul>`;
      if (p.id !== 'free') b.onclick = () => { selPlan = p.id; renderPlans(); renderPay(p); };
      box.appendChild(b);
    });
  }
  function renderPay(p) {
    const email = S.user.email; const cfg = S.cfg || {};
    const pend = S.pendingPlan === p.id;
    $('#payBox').innerHTML = `<div class="card pay" style="margin-top:16px">
      <b style="font-size:18px">Pay $${p.price} for ${p.name}</b>
      <div class="info">${esc(cfg.payment_info || 'Account number: 7040017142\nMOMO BANK or OPAY BANK\nAccount name: STEPHEN ADE')}</div>
      <div class="mut" style="font-size:13.5px;margin-top:10px">⚠️ Use this Gmail as the payment <b>reference / remark</b> so we can find and activate you:</div>
      <div class="remark"><b>${esc(email)}</b><button id="cpRemark">Copy</button></div>
      <ol><li>Make the payment with the remark above.</li><li>Tap <b>“I have paid”</b>.</li><li>We confirm in the Google Sheet and activate your plan, then tap <b>Refresh my plan</b> in Settings.</li></ol>
      ${cfg.payment_link ? '<button class="btn ghost" id="payLink" style="margin-bottom:10px">💳 Open payment link</button>' : ''}
      <button class="btn gold" id="iPaid" ${pend ? 'disabled' : ''}>${pend ? '⏳ Awaiting confirmation' : "✅ I have paid"}</button></div>`;
    $('#cpRemark').onclick = () => copy(email);
    if (cfg.payment_link) $('#payLink').onclick = () => openExternal(cfg.payment_link);
    $('#iPaid').onclick = async () => {
      busyBtn($('#iPaid'), true);
      try {
        const r = await api('payRequest', { plan: p.id });
        if (r.ok) { S.pendingPlan = p.id; LS.set('pending', p.id); modal({ icon: '🎉', title: 'Request received', text: r.message }); renderPay(p); }
        else { modal({ icon: '⚠️', title: 'Could not send', text: r.message || r.error }); busyBtn($('#iPaid'), false, '✅ I have paid'); }
      } catch (e) { modal({ icon: '⚠️', title: 'Network problem', text: e.message }); busyBtn($('#iPaid'), false, '✅ I have paid'); }
    };
    const pg = $('#upgrade'); pg.scrollTo({ top: pg.scrollHeight, behavior: 'smooth' });
  }

  /* ---------------- updates (GitHub Releases) ---------------- */
  const vnum = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  function newer(a, b) { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; }
  async function checkUpdate(manual) {
    if (manual) toast('Checking for updates…', 1800);
    try {
      const r = await fetch('https://api.github.com/repos/' + C.GITHUB_REPO + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error('No release found yet');
      const j = await r.json(); const latest = String(j.tag_name || '').replace(/^v/i, '');
      const asset = (j.assets || []).find(a => /\.apk$/i.test(a.name));
      if (latest && asset && newer(latest, C.APP_VERSION)) {
        modal({ icon: '🚀', title: 'Update available · v' + latest, text: (j.body || 'A new version of SteveAI is ready.').slice(0, 600) + '\n\nTap Update, then open the downloaded file to install.',
          buttons: [{ label: '⬇️ Update now', cls: 'gold', fn: () => openExternal(asset.browser_download_url) }, { label: 'Later', cls: 'ghost' }] });
      } else if (manual) modal({ icon: '✅', title: "You're up to date", text: 'SteveAI v' + C.APP_VERSION + ' is the latest version.' });
      LS.set('lastCheck', Date.now());
    } catch (e) { if (manual) modal({ icon: '⚠️', title: 'Could not check', text: e.message + '. Make sure you are online' }); }
  }
  function autoUpdateCheck() { if (Date.now() - LS.get('lastCheck', 0) > 12 * 3600000) checkUpdate(false); }
  $('#rowUpdate').onclick = () => checkUpdate(true);

  /* ---------------- native back button ---------------- */
  const AppP = plugin('App');
  if (AppP && AppP.addListener) {
    AppP.addListener('backButton', () => { if (!closeTop()) { if (!$('#chat').classList.contains('hidden') && curChat()) newChat(); else AppP.exitApp && AppP.exitApp(); } });
    AppP.addListener('resume', () => { if (S.token) { refreshMe(true); autoUpdateCheck(); } });
  }

  /* ---------------- boot ---------------- */
  tab(true);
  startSplash();
})();
