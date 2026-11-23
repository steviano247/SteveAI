/**
 * SteveAI backend — Google Apps Script (container-bound to a Google Sheet)
 * Powered by STEVEXA
 *
 * Setup (once):
 *  1. Create a Google Sheet -> Extensions -> Apps Script -> paste this file.
 *  2. Project Settings -> Script properties -> add  GEMINI_API_KEY = <your key>
 *  3. Run setup() once (authorise when asked). It creates the Users / Payments / Config sheets.
 *  4. Deploy -> New deployment -> Web app -> Execute as: Me, Who has access: Anyone -> copy the /exec URL
 *     into www/js/config.js (API_URL) in the app.
 *
 * SteveAI uses ONLY two AI engines: Google Gemini (AIza... keys) and xAI Grok (xai-... keys).
 * Your keys never leave the server: the app only talks to this script.
 */

var SHEET_USERS = 'Users';
var SHEET_PAY = 'Payments';
var SHEET_CFG = 'Config';
var SHEET_KEYS = 'ApiKeys';

var USER_COLS = ['email', 'username', 'passHash', 'salt', 'plan', 'planExpiry', 'created', 'token',
  'tokenExpiry', 'usageLog', 'inviteCode', 'invitedBy', 'lastLogin', 'totalPrompts'];
var FALLBACK_FLASH = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'];
var FALLBACK_PRO = ['gemini-3.1-pro-preview', 'gemini-pro-latest', 'gemini-3.5-flash', 'gemini-flash-latest'];
var FALLBACK_IMAGE = ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image'];
var FALLBACK_GROK = ['grok-4', 'grok-3'];
var FALLBACK_GROK_IMAGE = ['grok-imagine-image'];
var MAX_MSG_CHARS = 32000;   // per message (attached document text is included)
var KEY_COLS = ['apiKey', 'status', 'uses', 'lastUsed', 'lastError'];
var PAY_COLS = ['time', 'email', 'plan', 'amountUSD', 'remark', 'status', 'note', 'processedAt'];

var SYSTEM_PROMPT_V2 = [
  'You are SteveAI, a sharp, friendly assistant built by STEVEXA. Answer like Meta AI or Grok: direct, natural, confident.',
  '',
  'STYLE',
  '- Lead with the answer in the first line. No preamble, no "Great question", no restating the question.',
  '- Keep it SHORT by default: 2-6 lines or a few tight bullets. Go deeper (full explanation, steps, theory) ONLY when the user says "go deeper", "explain more", "in detail", "step by step" or similar.',
  '- Plain conversational language. Light emoji is fine, never excessive. Reply in the language the user writes in.',
  '- End with at most one short follow-up offer (e.g. "Want me to go deeper?") only when it genuinely helps.',
  '',
  'MATH, SCIENCE AND CALCULATIONS',
  '- When the topic involves calculation (maths, physics, chemistry, finance, statistics, engineering, conversions), ALWAYS include one short solved example with the working shown line by line, ending with a bold final answer.',
  '- Write maths in plain readable text using Unicode: x², √16, ½, ×, ÷, ≈, ≤, ≥, π, Δ, Σ, ∫, →, 10⁻³. Write fractions as a/b or (a+b)/(c+d).',
  '- NEVER use LaTeX or markup: no $...$, no $$...$$, no \\frac, \\sqrt, \\( \\), \\[ \\], \\times, \\cdot, \\text{}.',
  '- Put each step on its own line. Example format:',
  '  Solve 2x + 6 = 14',
  '  2x = 14 − 6',
  '  2x = 8',
  '  x = 8 ÷ 2 = **4**',
  '',
  'CODE',
  '- Do NOT write code, scripts or Python unless the user explicitly asks for code/program/script/function/snippet or names a programming language.',
  '- Solve maths and logic by hand in words and numbers, never by writing a program to do it.',
  '- When code IS requested: give a short working snippet in one fenced block with the language name, then 1-3 lines of explanation.',
  '',
  'FORMAT',
  '- Use **bold** for key terms and final answers. Use "-" bullets and 1. 2. 3. lists. Short headings only for long answers.',
  '- Never use tables (the app cannot display them); use bullets instead.',
  '',
  'IMAGES',
  '- SteveAI CAN create images (the app does it automatically when the user asks to generate, draw, design or make an image/logo/poster/wallpaper/picture).',
  '- Never say you cannot create images, and never answer an image request with code or SVG. If the user seems to want an image but you are replying in text, tell them to type: Generate an image of ... (or start the message with /image).',
  '- If an image request is too vague, ask ONE short question (style? colours? text on it?).',
  '',
  'HONESTY',
  '- If unsure, say so briefly. Do not invent facts, sources, links or numbers. For live data (news, prices, scores) say you may not have the latest.',
  '- Be safe and respectful. Decline harmful requests in one polite line and offer a safer alternative.'
].join('\n');

var DEFAULT_CFG = [
  ['window_hours', '5', 'Quota window length in hours'],
  ['free_limit', '5', 'Free tier: prompts per window'],
  ['go_limit', '40', 'Go tier: prompts per window'],
  ['pro_limit', '150', 'Pro tier: prompts per window'],
  ['go_price', '10', 'Go price (USD / month)'],
  ['pro_price', '20', 'Pro price (USD / month)'],
  ['plan_days', '30', 'Days a paid plan stays active after approval'],
  ['free_model', 'gemini-3.5-flash', 'Gemini model(s) for Free. Comma-separate to set a fallback order.'],
  ['go_model', 'gemini-3.5-flash', 'Gemini model(s) for Go'],
  ['pro_model', 'gemini-3.1-pro-preview', 'Gemini model(s) for Pro'],
  ['payment_info', 'Account number: 7040017142\nBank: MOMO BANK or OPAY BANK (same number)\nAccount name: STEPHEN ADE',
    'Shown in the app on the payment screen. Edit freely.'],
  ['payment_link', '', 'Optional card/checkout link shown as a button (leave empty to hide)'],
  ['system_prompt', SYSTEM_PROMPT_V2, 'Instruction given to the model on every chat (SteveAI v2 tuned: short answers, solved examples, no LaTeX, no unrequested code)'],
  ['provider', 'auto', 'Chat engine: gemini | grok | auto (auto = Gemini first, Grok if Gemini fails). Grok needs an xai- key in the ApiKeys sheet.'],
  ['grok_model', 'grok-4', 'xAI Grok model(s) for chat, comma-separated fallback order'],
  ['image_provider', 'auto', 'Image engine: gemini | grok | auto (auto = Gemini first, then Grok). Gemini images need a billing-enabled key; Grok images need an xai- key.'],
  ['grok_image_model', 'grok-imagine-image', 'xAI image model'],
  ['image_enabled', 'on', 'Image generation: on / off'],
  ['image_model', 'gemini-3.1-flash-image', 'Gemini image model(s), comma-separated fallback order'],
  ['image_cost', '2', 'How many prompts one generated image uses from the quota window'],
  ['image_plans', 'free,go,pro', 'Plans allowed to generate images (e.g. go,pro to make it a paid feature)'],
  ['maintenance', 'off', 'Set to "on" to pause chat (shows a notice in the app)']
];



/* ---------------------------------------------------------------- setup */

function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, SHEET_USERS, USER_COLS);
  ensureSheet_(ss, SHEET_PAY, PAY_COLS);
  var keys = ensureSheet_(ss, SHEET_KEYS, KEY_COLS);
  keys.setColumnWidth(1, 420); keys.setFrozenRows(1);
  keys.getRange(1, 1).setNote('One key per row (add as many accounts as you like):\nGemini: AIza...\nGrok: xai-...\nThen use menu SteveAI > Test all API keys.');
  keys.getRange(2, 2, 1000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['ACTIVE', 'OFF', 'INVALID', 'COOLDOWN'], true).build());
  var cfg = ensureSheet_(ss, SHEET_CFG, ['key', 'value', 'description']);
  var existing = cfg.getLastRow() > 1 ? cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  DEFAULT_CFG.forEach(function (row) {
    if (existing.indexOf(row[0]) === -1) cfg.appendRow(row);
  });
  // Dropdown for payment status
  var pay = ss.getSheetByName(SHEET_PAY);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(['PENDING', 'APPROVED', 'REJECTED'], true).build();
  pay.getRange(2, 6, 1000, 1).setDataValidation(rule);
  pay.setFrozenRows(1);
  ss.getSheetByName(SHEET_USERS).setFrozenRows(1);
  if (!prop_('GEMINI_API_KEY')) {
    notify_('Setup done. Now add GEMINI_API_KEY in Project Settings -> Script properties.');
  } else {
    notify_('Setup done. Deploy as a Web app (Anyone) and copy the /exec URL into the app.');
  }
}

/** Shows a popup when possible; when run from the script editor it falls back to a toast + log. */
function notify_(msg) {
  console.log(msg);
  try { SpreadsheetApp.getActive().toast(String(msg).slice(0, 180), 'SteveAI', 8); } catch (e) { }
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { }
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#0b2a8a').setFontColor('#ffffff');
  }
  return sh;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('SteveAI')
    .addItem('Run setup', 'setup')
    .addItem('Test all API keys', 'testKeys')
    .addItem('Activate selected payment row', 'activateSelectedPayment')
    .addItem('Reset selected user quota', 'resetSelectedUserQuota')
    .addItem('Generate invite code (for giveaways)', 'generateShortCode')
    .addToUi();
}

/* -------------------------------------------------------------- web app */

function doGet() {
  return json_({ ok: true, app: 'SteveAI', by: 'STEVEXA', status: 'running' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  try {
    switch (req.action) {
      case 'signup': return json_(signup_(req));
      case 'login': return json_(login_(req));
      case 'me': return json_(me_(req));
      case 'chat': return json_(chat_(req));
      case 'payRequest': return json_(payRequest_(req));
      case 'logout': return json_(logout_(req));
      case 'config': return json_(publicConfig_());
      default: return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Server error. Please try again.' });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ----------------------------------------------------------------- auth */

function signup_(r) {
  var email = String(r.email || '').trim().toLowerCase();
  var username = String(r.username || '').trim();
  var password = String(r.password || '');
  if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(email)) return { ok: false, error: 'Please use a valid Gmail address (name@gmail.com).' };
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) return { ok: false, error: 'Username must be 3-20 letters, numbers, dot, dash or underscore.' };
  if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };

  return withLock_(function () {
    var sh = sheet_(SHEET_USERS);
    var rows = rows_(sh);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].email === email) return { ok: false, error: 'This Gmail is already registered. Please log in.' };
      if (String(rows[i].username).toLowerCase() === username.toLowerCase()) return { ok: false, error: 'Username already taken.' };
    }
    var salt = Utilities.getUuid();
    var invite = newInviteCode_(rows);
    var invitedBy = '';
    var given = String(r.invite || '').trim().toUpperCase();
    if (given) {
      for (var j = 0; j < rows.length; j++) if (rows[j].inviteCode === given) { invitedBy = rows[j].email; break; }
      if (!invitedBy && isPromoCode_(given)) invitedBy = 'PROMO:' + given;
    }
    var now = Date.now();
    var token = Utilities.getUuid() + Utilities.getUuid();
    sh.appendRow([email, username, hash_(password, salt), salt, 'free', '', new Date(now), token,
      now + sessionMs_(r.keep), '[]', invite, invitedBy, new Date(now), 0]);
    return { ok: true, token: token, user: publicUser_({ email: email, username: username, plan: 'free', planExpiry: '', inviteCode: invite, usageLog: '[]' }) };
  });
}

/** Keep me signed in = 180 days (renewed on each app open); otherwise 1 day. */
function sessionMs_(keep) { return (keep === false ? 1 : 180) * 86400000; }

function login_(r) {
  var id = String(r.id || '').trim().toLowerCase();
  var password = String(r.password || '');
  return withLock_(function () {
    var sh = sheet_(SHEET_USERS);
    var rows = rows_(sh);
    for (var i = 0; i < rows.length; i++) {
      var u = rows[i];
      if (u.email === id || String(u.username).toLowerCase() === id) {
        if (hash_(password, u.salt) !== u.passHash) return { ok: false, error: 'Wrong password.' };
        var token = Utilities.getUuid() + Utilities.getUuid();
        var rowNo = i + 2;
        setCell_(sh, rowNo, 'token', token);
        setCell_(sh, rowNo, 'tokenExpiry', Date.now() + sessionMs_(r.keep));
        setCell_(sh, rowNo, 'lastLogin', new Date());
        u.token = token;
        return { ok: true, token: token, user: publicUser_(u) };
      }
    }
    return { ok: false, error: 'Account not found. Please sign up.' };
  });
}

function logout_(r) {
  return withLock_(function () {
    var f = findByToken_(r.token);
    if (f) setCell_(f.sheet, f.rowNo, 'token', '');
    return { ok: true };
  });
}

function me_(r) {
  var f = findByToken_(r.token);
  if (!f) return { ok: false, error: 'SESSION', message: 'Session expired. Please log in again.' };
  // "Keep me signed in" sessions (more than 2 days left) are renewed every time the app opens
  if (Number(f.user.tokenExpiry) - Date.now() > 2 * 86400000) setCell_(f.sheet, f.rowNo, 'tokenExpiry', Date.now() + sessionMs_(true));
  return { ok: true, user: publicUser_(f.user), config: publicConfig_().config };
}

/* ----------------------------------------------------------------- chat */

function chat_(r) {
  var cfg = config_();
  if (String(cfg.maintenance).toLowerCase() === 'on') return { ok: false, error: 'MAINTENANCE', message: 'SteveAI is being upgraded. Please try again shortly.' };

  var f = findByToken_(r.token);
  if (!f) return { ok: false, error: 'SESSION', message: 'Session expired. Please log in again.' };

  var u = f.user;
  var plan = activePlan_(u);
  var limit = Number(cfg[plan + '_limit']) || 5;
  var windowMs = (Number(cfg.window_hours) || 5) * 3600000;
  var now = Date.now();
  var log = parseLog_(u.usageLog).filter(function (t) { return now - t < windowMs; });

  if (log.length >= limit) {
    return { ok: false, error: 'LIMIT', message: 'You have used all ' + limit + ' prompts for this period.',
      plan: plan, limit: limit, used: log.length, resetAt: log[0] + windowMs };
  }

  var msgs = (r.messages || []).slice(-14).map(function (m) {
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.text || '').slice(0, MAX_MSG_CHARS) }] };
  });
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return { ok: false, error: 'Empty message.' };
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();

  // Files attached to the newest message: images and PDFs go to the model as-is.
  // (Word / text / spreadsheet files are turned into text by the app before they arrive.)
  var atts = cleanAttachments_(r.attachments);
  atts.forEach(function (a) { msgs[msgs.length - 1].parts.push({ inlineData: { mimeType: a.mime, data: a.data } }); });

  var lastUser = String((r.messages && r.messages.length ? r.messages[r.messages.length - 1].text : '') || '');
  if (!atts.length && isImageRequest_(lastUser)) return imageChat_(r, cfg, plan, limit, windowMs, log, lastUser);

  var payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt_(cfg) }] },
    contents: msgs,
    generationConfig: { temperature: 0.4, topP: 0.9, maxOutputTokens: plan === 'pro' ? 8192 : 4096 }
  });

  // Engines are tried in the order set by Config 'provider' (gemini | grok | auto)
  var order = providerOrder_(cfg.provider), text = '', got = false, sawBusy = false, configured = false;
  for (var pi = 0; pi < order.length && !got; pi++) {
    var res = order[pi] === 'grok' ? grokChat_(cfg, plan, r.messages, atts) : geminiChat_(cfg, plan, payload);
    if (res.noKeys) continue;
    configured = true;
    if (res.sawBusy) sawBusy = true;
    if (res.ok) { got = true; text = res.text; }
  }
  if (!configured) return { ok: false, error: 'Server is not configured yet (add a Gemini (AIza...) or Grok (xai-...) key in the ApiKeys sheet).' };
  if (!got) return { ok: false, error: sawBusy ? 'SteveAI is busy right now. Please try again in a minute.' : 'The AI service had a problem. Please try again.' };
  text = cleanAnswer_(text);
  if (!text) text = 'I could not produce an answer for that. Try rephrasing your question.';

  // count the prompt only after a successful answer
  withLock_(function () {
    var fresh = findByToken_(r.token);
    if (!fresh) return;
    var l = parseLog_(fresh.user.usageLog).filter(function (t) { return Date.now() - t < windowMs; });
    l.push(Date.now());
    setCell_(fresh.sheet, fresh.rowNo, 'usageLog', JSON.stringify(l));
    setCell_(fresh.sheet, fresh.rowNo, 'totalPrompts', (Number(fresh.user.totalPrompts) || 0) + 1);
    log = l;
  });

  return { ok: true, text: text, plan: plan, limit: limit, used: log.length, resetAt: log[0] + windowMs };
}


/* ------------------------------------------------------- AI engines */

function providerOrder_(v) {
  v = String(v || 'auto').toLowerCase().trim();
  return v === 'grok' ? ['grok'] : v === 'gemini' ? ['gemini'] : ['gemini', 'grok'];
}

function modelList_(configured, fallback) {
  var m = String(configured || '').split(',').map(function (x) { return x.trim(); }).filter(String).concat(fallback);
  return m.filter(function (x, i) { return m.indexOf(x) === i; });
}

/** Gemini chat. Returns { ok, text, sawBusy, noKeys }. */
function geminiChat_(cfg, plan, payload) {
  var keys = loadKeys_('gemini');
  if (!keys.length) return { noKeys: true };
  var models = modelList_(cfg[plan + '_model'], plan === 'pro' ? FALLBACK_PRO : FALLBACK_FLASH);
  var code = 0, body = {}, sawBusy = false;
  outer:
  for (var mi = 0; mi < models.length; mi++) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(models[mi]) + ':generateContent';
    for (var k = 0; k < keys.length; k++) {
      var kr = keys[k];
      var resp = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-goog-api-key': kr.key }, payload: payload
      });
      code = resp.getResponseCode();
      if (code === 200) {
        try { body = JSON.parse(resp.getContentText()); } catch (e) { body = {}; }
        markKey_(kr, 'ok', '');
        break outer;
      }
      var txt = resp.getContentText();
      var lastErr = models[mi] + ' -> ' + code + ' ' + txt.slice(0, 200).replace(/\s+/g, ' ');
      console.error('Gemini error', kr.row, lastErr);
      if (code === 429 || code >= 500) { sawBusy = true; markKey_(kr, 'cooldown', lastErr); }
      else if (code === 401 || (code === 400 && /API_KEY_INVALID|API key not valid/i.test(txt))) markKey_(kr, 'invalid', lastErr);
      else if (code === 404 || code === 403 || code === 400) { markKey_(kr, 'note', lastErr); continue outer; }
      else break outer;
    }
  }
  if (code !== 200) return { ok: false, sawBusy: sawBusy };
  var text = '';
  try { text = (body.candidates[0].content.parts || []).map(function (p) { return p.text || ''; }).join(''); } catch (e) { }
  return { ok: !!text, text: text, sawBusy: sawBusy };
}

/** Keeps at most 4 valid attachments (images + PDF). Anything else is dropped. */
function cleanAttachments_(list) {
  var out = [], total = 0;
  (Array.isArray(list) ? list : []).slice(0, 4).forEach(function (a) {
    if (!a || typeof a.data !== 'string') return;
    var mime = String(a.mime || '').toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(mime) && mime !== 'application/pdf') return;
    var data = a.data.replace(/^data:[^,]*,/, '');
    if (!data || data.length > 12000000 || total + data.length > 16000000) return;
    total += data.length;
    out.push({ name: String(a.name || 'file').slice(0, 80), mime: mime, data: data });
  });
  return out;
}

/** xAI Grok chat (OpenAI-compatible endpoint). Returns { ok, text, sawBusy, noKeys }.
 *  Grok sees attached images; PDFs are mentioned by name only (Gemini reads them). */
function grokChat_(cfg, plan, rawMessages, atts) {
  var keys = loadKeys_('xai');
  if (!keys.length) return { noKeys: true };
  var msgs = [{ role: 'system', content: systemPrompt_(cfg) }];
  (rawMessages || []).slice(-14).forEach(function (m) {
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text || '').slice(0, MAX_MSG_CHARS) });
  });
  if (atts && atts.length && msgs.length) {
    var last = msgs[msgs.length - 1], parts = [{ type: 'text', text: last.content }];
    atts.forEach(function (a) {
      if (a.mime === 'application/pdf') parts[0].text += '\n[A PDF named "' + a.name + '" was attached but this engine cannot open PDFs. Say so briefly and answer with what you can.]';
      else parts.push({ type: 'image_url', image_url: { url: 'data:' + a.mime + ';base64,' + a.data } });
    });
    last.content = parts;
  }
  var models = modelList_(cfg.grok_model, FALLBACK_GROK);
  var sawBusy = false, slim = false;
  outer:
  for (var mi = 0; mi < models.length; mi++) {
    for (var k = 0; k < keys.length; k++) {
      var kr = keys[k];
      var body = { model: models[mi], messages: msgs };
      if (!slim) { body.temperature = 0.4; body.max_tokens = plan === 'pro' ? 8192 : 4096; }
      var resp = UrlFetchApp.fetch('https://api.x.ai/v1/chat/completions', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + kr.key }, payload: JSON.stringify(body)
      });
      var code = resp.getResponseCode(), txt = resp.getContentText();
      if (code === 200) {
        var j = {}; try { j = JSON.parse(txt); } catch (e) { }
        var out = '';
        try { var c = j.choices[0].message.content; out = typeof c === 'string' ? c : (c || []).map(function (p) { return p.text || ''; }).join(''); } catch (e) { }
        markKey_(kr, 'ok', '');
        if (out) return { ok: true, text: out, sawBusy: sawBusy };
        continue outer;
      }
      var lastErr = 'GROK ' + models[mi] + ' -> ' + code + ' ' + txt.slice(0, 200).replace(/\s+/g, ' ');
      console.error('Grok error', kr.row, lastErr);
      if (code === 400 && !slim && /temperature|max_tokens|max_completion|unsupported|not supported|unknown/i.test(txt)) { slim = true; k--; continue; }
      if (code === 401) { markKey_(kr, 'invalid', lastErr); continue; }
      if (code === 429 || code >= 500) { sawBusy = true; markKey_(kr, 'cooldown', lastErr); continue; }
      markKey_(kr, 'note', lastErr);
      if (code === 400 || code === 403 || code === 404) continue outer;   // model not available for this key: next model
      break outer;
    }
  }
  return { ok: false, sawBusy: sawBusy };
}

function sniffMime_(b64) {
  b64 = String(b64 || '');
  if (b64.indexOf('/9j/') === 0) return 'image/jpeg';
  if (b64.indexOf('iVBOR') === 0) return 'image/png';
  if (b64.indexOf('UklGR') === 0) return 'image/webp';
  return 'image/png';
}

/** Gemini image engine. Returns { found, textOnly, blocked, noAccess, sawBusy, noKeys }. */
function geminiImage_(cfg, prompt, aspect) {
  var keys = loadKeys_('gemini');
  if (!keys.length) return { noKeys: true };
  var cache = null; try { cache = CacheService.getScriptCache(); } catch (e) { }
  if (cache && cache.get('gemImgNoAccess')) return { found: null, textOnly: '', blocked: false, noAccess: true, sawBusy: false };   // free keys: skip for 30 min
  var mk = function (withAspect) {
    var gc = { responseModalities: ['TEXT', 'IMAGE'] };
    if (withAspect && aspect !== '1:1') gc.imageConfig = { aspectRatio: aspect };
    return JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gc });
  };
  var payload = mk(true), aspectDropped = aspect === '1:1';
  var models = modelList_(cfg.image_model, FALLBACK_IMAGE);
  var res = { found: null, textOnly: '', blocked: false, noAccess: false, sawBusy: false };
  outer:
  for (var mi = 0; mi < models.length; mi++) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(models[mi]) + ':generateContent';
    for (var k = 0; k < keys.length; k++) {
      var kr = keys[k];
      var resp = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': kr.key }, payload: payload });
      var code = resp.getResponseCode(), txt = resp.getContentText();
      if (code === 200) {
        var body = {}; try { body = JSON.parse(txt); } catch (e) { }
        var ex = extractImage_(body);
        markKey_(kr, 'ok', '');
        if (ex.image) { res.found = ex; break outer; }
        if (ex.blocked) { res.blocked = true; break outer; }
        if (ex.text) res.textOnly = ex.text;
        continue outer;
      }
      var lastErr = 'IMAGE ' + models[mi] + ' -> ' + code + ' ' + txt.slice(0, 200).replace(/\s+/g, ' ');
      console.error('Gemini image error', kr.row, lastErr);
      if (code === 400 && !aspectDropped && /aspect|imageConfig|image_config|unknown name/i.test(txt)) { payload = mk(false); aspectDropped = true; k--; continue; }
      if (code === 401 || (code === 400 && /API_KEY_INVALID|API key not valid/i.test(txt))) { markKey_(kr, 'invalid', lastErr); continue; }
      if (code === 429) {
        if (/limit:\s*0|free.?tier|billing|not available|not supported/i.test(txt)) res.noAccess = true; else res.sawBusy = true;
        markKey_(kr, 'note', lastErr); continue;
      }
      if (code >= 500) { res.sawBusy = true; markKey_(kr, 'note', lastErr); continue; }
      if (code === 403 || code === 404 || code === 400) { if (/free.?tier|billing|not available|permission/i.test(txt)) res.noAccess = true; markKey_(kr, 'note', lastErr); continue outer; }
      break outer;
    }
  }
  if (!res.found && res.noAccess && !res.sawBusy && cache) { try { cache.put('gemImgNoAccess', '1', 1800); } catch (e) { } }
  return res;
}

/** xAI Grok image engine (grok-imagine). Returns { found, blocked, noAccess, sawBusy, noKeys }. */
function grokImage_(cfg, prompt, aspect) {
  var keys = loadKeys_('xai');
  if (!keys.length) return { noKeys: true };
  var models = modelList_(cfg.grok_image_model, FALLBACK_GROK_IMAGE);
  var withAspect = aspect !== '1:1';
  var res = { found: null, blocked: false, noAccess: false, sawBusy: false };
  outer:
  for (var mi = 0; mi < models.length; mi++) {
    for (var k = 0; k < keys.length; k++) {
      var kr = keys[k];
      var body = { model: models[mi], prompt: prompt, n: 1, response_format: 'b64_json' };
      if (withAspect) body.aspect_ratio = aspect;
      var resp = UrlFetchApp.fetch('https://api.x.ai/v1/images/generations', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + kr.key }, payload: JSON.stringify(body)
      });
      var code = resp.getResponseCode(), txt = resp.getContentText();
      if (code === 200) {
        var j = {}; try { j = JSON.parse(txt); } catch (e) { }
        var d = (j.data || [])[0] || {}, data = d.b64_json, mime = '';
        if (!data && d.url) {
          try { var blob = UrlFetchApp.fetch(d.url).getBlob(); data = Utilities.base64Encode(blob.getBytes()); mime = blob.getContentType(); } catch (e) { }
        }
        markKey_(kr, 'ok', '');
        if (data) { res.found = { image: { mime: mime || sniffMime_(data), data: data }, text: '' }; break outer; }
        continue outer;
      }
      var lastErr = 'GROK IMAGE ' + models[mi] + ' -> ' + code + ' ' + txt.slice(0, 200).replace(/\s+/g, ' ');
      console.error('Grok image error', kr.row, lastErr);
      if (code === 400 && /moderat|policy|safety|unsafe|not allowed|prohibited/i.test(txt)) { res.blocked = true; break outer; }
      if (code === 400 && withAspect) { withAspect = false; k--; continue; }
      if (code === 401) { markKey_(kr, 'invalid', lastErr); continue; }
      if (code === 402 || code === 403) { res.noAccess = true; markKey_(kr, 'note', lastErr); continue; }
      if (code === 429 || code >= 500) { res.sawBusy = true; markKey_(kr, 'cooldown', lastErr); continue; }
      markKey_(kr, 'note', lastErr);
      if (code === 400 || code === 404) continue outer;
      break outer;
    }
  }
  return res;
}

/* ------------------------------------------------- answer tuning (v2) */

/** Uses the tuned prompt unless the Config sheet holds a deliberately custom one.
 *  Old default prompts (and empty values) are upgraded automatically. */
function systemPrompt_(cfg) {
  var p = String(cfg.system_prompt || '').trim();
  if (!p || /Be concise unless the user asks for depth/.test(p) || p.indexOf('STEVEXA') === -1) return SYSTEM_PROMPT_V2;
  if (p === SYSTEM_PROMPT_V2) return p;
  return p + '\n\n' + SYSTEM_PROMPT_V2;   // keep admin text, but always enforce the v2 rules
}

var SUP_ = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '−': '⁻', 'n': 'ⁿ', 'x': 'ˣ', 'i': 'ⁱ' };
var SUB_ = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', 'n': 'ₙ', 'x': 'ₓ', 'i': 'ᵢ' };
var GREEK_ = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', omega: 'ω', omicron: 'ο',
  Delta: 'Δ', Gamma: 'Γ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω' };
var SYM_ = { times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', infty: '∞',
  rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔', leftrightarrow: '↔', implies: '⇒', sum: 'Σ', prod: 'Π', int: '∫', partial: '∂', nabla: '∇',
  degree: '°', circ: '°', angle: '∠', perp: '⊥', parallel: '∥', in: '∈', notin: '∉', subset: '⊂', cup: '∪', cap: '∩', forall: '∀', exists: '∃', ldots: '…', cdots: '…', dots: '…',
  propto: '∝', sim: '~', ll: '≪', gg: '≫', therefore: '∴', because: '∵', hbar: 'ħ', ell: 'ℓ', prime: '′', lt: '<', gt: '>' };

function map_(str, table) {
  var out = '';
  for (var i = 0; i < str.length; i++) { var c = str.charAt(i); if (!table[c]) return null; out += table[c]; }
  return out;
}

/** Turns LaTeX that the model leaks into plain readable Unicode maths. */
function latexToText_(t) {
  var prev, guard = 0;
  // \text{..}, \mathrm{..}, \mathbf{..}, \operatorname{..}, \boxed{..} -> contents
  t = t.replace(/\\(?:text|textbf|textit|mathrm|mathbf|mathit|mathcal|operatorname|boxed|mbox)\s*\{([^{}]*)\}/g, '$1');
  // superscripts / subscripts
  t = t.replace(/\^\{([^{}]*)\}/g, function (m, x) { var u = map_(x, SUP_); return u !== null ? u : '^(' + x + ')'; });
  t = t.replace(/\^([+\-−]?\d+|[nxi])(?![A-Za-z0-9])/g, function (m, x) { return map_(x, SUP_) || m; });
  t = t.replace(/_\{([^{}]*)\}/g, function (m, x) { var u = map_(x, SUB_); return u !== null ? u : '_(' + x + ')'; });
  t = t.replace(/([A-Za-z)\]])_(\d+|[nxi])(?![a-z])/g, function (m, a, x) { return a + (map_(x, SUB_) || '_' + x); });
  // fractions and roots (repeat for nesting)
  do {
    prev = t;
    t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, function (m, a, b) {
      var wrap = function (x) { return /^[\w.²³]+$/.test(x.trim()) ? x.trim() : '(' + x.trim() + ')'; };
      return wrap(a) + '/' + wrap(b);
    });
    t = t.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, function (m, n, x) { return (map_(n, SUP_) || '^' + n) + '√(' + x + ')'; });
    t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, function (m, x) { return /^[\w.]+$/.test(x) ? '√' + x : '√(' + x + ')'; });
  } while (t !== prev && ++guard < 6);
  t = t.replace(/\\sqrt\s*(\w+)/g, '√$1');
  // limits / big operators with bounds
  t = t.replace(/\\(sum|int|prod)_\{([^{}]*)\}\^\{([^{}]*)\}/g, function (m, op, a, b) { return SYM_[op] + '(' + a + '→' + b + ')'; });
  t = t.replace(/\\lim_\{([^{}]*)\}/g, 'lim($1)');
  // named symbols and greek letters
  t = t.replace(/\\([A-Za-z]+)/g, function (m, name) {
    if (GREEK_[name]) return GREEK_[name];
    if (SYM_[name]) return SYM_[name];
    if (/^(sin|cos|tan|cot|sec|csc|log|ln|exp|min|max|lim|det|mod|gcd)$/.test(name)) return name;
    if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' || name === 'displaystyle') return '';
    if (name === 'quad' || name === 'qquad') return '  ';
    return name;
  });
  t = t.replace(/\\([,;:! ])/g, ' ').replace(/\\([%&#_{}$])/g, '$1');
  t = t.replace(/\\\\/g, '\n');
  return t;
}

/** Final pass on every answer: strip LaTeX delimiters, convert maths, tidy markdown the app cannot show. */
function cleanAnswer_(text) {
  text = String(text || '');
  // protect fenced code so we never touch real code
  var blocks = [];
  text = text.replace(/```[\s\S]*?```/g, function (m) { blocks.push(m); return '\u0000B' + (blocks.length - 1) + '\u0000'; });
  var codes = [];
  text = text.replace(/`[^`\n]+`/g, function (m) { codes.push(m); return '\u0000C' + (codes.length - 1) + '\u0000'; });

  // display math  $$..$$  \[..\]  -> own line;  inline  \(..\)  $..$  -> plain
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (m, x) { return '\n' + latexToText_(x).trim() + '\n'; });
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, function (m, x) { return '\n' + latexToText_(x).trim() + '\n'; });
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, function (m, x) { return latexToText_(x).trim(); });
  text = text.replace(/(^|[^\\\d$])\$([^$\n]{1,200}?)\$(?!\d)/g, function (m, pre, x) { return pre + latexToText_(x).trim(); });
  if (/\\[A-Za-z]+|\^\{|_\{/.test(text)) text = latexToText_(text);   // stray leftovers
  text = text.replace(/\\(begin|end)\{[^}]*\}/g, '').replace(/&=/g, '=').replace(/&/g, ' ');

  // markdown tables -> bullets (renderer has no table support)
  text = text.replace(/((?:^\|.*\|[ \t]*\n?)+)/gm, function (tbl) {
    var rows = tbl.trim().split('\n').filter(function (r) { return !/^\|?[\s:|-]+\|?$/.test(r); })
      .map(function (r) { return r.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); });
    if (rows.length < 2) return tbl;
    var head = rows[0];
    return rows.slice(1).map(function (r) {
      return '- ' + r.map(function (c, i) { return (i === 0 ? '**' + c + '**' : (head[i] ? head[i] + ': ' : '') + c); }).join(' · ');
    }).join('\n') + '\n';
  });

  // html the model sometimes emits
  text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<sup>([^<]*)<\/sup>/gi, function (m, x) { return map_(x, SUP_) || '^(' + x + ')'; })
    .replace(/<sub>([^<]*)<\/sub>/gi, function (m, x) { return map_(x, SUB_) || '_(' + x + ')'; })
    .replace(/<\/?(?:b|strong)>/gi, '**').replace(/<\/?(?:i|em)>/gi, '*').replace(/<\/?(?:p|div|span|u|center)[^>]*>/gi, '');
  // markdown the app's renderer cannot show: deep headings, bold-italic, literal \n, stray escapes
  text = text.replace(/^#{4,6}\s+/gm, '### ').replace(/\*\*\*([^*\n]+)\*\*\*/g, '**$1**').replace(/__([^_\n]+)__/g, '**$1**');
  text = text.replace(/\\n/g, '\n').replace(/\\([*_#>~`|-])/g, '$1');
  text = text.replace(/^(\s*)[•◦▪]\s+/gm, '$1- ').replace(/^(\s*)\*\s+/gm, '$1- ');
  text = text.replace(/\*\*\*\*/g, '');
  // balance a lone ** so raw asterisks never show
  if ((text.match(/\*\*/g) || []).length % 2) text = text.replace(/\*\*(?![\s\S]*\*\*)/, '');
  text = text.replace(/^\s*---+\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  text = text.replace(/\u0000C(\d+)\u0000/g, function (m, i) { return codes[+i]; });
  text = text.replace(/\u0000B(\d+)\u0000/g, function (m, i) { return blocks[+i]; });
  return text;
}

/** Run from the editor to verify the cleaner (View -> Logs). */
function testCleaner() {
  var sample = 'Solve $x^{2} - 5x + 6 = 0$.\n$$x = \\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}$$\nArea = \\( \\pi r^2 \\approx 3.14 \\times 5^2 = 78.5 \\) cm²';
  console.log(cleanAnswer_(sample));
}


/* ------------------------------------------------ image generation (v1) */

var IMAGE_RULES_ = 'You are an expert image generator. Create exactly the image the user asks for: high quality, well composed, correct anatomy, good lighting and rich detail. ' +
  'If the image contains text, spell it exactly as requested. No watermarks, no signatures, no extra captions inside the image. ' +
  'If the request modifies an earlier idea from the conversation (e.g. "make it bluer"), apply the change to that idea. Reply with at most one short friendly sentence.';

/** Decides whether a message is asking for a picture. "/image ..." always forces it. */
function isImageRequest_(t) {
  t = String(t || '').trim();
  if (!t || t.length > 1500) return false;
  if (/^\/(image|imagine|img|draw)\b/i.test(t)) return true;
  if (/\b(code|script|python|javascript|function|program|snippet|algorithm)\b/i.test(t)) return false;
  if (/^\s*(how|why|explain|describe|what is|what are|what does|tell me)\b/i.test(t)) return false;
  var noun = '(?:images?|pictures?|photos?|pics?|photographs?|illustrations?|logos?|posters?|wallpapers?|artworks?|drawings?|paintings?|icons?|banners?|flyers?|thumbnails?|avatars?|portraits?|stickers?|cartoons?|mockups?|memes?|graphics?|visuals?|sketch(?:es)?)';
  var verb = '(?:generate|create|make|draw|design|paint|illustrate|render|produce|sketch|imagine|give me|show me|i want|i need|get me)';
  if (new RegExp('\\b' + verb + '\\b[^.?!\\n]{0,80}?\\b' + noun + '\\b', 'i').test(t)) return true;
  if (/^\s*(please\s+)?(draw|sketch|paint|illustrate|imagine)\b/i.test(t) && !/\b(graph|plot|equation)\b/i.test(t)) return true;
  return false;
}

function aspectFor_(t) {
  t = String(t || '').toLowerCase();
  var m = t.match(/\b(\d{1,2}):(\d{1,2})\b/);
  if (m) { var a = m[1] + ':' + m[2]; if (['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'].indexOf(a) !== -1) return a; }
  if (/\b(phone wallpaper|wallpaper for (my )?phone|story|stories|reel|tiktok|vertical|portrait mode|status)\b/.test(t)) return '9:16';
  if (/\b(youtube|thumbnail|banner|cover|landscape|desktop wallpaper|wide|header|slide)\b/.test(t)) return '16:9';
  if (/\b(poster|flyer|book cover|portrait)\b/.test(t)) return '3:4';
  return '1:1';
}

function extractImage_(body) {
  var out = { image: null, text: '', blocked: false, reason: '' };
  try {
    var fb = body.promptFeedback || {};
    if (fb.blockReason) { out.blocked = true; out.reason = fb.blockReason; }
    var cand = (body.candidates || [])[0] || {};
    if (/SAFETY|PROHIBITED|BLOCKLIST|SPII|IMAGE_OTHER|RECITATION/i.test(String(cand.finishReason || ''))) { out.blocked = true; out.reason = cand.finishReason; }
    ((cand.content || {}).parts || []).forEach(function (p) {
      var d = p.inlineData || p.inline_data;
      if (d && d.data && !out.image) out.image = { mime: d.mimeType || d.mime_type || 'image/png', data: d.data };
      else if (p.text) out.text += p.text;
    });
  } catch (e) { }
  return out;
}

function imageChat_(r, cfg, plan, limit, windowMs, log, lastUser) {
  var usage = function (extra) {
    var o = { ok: true, plan: plan, limit: limit, used: log.length, resetAt: log.length ? log[0] + windowMs : null };
    for (var k in extra) o[k] = extra[k];
    return o;
  };
  if (String(cfg.image_enabled || 'on').toLowerCase() === 'off')
    return usage({ text: 'Image creation is switched off right now. I can still help with any text question. 🙂' });
  var allowed = String(cfg.image_plans || 'free,go,pro').toLowerCase().split(',').map(function (x) { return x.trim(); });
  if (allowed.indexOf(plan) === -1)
    return usage({ text: '🎨 Image creation is a **Go** and **Pro** feature.\nTap ⚙️ **Settings → Upgrade plan** to unlock it.' });
  var cost = Math.max(1, Number(cfg.image_cost) || 2);
  if (log.length + cost > limit)
    return { ok: false, error: 'LIMIT', message: 'An image uses ' + cost + ' prompts and you do not have enough left in this period.', plan: plan, limit: limit, used: log.length, resetAt: log.length ? log[0] + windowMs : Date.now() + windowMs };

  var ctx = (r.messages || []).slice(-7, -1).map(function (m) {
    return (m.role === 'assistant' ? 'Assistant: ' : 'User: ') + String(m.text || '').replace(/\s+/g, ' ').slice(0, 250);
  }).join('\n');
  var ask = lastUser.replace(/^\/(image|imagine|img|draw)\s*/i, '').trim() || lastUser;
  var prompt = IMAGE_RULES_ + (ctx ? '\n\nConversation so far (context only):\n' + ctx : '') + '\n\nImage request: ' + ask;
  var aspect = aspectFor_(ask);
  var simple = (ctx ? 'Conversation so far (context only):\n' + ctx + '\n\n' : '') + 'Create this image: ' + ask;

  var order = providerOrder_(cfg.image_provider), found = null, textOnly = '', blocked = false, noAccess = false, sawBusy = false, configured = false;
  for (var pi = 0; pi < order.length && !found && !blocked; pi++) {
    var res = order[pi] === 'grok' ? grokImage_(cfg, simple, aspect) : geminiImage_(cfg, prompt, aspect);
    if (res.noKeys) continue;
    configured = true;
    if (res.found) found = res.found;
    if (res.blocked) blocked = true;
    if (res.textOnly) textOnly = res.textOnly;
    noAccess = noAccess || !!res.noAccess; sawBusy = sawBusy || !!res.sawBusy;
  }
  if (!configured) return { ok: false, error: 'Server is not configured yet (add a Gemini (AIza...) or Grok (xai-...) key in the ApiKeys sheet).' };

  if (!found) {
    if (blocked) return usage({ text: "I can't create that image because it goes against safety rules. Try describing something different and I'll gladly make it. 🎨" });
    if (textOnly) return usage({ text: cleanAnswer_(textOnly) });
    if (sawBusy) return { ok: false, error: 'IMAGE', message: 'Image creation is busy right now, Please try again in a minute.' };
    if (noAccess) return { ok: false, error: 'IMAGE', message: 'Image creation is not enabled on the current API keys yet. Gemini image models need a billing-enabled key, or add a Grok (xai-) key in the ApiKeys sheet.' };
    return { ok: false, error: 'IMAGE', message: 'I could not create that image. Please rephrase and try again.' };
  }

  withLock_(function () {
    var fresh = findByToken_(r.token);
    if (!fresh) return;
    var l = parseLog_(fresh.user.usageLog).filter(function (t) { return Date.now() - t < windowMs; });
    for (var c = 0; c < cost; c++) l.push(Date.now());
    setCell_(fresh.sheet, fresh.rowNo, 'usageLog', JSON.stringify(l));
    setCell_(fresh.sheet, fresh.rowNo, 'totalPrompts', (Number(fresh.user.totalPrompts) || 0) + 1);
    log = l;
  });
  var caption = cleanAnswer_(found.text).split('\n')[0].slice(0, 200) || 'Here you go! 🎨';
  return { ok: true, kind: 'image', text: caption, image: found.image, plan: plan, limit: limit, used: log.length, resetAt: log[0] + windowMs };
}

/** Run from the editor to check image routing (View -> Logs). */
function testImageIntent() {
  ['Generate an image of a lion in a suit', 'draw a cat', 'make a logo for my bakery', 'create a poster for church event', '/image sunset in Lagos',
    'write python code to draw a circle', 'how do I draw a house', 'explain the image of DNA', 'what is a logo', 'solve 2x+3=9', 'create a wallpaper for my phone with neon city'
  ].forEach(function (t) { console.log(isImageRequest_(t) + '  <-  ' + t); });
}

/* ------------------------------------------------------------- payments */

function payRequest_(r) {
  var plan = String(r.plan || '').toLowerCase();
  if (plan !== 'go' && plan !== 'pro') return { ok: false, error: 'Choose Go or Pro.' };
  var f = findByToken_(r.token);
  if (!f) return { ok: false, error: 'SESSION', message: 'Session expired. Please log in again.' };
  var cfg = config_();
  var email = f.user.email;

  return withLock_(function () {
    var pay = sheet_(SHEET_PAY);
    var rows = rows_(pay);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].email === email && rows[i].status === 'PENDING') {
        return { ok: true, message: 'Your payment is already awaiting confirmation. It is usually activated within a few hours.' };
      }
    }
    pay.appendRow([new Date(), email, plan, Number(cfg[plan + '_price']), email, 'PENDING', String(r.note || '').slice(0, 200), '']);
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'SteveAI: payment request from ' + email,
        email + ' says they paid for ' + plan.toUpperCase() + ' ($' + cfg[plan + '_price'] + '). Search your bank alerts for this Gmail as the remark, then set Status = APPROVED in the Payments sheet.');
    } catch (e) { }
    return { ok: true, message: 'Thanks! We will confirm your payment (using your Gmail as the reference) and activate your plan.' };
  });
}

/** Simple trigger: set Status = APPROVED in the Payments sheet and the plan is activated automatically. */
function onEdit(e) {
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET_PAY || e.range.getColumn() !== 6 || e.range.getRow() < 2) return;
    if (String(e.value).toUpperCase() !== 'APPROVED') return;
    activatePaymentRow_(sh, e.range.getRow());
  } catch (err) { console.error(err); }
}

function activateSelectedPayment() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEET_PAY) { notify_('Select a row in the Payments sheet first.'); return; }
  var row = sh.getActiveRange().getRow();
  sh.getRange(row, 6).setValue('APPROVED');
  activatePaymentRow_(sh, row);
}

function activatePaymentRow_(sh, row) {
  var headers = PAY_COLS;
  var vals = sh.getRange(row, 1, 1, headers.length).getValues()[0];
  var rec = {}; headers.forEach(function (h, i) { rec[h] = vals[i]; });
  if (rec.processedAt) return; // already done
  var users = sheet_(SHEET_USERS);
  var list = rows_(users);
  var days = Number(config_().plan_days) || 30;
  for (var i = 0; i < list.length; i++) {
    if (list[i].email === String(rec.email).toLowerCase()) {
      var rowNo = i + 2;
      var base = Math.max(Date.now(), Number(list[i].planExpiry) || 0);
      setCell_(users, rowNo, 'plan', rec.plan);
      setCell_(users, rowNo, 'planExpiry', base + days * 86400000);
      sh.getRange(row, 8).setValue(new Date());
      return;
    }
  }
  sh.getRange(row, 7).setValue('User not found for this Gmail');
}

function resetSelectedUserQuota() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== SHEET_USERS) { notify_('Select a row in the Users sheet first.'); return; }
  setCell_(sh, sh.getActiveRange().getRow(), 'usageLog', '[]');
}

/* ----------------------------------------------------------- invite code */

/** Menu action: makes a shareable promo code (e.g. STV-K7Q2M) and stores it in Script properties. */
function generateShortCode() {
  var code = newCode_();
  var promo = JSON.parse(prop_('PROMO_CODES') || '[]');
  promo.push(code);
  PropertiesService.getScriptProperties().setProperty('PROMO_CODES', JSON.stringify(promo));
  notify_('New promo code: ' + code + '\n\nShare it. People enter it during sign-up (they are tagged "PROMO:' + code + '" in the Users sheet).');
  return code;
}

function isPromoCode_(c) { return JSON.parse(prop_('PROMO_CODES') || '[]').indexOf(c) !== -1; }

function newCode_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 5; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'STV-' + s;
}

function newInviteCode_(rows) {
  var used = rows.map(function (r) { return r.inviteCode; });
  var c; do { c = newCode_(); } while (used.indexOf(c) !== -1);
  return c;
}

/* ------------------------------------------------------------- API keys */

/** Reads the ApiKeys sheet (paste as many Gemini keys as you like, one per row in column A).
 *  ACTIVE keys are used in random order; a key that hits a rate limit rests for 60 s (COOLDOWN);
 *  a rejected key is marked INVALID. The GEMINI_API_KEY script property is used as a fallback. */
function loadKeys_(kind) {
  kind = kind || 'gemini';
  var out = [];
  var sh = sheet_(SHEET_KEYS);
  if (sh && sh.getLastRow() > 1) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
    var now = Date.now();
    vals.forEach(function (r, i) {
      var key = String(r[0] || '').trim(); if (!key) return;
      if (keyKind_(key) !== kind) return;
      var st = String(r[1] || 'ACTIVE').toUpperCase();
      if (st === 'OFF' || st === 'INVALID') return;
      if (st === 'COOLDOWN' && now - (Number(new Date(r[3])) || 0) < 60000) return;
      out.push({ key: key, row: i + 2, uses: Number(r[2]) || 0 });
    });
  }
  var fb = prop_(kind === 'xai' ? 'XAI_API_KEY' : 'GEMINI_API_KEY');
  for (var j = out.length - 1; j > 0; j--) { var x = Math.floor(Math.random() * (j + 1)); var t = out[j]; out[j] = out[x]; out[x] = t; }
  if (fb) out.push({ key: fb, row: 0, uses: 0 });
  return out;
}

/** 'xai' = Grok key, 'other' = a provider SteveAI does not use (ignored), anything else = Gemini. */
function keyKind_(key) {
  key = String(key || '').trim();
  if (/^xai-/i.test(key)) return 'xai';
  if (/^(cf:|sk-|gsk_|hf_|nvapi-|pplx-|r8_|or-v1-)/i.test(key)) return 'other';
  return 'gemini';
}

function markKey_(kr, result, err) {
  if (!kr.row) return;
  try {
    var sh = sheet_(SHEET_KEYS);
    if (result === 'ok') {
      sh.getRange(kr.row, 2, 1, 4).setValues([['ACTIVE', kr.uses + 1, new Date(), '']]);
    } else if (result === 'note') {
      sh.getRange(kr.row, 5).setValue(err);
    } else {
      sh.getRange(kr.row, 2, 1, 4).setValues([[result === 'invalid' ? 'INVALID' : 'COOLDOWN', kr.uses, new Date(), err]]);
    }
  } catch (e) { }
}

/** Menu: checks every key in the ApiKeys sheet and writes the result in the status / lastError columns. */
function testKeys() {
  var sh = sheet_(SHEET_KEYS);
  if (!sh || sh.getLastRow() < 2) { notify_('The ApiKeys sheet is empty. Paste keys in column A first.'); return; }
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues(), report = [];
  vals.forEach(function (v, i) {
    var key = String(v[0] || '').trim(); if (!key) return;
    var row = i + 2, kk = keyKind_(key), kind = kk === 'xai' ? 'Grok' : kk === 'other' ? 'Unsupported' : 'Gemini', ok = false, msg = '';
    try {
      var resp;
      if (kind === 'Gemini') resp = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { muteHttpExceptions: true, headers: { 'x-goog-api-key': key } });
      else if (kind === 'Grok') resp = UrlFetchApp.fetch('https://api.x.ai/v1/models', { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + key } });
      else { sh.getRange(row, 2).setValue('OFF'); sh.getRange(row, 5).setValue('Ignored: only Gemini (AIza...) and Grok (xai-...) keys are used'); report.push('Row ' + row + ' ignored (unsupported key type)'); return; }
      ok = resp.getResponseCode() === 200;
      msg = ok ? 'OK (' + kind + ')' : kind + ' -> ' + resp.getResponseCode() + ' ' + resp.getContentText().slice(0, 120).replace(/\s+/g, ' ');
    } catch (e) { msg = kind + ' -> ' + e; }
    sh.getRange(row, 2).setValue(ok ? 'ACTIVE' : 'INVALID');
    sh.getRange(row, 5).setValue(msg);
    report.push('Row ' + row + ' ' + msg);
  });
  notify_(report.join('\n') || 'No keys found.');
}

/* -------------------------------------------------------------- helpers */

function publicUser_(u) {
  var cfg = config_();
  var plan = activePlan_(u);
  var windowMs = (Number(cfg.window_hours) || 5) * 3600000;
  var log = parseLog_(u.usageLog).filter(function (t) { return Date.now() - t < windowMs; });
  return {
    email: u.email, username: u.username, plan: plan,
    planExpiry: plan === 'free' ? null : Number(u.planExpiry) || null,
    inviteCode: u.inviteCode,
    limit: Number(cfg[plan + '_limit']) || 5, used: log.length,
    resetAt: log.length ? log[0] + windowMs : null
  };
}

function publicConfig_() {
  var c = config_();
  return {
    ok: true,
    config: {
      go_price: Number(c.go_price), pro_price: Number(c.pro_price),
      free_limit: Number(c.free_limit), go_limit: Number(c.go_limit), pro_limit: Number(c.pro_limit),
      window_hours: Number(c.window_hours), plan_days: Number(c.plan_days),
      payment_info: c.payment_info, payment_link: c.payment_link, maintenance: c.maintenance
    }
  };
}

function activePlan_(u) {
  var p = String(u.plan || 'free');
  if ((p === 'go' || p === 'pro') && Number(u.planExpiry) > Date.now()) return p;
  return 'free';
}

function parseLog_(s) { try { return JSON.parse(s || '[]'); } catch (e) { return []; } }

function hash_(password, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password + ':' + salt, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function sheet_(name) { return SpreadsheetApp.getActive().getSheetByName(name); }

function rows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return sh.getRange(2, 1, last - 1, headers.length).getValues().map(function (r) {
    var o = {}; headers.forEach(function (h, i) { o[h] = r[i]; });
    o.email = String(o.email || '').toLowerCase();
    return o;
  });
}

function setCell_(sh, rowNo, col, value) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getRange(rowNo, headers.indexOf(col) + 1).setValue(value);
}

function findByToken_(token) {
  token = String(token || '');
  if (token.length < 20) return null;
  var sh = sheet_(SHEET_USERS);
  var list = rows_(sh);
  for (var i = 0; i < list.length; i++) {
    if (list[i].token === token) {
      if (Number(list[i].tokenExpiry) < Date.now()) return null;
      return { sheet: sh, rowNo: i + 2, user: list[i] };
    }
  }
  return null;
}

function config_() {
  var sh = sheet_(SHEET_CFG);
  var cache = CacheService.getScriptCache();
  var hit = cache.get('cfg');
  if (hit) return JSON.parse(hit);
  var o = {};
  DEFAULT_CFG.forEach(function (r) { o[r[0]] = r[1]; });
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0]) o[r[0]] = String(r[1]); });
  }
  cache.put('cfg', JSON.stringify(o), 60);
  return o;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}