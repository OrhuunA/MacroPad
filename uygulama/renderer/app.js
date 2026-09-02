'use strict';

/* ================================================================
   1. AKSIYON KATALOGU
   Kategori tabanli: yeni bir aksiyon eklemek icin ACTIONS'a bir
   satir, CATALOG'a bir isim ve i18n'e iki anahtar yeterli.
   Motor tarafi degismez - hepsi mevcut motor tiplerine oturur.
   ================================================================ */
const CATALOG = [
  { id:'mouse',    icon:'🖱', items:['click','dblclick','rightclick','middleclick','move','clickmove','scroll'] },
  { id:'keyboard', icon:'⌨', items:['key','text','piano','combo'] },
  { id:'extra',    icon:'⏱', items:['delay'] }
];

/* engine type + o aksiyona ozgu baslangic degerleri */
const ACTIONS = {
  click:       { type:'click',  init:{ button:'left',   mode:'current', double:false } },
  dblclick:    { type:'click',  init:{ button:'left',   mode:'current', double:true  } },
  rightclick:  { type:'click',  init:{ button:'right',  mode:'current', double:false } },
  middleclick: { type:'click',  init:{ button:'middle', mode:'current', double:false } },
  clickmove:   { type:'click',  init:{ button:'left',   mode:'xy',      double:false } },
  move:        { type:'move',   init:{} },
  scroll:      { type:'scroll', init:{} },
  key:         { type:'key',    init:{} },
  text:        { type:'text',   init:{} },
  piano:       { type:'piano',  init:{} },
  combo:       { type:'combo',  init:{} },
  delay:       { type:'delay',  init:{} }
};

/* motor tipi -> varsayilan parametreler */
const BASE = {
  text:   () => ({ type:'text',   value:'Merhaba dünya!', charDelay:60, pressEnter:true, finalEnter:false, speed:3 }),
  piano:  () => ({ type:'piano',  value:'[sjf] f j s | f j f', noteMs:150, gapMs:150, barMs:300, lineMs:450, holdMs:60, speed:3 }),
  click:  () => ({ type:'click',  button:'left', mode:'current', x:0, y:0, count:1, interval:120, double:false, restore:false, speed:3 }),
  delay:  () => ({ type:'delay',  ms:1000 }),
  key:    () => ({ type:'key',    value:'enter', count:1, interval:80, speed:3 }),
  combo:  () => ({ type:'combo',  keysText:'ctrl+c' }),
  move:   () => ({ type:'move',   x:0, y:0 }),
  scroll: () => ({ type:'scroll', amount:-3, count:1 })
};

const COLORS = { mouse:'#3ddc97', keyboard:'#8aa4ff', extra:'#ffc75a' };

const KEY_OPTIONS = ['enter','tab','esc','space','backspace','delete','insert','home','end',
  'pageup','pagedown','up','down','left','right',
  'f1','f2','f3','f4','f5','f6','f7','f8','f9','f10','f11','f12'];

const SPEED_F = [0.45, 0.7, 1, 1.5, 2.2];

/* aksiyon kimligini adimin kendi alanlarindan turet -> her zaman tutarli */
function actOf(st) {
  if (st.type !== 'click') return st.type;
  if (st.mode === 'xy') return 'clickmove';
  if (st.double) return 'dblclick';
  if (st.button === 'right') return 'rightclick';
  if (st.button === 'middle') return 'middleclick';
  return 'click';
}
function catOf(st) {
  const a = actOf(st);
  const c = CATALOG.find(c => c.items.indexOf(a) !== -1);
  return c ? c.id : 'extra';
}

/* ================================================================
   2. DURUM
   ================================================================ */
let seq = 1;
const uid = (p) => (p || 's') + (seq++) + Date.now().toString(36).slice(-3);

function newStep(actionId) {
  const a = ACTIONS[actionId];
  const st = Object.assign(BASE[a.type](), a.init);
  st.id = uid(); st.enabled = true;
  return st;
}

const FRESH = () => {
  const st = newStep('text');
  return {
    version: 4,
    ui: { mode:'simple', theme:'dark', accent:'blue', font:'md', compact:false,
          hints:true, lang:null, railW:250, timeUnit:'ms' },
    onboarding: { langChosen:false, tutorialDone:false },
    hotkeys: { start:'<f6>', stop:'<f8>' },      // geriye donuk uyumluluk
    bindings: [
      { id: uid('b'), spec:'key:f6', mode:'profile', target:'active', enabled:true },
      { id: uid('b'), spec:'key:f8', mode:'stop',    target:'active', enabled:true }
    ],
    activeId: null,
    profiles: [{ id: uid('p'), name:'Makro 1',
                 config:{ startDelay:3, repeat:1, loopDelay:500 },
                 steps:[st], sel: st.id }]
  };
};

let state = FRESH();
state.activeId = state.profiles[0].id;

let running = false, captureTarget = null, capturingKey = null, pickKeyFor = null;
let engineInfo = { ready:false, version:null, features:[] };
let history = [], future = [], toastTimer = null;
let lastRepeat = 1;      // sonsuza gecmeden onceki tekrar sayisi

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const prof  = () => state.profiles.find(p => p.id === state.activeId) || state.profiles[0];
const steps = () => prof().steps;
const byId  = (id) => steps().find(s => s.id === id);
const cur   = () => byId(prof().sel);
const simple = () => state.ui.mode === 'simple';

/* ================================================================
   3. KALICILIK + GECMIS
   ================================================================ */
function save() {
  try { localStorage.setItem('macropad.v4', JSON.stringify(state)); } catch (e) {}
}

function snapshot() {
  return JSON.stringify({ profiles: state.profiles, activeId: state.activeId });
}
function pushHistory() {
  history.push(snapshot());
  if (history.length > 60) history.shift();
  future.length = 0;
}
function restore(json) {
  const d = JSON.parse(json);
  state.profiles = d.profiles; state.activeId = d.activeId;
  normalize(); renderAll();
}
function undo() {
  if (!history.length) return;
  future.push(snapshot());
  restore(history.pop());
  setStatusKey('step.undo', null, '');
}
function redo() {
  if (!future.length) return;
  history.push(snapshot());
  restore(future.pop());
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem('macropad.v4'); } catch (e) {}
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.profiles) && d.profiles.length) { state = d; normalize(); return; }
    } catch (e) {}
  }
  try {                                   // v3'ten tasi
    const old = localStorage.getItem('macropad.v3');
    if (old) {
      const d = JSON.parse(old);
      if (d && Array.isArray(d.profiles)) {
        state = FRESH();
        state.profiles = d.profiles;
        state.activeId = d.activeId || d.profiles[0].id;
        if (d.ui) Object.assign(state.ui, d.ui);
        if (d.hotkeys) state.hotkeys = d.hotkeys;
        state.onboarding = { langChosen:true, tutorialDone:true };   // eski kullanici
      }
    }
  } catch (e) {}
  normalize();
}

function normalize() {
  state.ui = Object.assign({ mode:'simple', theme:'dark', accent:'blue', font:'md',
                             compact:false, hints:true, lang:null, railW:250,
                             timeUnit:'ms' }, state.ui || {});
  state.onboarding = Object.assign({ langChosen:false, tutorialDone:false }, state.onboarding || {});
  state.hotkeys = Object.assign({ start:'<f6>', stop:'<f8>' }, state.hotkeys || {});
  if (!Array.isArray(state.bindings)) {                 // eski surumden tasi
    const k2s = (h) => 'key:' + String(h || '').replace(/[<>]/g, '');
    state.bindings = [
      { id: uid('b'), spec: k2s(state.hotkeys.start), mode:'profile', target:'active', enabled:true },
      { id: uid('b'), spec: k2s(state.hotkeys.stop),  mode:'stop',    target:'active', enabled:true }
    ];
  }
  state.bindings = state.bindings.filter(b => b && b.spec).map(b => Object.assign(
    { id: uid('b'), mode:'profile', target:'active', enabled:true }, b));
  (state.profiles || []).forEach(p => {
    p.id = p.id || uid('p');
    p.config = Object.assign({ startDelay:3, repeat:1, loopDelay:500, focusWindow:'' }, p.config || {});
    p.steps = (p.steps || []).map(s => {
      if (!s.id) s.id = uid();
      if (s.enabled === undefined) s.enabled = true;
      if (s.speed === undefined) s.speed = 3;
      return s;
    });
    if (!p.steps.some(s => s.id === p.sel)) p.sel = p.steps.length ? p.steps[0].id : null;
  });
  if (!state.profiles.some(p => p.id === state.activeId)) state.activeId = state.profiles[0].id;
}

/* ================================================================
   4. ETIKETLER
   ================================================================ */
function sheetStats(v) {
  let n = 0, c = 0, i = 0; v = v || '';
  while (i < v.length) {
    const ch = v[i];
    if (ch === '[') {
      const j = v.indexOf(']', i + 1);
      if (j === -1) { i++; continue; }
      const k = v.slice(i + 1, j).replace(/\s/g, '');
      if (k.length > 1) c++; else if (k.length === 1) n++;
      i = j + 1;
    } else if (/[\s|\]]/.test(ch)) i++;
    else { n++; i++; }
  }
  return { notes: n + c, chords: c };
}

function detailOf(st) {
  switch (st.type) {
    case 'text': {
      const v = (st.value || '').replace(/\s+/g, ' ').trim();
      return v ? (v.length > 34 ? v.slice(0, 34) + '…' : v) : '—';
    }
    case 'piano': { const s = sheetStats(st.value); return `${s.notes} / ${s.chords}`; }
    case 'click':
      return (st.mode === 'xy' ? `X:${st.x} Y:${st.y}` : t('f.mode.current')) + ` × ${st.count}`;
    case 'delay':  return `${st.ms} ms`;
    case 'key':    return `${st.value} × ${st.count}`;
    case 'combo':  return (st.keysText || '').trim() || '—';
    case 'move':   return `X:${st.x} Y:${st.y}`;
    case 'scroll': return `${st.amount > 0 ? '↑' : '↓'} × ${st.count}`;
    default:       return '';
  }
}

/* ================================================================
   5. BASIT MOD ZAMANLAMASI
   ================================================================ */
const speedF = (st) => SPEED_F[(st.speed || 3) - 1] || 1;

function timedCopy(st) {
  const o = Object.assign({}, st);
  if (!simple()) return o;
  const f = speedF(st), r = (b) => Math.max(0, Math.round(b / f));
  if (o.type === 'text')  o.charDelay = r(60);
  if (o.type === 'click') o.interval  = r(120);
  if (o.type === 'key')   o.interval  = r(80);
  if (o.type === 'piano') {
    o.noteMs = r(150); o.gapMs = r(150); o.barMs = r(300); o.lineMs = r(450);
    o.holdMs = Math.max(8, Math.round(o.noteMs * 0.45));
  }
  return o;
}
function speedReadout(st) {
  const c = timedCopy(st);
  if (st.type === 'text')  return `${c.charDelay} ms`;
  if (st.type === 'piano') return `${c.noteMs} ms`;
  if (st.type === 'click') return `${c.interval} ms`;
  if (st.type === 'key')   return `${c.interval} ms`;
  return '';
}

/* ================================================================
   6. ALAN URETICILERI
   ================================================================ */
const fNum = (id, k, label, val, hint, min) =>
  `<label class="field"><span>${label}</span>
     <input type="number" data-id="${id}" data-k="${k}" value="${esc(val)}" data-min="${min == null ? 0 : min}">
     ${hint ? `<em>${hint}</em>` : ''}</label>`;
/* Sure alani: ayarlara gore ms ya da saniye gosterir, saklanan deger
   her zaman ms kalir. */
function fDur(id, k, label, ms, hint, min) {
  const sec = state.ui.timeUnit === 's';
  const val = sec ? (Number(ms || 0) / 1000) : Number(ms || 0);
  const lbl = label.replace(/\(ms\)/, sec ? '(sn)' : '(ms)');
  return `<label class="field"><span>${lbl}</span>
     <input type="number" data-id="${id}" data-k="${k}" value="${val}"
            ${sec ? 'step="0.05" data-mul="1000"' : 'step="1"'}
            data-min="${(min == null ? 0 : min) / (sec ? 1000 : 1)}">
     ${hint ? `<em>${hint}</em>` : ''}</label>`;
}

const fCheck = (id, k, label, val) =>
  `<label class="check"><input type="checkbox" data-id="${id}" data-k="${k}" ${val ? 'checked' : ''}><span>${label}</span></label>`;
const fSel = (id, k, label, val, opts) =>
  `<label class="field"><span>${label}</span><select data-id="${id}" data-k="${k}">${
    opts.map(([v, x]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`;

const speedCard = (st) => `<div class="card"><h4>${t('f.speed')}</h4>
    <div class="speed">
      <input type="range" min="1" max="5" step="1" value="${st.speed || 3}" data-id="${st.id}" data-k="speed">
      <span class="val" data-speed="${st.id}">${speedReadout(st)}</span></div>
    <div class="speed-labels"><span>${t('f.slow')}</span><span>${t('f.fast')}</span></div></div>`;

const toolsRow = (id) => `<div class="tools-row">
    <button class="btn ghost tiny" data-act="paste" data-id="${id}">${t('f.paste')}</button>
    <button class="btn ghost tiny" data-act="copy"  data-id="${id}">${t('f.copy')}</button>
    <button class="btn ghost tiny" data-act="clear" data-id="${id}">${t('f.clear')}</button>
    <span class="counter" data-count="${id}"></span></div>`;

const xyRow = (st) => `<div class="row" style="margin-top:12px">
    ${fNum(st.id,'x','X',st.x,'',-99999)}${fNum(st.id,'y','Y',st.y,'',-99999)}
    <button class="btn ghost" data-act="capture" data-id="${st.id}">${t('f.capture')}</button>
    <button class="btn ghost" data-act="cursor"  data-id="${st.id}">${t('f.cursor')}</button></div>`;

function editorBody(st) {
  const id = st.id;
  switch (st.type) {

    case 'text':
      return `<div class="card">${toolsRow(id)}
          <textarea data-id="${id}" data-k="value" spellcheck="false"
            placeholder="${t('f.textPlaceholder')}">${esc(st.value)}</textarea></div>
        ${simple() ? speedCard(st) : `<div class="card"><h4>${t('f.timing')}</h4><div class="grid2">
             ${fDur(id,'charDelay',t('f.charDelay'),st.charDelay,t('f.charDelay.h'))}</div></div>`}
        <div class="card"><h4>${t('f.options')}</h4>
          ${fCheck(id,'pressEnter',t('f.pressEnter'),st.pressEnter)}
          ${fCheck(id,'finalEnter',t('f.finalEnter'),st.finalEnter)}</div>`;

    case 'piano':
      return `<div class="card">${toolsRow(id)}
          <textarea data-id="${id}" data-k="value" spellcheck="false"
            placeholder="[sjf6] f j s| f [j7] f">${esc(st.value)}</textarea>
          <p class="note-help" style="margin-top:10px">${t('f.pianoHelp')}</p></div>
        ${simple() ? speedCard(st) : `<div class="card"><h4>${t('f.timing')}</h4><div class="grid2">
             ${fDur(id,'noteMs',t('f.noteMs'),st.noteMs,t('f.noteMs.h'))}
             ${fDur(id,'holdMs',t('f.holdMs'),st.holdMs,t('f.holdMs.h'),1)}
             ${fDur(id,'gapMs',t('f.gapMs'),st.gapMs)}
             ${fDur(id,'barMs',t('f.barMs'),st.barMs)}
             ${fDur(id,'lineMs',t('f.lineMs'),st.lineMs)}</div></div>`}`;

    case 'click':
      return `<div class="card"><h4>${t('f.where')}</h4>
          <div class="grid2">
            ${fSel(id,'button',t('f.button'),st.button,[['left',t('f.left')],['right',t('f.right')],['middle',t('f.middle')]])}
            ${fSel(id,'mode',t('f.mode'),st.mode,[['current',t('f.mode.current')],['xy',t('f.mode.xy')]])}
          </div>
          ${st.mode === 'xy' ? xyRow(st) : ''}
          <div style="margin-top:10px">
            ${fCheck(id,'double',t('f.double'),st.double)}
            ${st.mode === 'xy' ? fCheck(id,'restore',t('f.restore'),st.restore) : ''}</div></div>
        <div class="card"><h4>${t('f.howmany')}</h4><div class="grid2">
            ${fNum(id,'count',t('f.count'),st.count,'',1)}
            ${simple() ? '' : fDur(id,'interval',t('f.interval'),st.interval)}
            ${simple() ? '' : fDur(id,'holdMs',t('f.hold'),st.holdMs === undefined ? 30 : st.holdMs,t('f.hold.h'))}</div></div>
        ${simple() ? speedCard(st) : ''}`;

    case 'delay':
      return `<div class="card"><h4>${t('act.delay')}</h4><div class="grid2">
          ${fDur(id,'ms',t('f.ms'),st.ms,t('f.ms.h'))}</div></div>`;

    case 'key': {
      const opts = KEY_OPTIONS.slice();
      if (st.value && opts.indexOf(st.value) === -1) opts.unshift(st.value);
      return `<div class="card"><h4>${t('act.key')}</h4>
          <div class="grid2">
            <div class="keypick">
              ${fSel(id,'value',t('f.whichKey'),st.value,opts.map(k => [k,k.toUpperCase()]))}
              <button class="btn ghost" data-act="pickkey" data-id="${id}">${t('f.pickKey')}</button>
            </div>
            ${fNum(id,'count',t('f.times'),st.count,'',1)}
            ${simple() ? '' : fDur(id,'interval',t('f.keyInterval'),st.interval)}
            ${simple() ? '' : fDur(id,'holdMs',t('f.hold'),st.holdMs === undefined ? 30 : st.holdMs,t('f.hold.h'))}
          </div></div>
        ${simple() ? speedCard(st) : ''}`;
    }

    case 'combo':
      return `<div class="card"><h4>${t('act.combo')}</h4>
          <label class="field"><span>${t('f.combo')}</span>
            <input type="text" data-id="${id}" data-k="keysText" value="${esc(st.keysText)}" placeholder="ctrl+c">
            <em>${t('f.combo.h')}</em></label></div>`;

    case 'move':
      return `<div class="card"><h4>${t('f.target')}</h4>${xyRow(st)}</div>`;

    case 'scroll':
      return `<div class="card"><h4>${t('act.scroll')}</h4><div class="grid2">
          ${fNum(id,'amount',t('f.amount'),st.amount,t('f.amount.h'),-999)}
          ${fNum(id,'count',t('f.times'),st.count,'',1)}</div></div>`;

    default: return '';
  }
}

/* ================================================================
   7. CIZIM
   ================================================================ */
function renderEditor() {
  const st = cur(), box = $('#editor');
  if (!st) {
    box.innerHTML = `<div class="empty"><div><h2>${t('editor.emptyTitle')}</h2>
      <p>${t('editor.emptyText')}</p></div></div>`;
    return;
  }
  const i = steps().indexOf(st), a = actOf(st);
  box.innerHTML = `
    <div class="ed-head">
      <span class="dot" style="width:9px;height:9px;border-radius:50%;background:${COLORS[catOf(st)]}"></span>
      <div class="ttl">
        <h2>${i + 1}. ${t('act.' + a)}</h2>
        <div class="sub">${t('cat.' + catOf(st))} · ${esc(detailOf(st))}</div>
      </div>
      <div class="ed-actions">
        <button class="btn primary tiny" data-act="playone" data-id="${st.id}">▶ ${t('step.play')}</button>
        <button class="iconbtn" data-act="up"   data-id="${st.id}" title="${t('step.up')}">↑</button>
        <button class="iconbtn" data-act="down" data-id="${st.id}" title="${t('step.down')}">↓</button>
        <button class="iconbtn" data-act="dup"  data-id="${st.id}" title="${t('step.dup')}">⧉</button>
        <button class="iconbtn" data-act="mute" data-id="${st.id}" title="${st.enabled ? t('step.disable') : t('step.enable')}">${st.enabled ? '◉' : '○'}</button>
        <button class="iconbtn del" data-act="del" data-id="${st.id}" title="${t('step.del')}">✕</button>
      </div>
    </div>
    <div class="ed-body">${editorBody(st)}</div>`;
  updateCounter(st.id);
}

function renderRail() {
  const list = steps(), box = $('#rail-list');
  if (!list.length) {
    box.innerHTML = `<div class="rail-empty">${t('rail.empty')}</div>`;
  } else {
    box.innerHTML = list.map((st, i) => {
      const a = actOf(st);
      return `<div class="rail-item ${st.id === prof().sel ? 'sel' : ''} ${st.enabled ? '' : 'off'}"
                   draggable="true" data-act="select" data-id="${st.id}">
          <span class="n">${i + 1}</span>
          <span class="dot" style="background:${COLORS[catOf(st)]}"></span>
          <span class="body2">
            <span class="name">${t('act.' + a)}</span>
            <span class="det">${esc(detailOf(st))}</span>
          </span>
          <span class="tools">
            <button class="iconbtn play" data-act="playone" data-id="${st.id}" title="${t('step.play')}">▶</button>
            <button class="iconbtn del"  data-act="del"     data-id="${st.id}" title="${t('step.del')}">✕</button>
          </span>
        </div>`;
    }).join('');
  }
  $('#step-count').innerHTML =
    `<span>${t('rail.count', { n: list.length })}</span>` +
    (list.length ? `<button class="iconbtn del" id="btn-clear-steps" title="${t('rail.clear')}">🗑</button>` : '');
}

function updateRailRow(id) {
  const st = byId(id);
  const row = document.querySelector(`.rail-item[data-id="${id}"]`);
  if (!st || !row) return;
  row.querySelector('.name').textContent = t('act.' + actOf(st));
  row.querySelector('.det').textContent = detailOf(st);
  row.querySelector('.dot').style.background = COLORS[catOf(st)];
}

function updateCounter(id) {
  const st = byId(id), el = document.querySelector(`[data-count="${id}"]`);
  if (!st || !el) return;
  const v = st.value || '';
  el.textContent = st.type === 'piano'
    ? t('f.notes', { n: sheetStats(v).notes, c: sheetStats(v).chords, ch: v.length })
    : t('f.chars', { n: v.length, l: v ? v.split('\n').length : 0 });
}

function renderRunbar() {
  const c = prof().config, inf = c.repeat === 0;
  $('#runcfg').innerHTML = `
    <label class="rc rc-rep">
      <span>${t('run.repeat')}</span>
      <span class="rc-in">
        ${inf ? `<input type="text" value="∞" disabled class="locked">`
              : `<input type="number" id="rc-repeat" min="1" value="${c.repeat}">`}
        <button id="rc-inf" class="inf-btn ${inf ? 'on' : ''}"
                title="${inf ? t('run.finite') : t('run.infinite')}">∞</button>
      </span>
    </label>
    <label class="rc"><span>${t('run.delay')}</span>
      <span class="rc-in"><input type="number" id="rc-delay" min="0" value="${c.startDelay}"><i>s</i></span></label>
    <label class="rc"><span>${t('run.between')}</span>
      <span class="rc-in"><input type="number" id="rc-loop" min="0" value="${c.loopDelay}"><i>ms</i></span></label>
    <button class="iconbtn" id="rc-more" title="${t('run.more')}">⋯</button>`;
}

function renderAddMenu() {
  $('#add-menu').innerHTML = CATALOG.map(cat =>
    `<div class="cat"><span style="color:${COLORS[cat.id]}">${cat.icon}</span>${t('cat.' + cat.id)}</div>` +
    cat.items.map(a => `<button data-add="${a}"><b>${t('act.' + a)}</b><span>${t('act.' + a + '.d')}</span></button>`).join('')
  ).join('');
}

function renderProfileMenu() {
  $('#profile-menu').innerHTML = ['new','rename','dup','open','save']
    .map(k => `<button data-pm="${k}">${t('profile.' + k)}</button>`).join('') +
    `<button data-pm="del" class="danger">${t('profile.del')}</button>`;
}

function renderStatic() {
  document.documentElement.lang = state.ui.lang || 'tr';
  $('#lbl-profile').textContent = t('top.profile');
  $('#lbl-steps').textContent = t('rail.title');
  $('#btn-add').textContent = t('rail.add');
  $('#btn-record').textContent = t('rec.btn');
  $('#btn-settings').title = t('top.settings');
  $('#set-title').textContent = t('set.title');
  $('#btn-start').innerHTML = `${t('run.start')} <kbd id="kbd-start"></kbd>`;
  $('#btn-stop').innerHTML  = `${t('run.stop')} <kbd id="kbd-stop"></kbd>`;
  document.querySelectorAll('#modeswitch button').forEach(b => {
    b.textContent = t('top.' + b.dataset.mode);
    b.classList.toggle('on', b.dataset.mode === state.ui.mode);
  });
  const tabs = { keys:'set.tab.keys', run:'set.tab.run', look:'set.tab.look', lang:'set.tab.lang', engine:'set.tab.engine' };
  document.querySelectorAll('#settings-tabs button').forEach(b => { b.textContent = t(tabs[b.dataset.tab]); });
  $('#cap-title').textContent = t('cap.title');
  $('#cap-desc').innerHTML = t('cap.desc');
  $('#btn-cancel-capture').textContent = t('cap.cancel');
  $('#key-title').textContent = t('key.title');
  $('#key-desc').innerHTML = t('key.desc');
  $('#prompt-ok').textContent = t('ok');
  $('#prompt-cancel').textContent = t('cancel');
  $('#lang-title').textContent = t('lang.title');
  $('#lang-desc').textContent = t('lang.desc');
  $('#lang-continue').textContent = t('lang.continue');
  $('#tut-skip').textContent = t('tut.skip');
  $('#tut-back').textContent = t('tut.back');
  renderAddMenu(); renderProfileMenu();
}

function renderAll() {
  const b = document.body;
  b.dataset.accent = state.ui.accent;
  b.dataset.theme  = state.ui.theme;
  b.dataset.font   = state.ui.font;
  b.classList.toggle('compact', !!state.ui.compact);
  b.classList.toggle('nohints', !state.ui.hints);
  document.documentElement.style.setProperty('--rail', (state.ui.railW || 250) + 'px');
  $('#profile-select').innerHTML = state.profiles
    .map(p => `<option value="${p.id}" ${p.id === state.activeId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  renderStatic(); renderRail(); renderEditor(); renderRunbar(); renderHotkeyLabels();
  setEngine(engineInfo.ready ? 'on' : 'off',
            engineInfo.ready ? 'engine.ready' : (engineInfo.version === null ? 'engine.searching' : 'engine.none'));
  if (statusKey) setStatusKey(statusKey, statusVars, statusKind);
  if (!$('#settings').hidden) renderSettings();
  save();
}

/* ================================================================
   8. KISAYOLLAR / BAGLAMALAR
   ================================================================ */
const MODES = ['profile','once','toggle','hold','stop','queue'];
const MOUSE_OK = ['middle','x1','x2'];

/* 'key:ctrl+alt+m' -> 'Ctrl + Alt + M' , 'mouse:x1' -> 'Fare düğmesi 4' */
function specLabel(spec) {
  if (!spec) return t('sc.unset');
  if (spec.indexOf('mouse:') === 0) return t('sc.mouse.' + spec.slice(6));
  return spec.slice(4).split('+')
    .map(x => x.length === 1 ? x.toUpperCase() : x.charAt(0).toUpperCase() + x.slice(1))
    .join(' + ');
}

/* tarayici olayindan spec uret */
function specFromKey(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  let k = e.key;
  if (/^F\d{1,2}$/.test(k)) k = k.toLowerCase();
  else if (k === ' ') k = 'space';
  else if (k === 'Escape') return null;
  else if (k.length === 1) k = k.toLowerCase();
  else return null;
  if (!mods.length && !/^f\d+$/.test(k)) return 'NEED_MOD';
  return 'key:' + mods.concat([k]).join('+');
}
function specFromMouse(e) {
  const map = { 1:'middle', 3:'x1', 4:'x2' };
  if (e.button === 0 || e.button === 2) return 'BLOCKED';
  const n = map[e.button];
  return n ? 'mouse:' + n : null;
}
function matchSpec(e, spec) {
  if (!spec || spec.indexOf('key:') !== 0) return false;
  const parts = spec.slice(4).split('+');
  const key = parts[parts.length - 1];
  if (e.ctrlKey !== parts.includes('ctrl')) return false;
  if (e.altKey !== parts.includes('alt')) return false;
  if (e.shiftKey !== parts.includes('shift')) return false;
  const k = (e.key || '').toLowerCase();
  return k === key || (k === ' ' && key === 'space');
}
const pushBindings = () =>
  send({ cmd:'bindings', specs: state.bindings.filter(b => b.enabled !== false).map(b => b.spec) });
function hkLabel(h) {
  return (h || '').replace(/[<>]/g, '').split('+')
    .map(x => x.length === 1 ? x.toUpperCase() : x.charAt(0).toUpperCase() + x.slice(1)).join('+');
}
function renderHotkeyLabels() {
  const on = state.bindings.filter(b => b.enabled !== false);
  const sb = on.find(b => b.mode !== 'stop'), pb = on.find(b => b.mode === 'stop');
  const a = sb ? specLabel(sb.spec) : '—', b = pb ? specLabel(pb.spec) : '—';
  const ks = $('#kbd-start'), kp = $('#kbd-stop');
  if (ks) ks.textContent = a;
  if (kp) kp.textContent = b;
  $('#hotkey-hint').innerHTML = t('top.hint', { start:`<kbd>${esc(a)}</kbd>`, stop:`<kbd>${esc(b)}</kbd>` });
}
function eventToHotkey(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('<ctrl>');
  if (e.altKey) mods.push('<alt>');
  if (e.shiftKey) mods.push('<shift>');
  let k = e.key;
  if (/^F\d{1,2}$/.test(k)) k = '<' + k.toLowerCase() + '>';
  else if (k === ' ') k = '<space>';
  else if (k === 'Escape') return null;
  else if (k.length === 1) k = k.toLowerCase();
  else return null;
  if (!mods.length && !/^<f\d/.test(k)) return 'NEED_MOD';
  return mods.concat([k]).join('+');
}
function matchHotkey(e, spec) {
  const want = (spec || '').split('+');
  const key = want[want.length - 1].replace(/[<>]/g, '');
  if (e.ctrlKey !== want.includes('<ctrl>')) return false;
  if (e.altKey !== want.includes('<alt>')) return false;
  if (e.shiftKey !== want.includes('<shift>')) return false;
  return (e.key || '').toLowerCase() === key.toLowerCase();
}


/* ================================================================
   9. MOTOR
   ================================================================ */
const send = (m) => window.macropad.send(m);

function stepsForRun(list) {
  return list.filter(s => s.enabled !== false).map(s => {
    const o = timedCopy(s);
    if (o.type === 'combo') o.keys = (o.keysText || '').split('+').map(k => k.trim()).filter(Boolean);
    delete o.id; delete o.keysText; delete o.speed;
    return o;
  });
}
function start() {
  if (running) return;
  const list = stepsForRun(steps());
  if (!list.length) { setStatusKey('run.noSteps', null, 'err'); return; }
  const c = prof().config;
  send({ cmd:'start', config:{ startDelay:c.startDelay, repeat:c.repeat, loopDelay:c.loopDelay,
                               focusWindow:c.focusWindow || '', steps:list } });
}
function playOne(id) {
  if (running) return;
  const st = byId(id); if (!st) return;
  send({ cmd:'start', config:{ startDelay: prof().config.startDelay, repeat:1, loopDelay:0,
                               focusWindow: prof().config.focusWindow || '',
                               steps: stepsForRun([Object.assign({}, st, { enabled:true })]) } });
  setStatusKey('run.oneStep', null, 'run');
}
const stop = () => { if (running) send({ cmd:'stop' }); };

let queued = 0, holdSpec = null;

function runBinding(b, override) {
  const p = (b.target && b.target !== 'active')
    ? (state.profiles.find(x => x.id === b.target) || prof()) : prof();
  const list = stepsForRun(p.steps);
  if (!list.length) { setStatusKey('run.noSteps', null, 'err'); return; }
  const c = p.config;
  send({ cmd:'start', config: Object.assign(
    { startDelay:c.startDelay, repeat:c.repeat, loopDelay:c.loopDelay,
      focusWindow:c.focusWindow || '', steps:list }, override || {}) });
}

function onTrigger(spec, phase) {
  state.bindings.filter(b => b.enabled !== false && b.spec === spec).forEach(b => {
    if (b.mode === 'hold') {
      if (phase === 'down') { holdSpec = spec; if (!running) runBinding(b, { repeat:0, startDelay:0 }); }
      else if (holdSpec === spec) { holdSpec = null; stop(); }
      return;
    }
    if (phase !== 'down') return;
    switch (b.mode) {
      case 'stop':   stop(); break;
      case 'toggle': running ? stop() : runBinding(b, { repeat:0 }); break;
      case 'once':   if (!running) runBinding(b, { repeat:1 }); break;
      case 'queue':  if (running) { queued++; setStatusKey('sc.queued', { n:queued }, 'warn'); }
                     else runBinding(b, {}); break;
      default:       if (!running) runBinding(b, {}); break;
    }
  });
}

function setRunning(on) {
  running = on;
  $('#btn-start').disabled = on;
  $('#btn-stop').disabled = !on;
  $('#btn-stop').classList.toggle('armed', on);
}
let statusKey = 'run.ready', statusVars = null, statusKind = '';
function setStatus(text, kind) {
  statusKey = null;                       // motordan gelen ham metin
  $('#status').textContent = text;
  $('#status').className = 'status ' + (kind || '');
}
/* arayuzden gelen durumlar: dil degisince yeniden cevrilebilsin diye
   anahtariyla saklanir */
function setStatusKey(key, vars, kind) {
  statusKey = key; statusVars = vars || null; statusKind = kind || '';
  $('#status').textContent = t(key, vars);
  $('#status').className = 'status ' + (kind || '');
}

function log(text, cls) {
  const el = $('#log'); if (!el) return;
  const d = document.createElement('div');
  d.className = cls || '';
  d.textContent = `[${new Date().toLocaleTimeString('tr-TR', { hour12:false })}] ${text}`;
  el.appendChild(d);
  while (el.childElementCount > 300) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
let logBuffer = [];
function setEngine(cls, key) {
  const p = $('#engine-pill');
  p.className = 'engine-pill ' + (cls || '');
  p.innerHTML = '<i></i>' + t(key);
  const info = $('#enginfo');
  if (info) info.textContent =
    `${t('set.engine.state')}   : ${engineInfo.ready ? t('set.engine.running') : t('set.engine.stopped')}\n` +
    `${t('set.engine.version')}   : ${(engineInfo.version == null || engineInfo.version < 0) ? '-' : engineInfo.version}\n` +
    `${t('set.engine.features')} : ${engineInfo.features.length ? engineInfo.features.join(', ') : '-'}\n` +
    `${t('set.engine.hotkeys')} : ${hkLabel(state.hotkeys.start)} / ${hkLabel(state.hotkeys.stop)}`;
}

window.macropad.onEvent((m) => {
  switch (m.ev) {
    case 'ready':
      engineInfo = { ready:true, version:m.version || 1, features:m.features || [] };
      setEngine('on', 'engine.ready'); log('engine ready v' + engineInfo.version, 'l-ok'); pushBindings();
      /* motor gec de olsa yetisti: onceki hata mesajini birakma */
      if ($('#status').classList.contains('err')) setStatusKey('run.ready');
      break;
    case 'fatal':
      engineInfo = { ready:false, version:-1, features:[] }; setEngine('off', 'engine.none');
      setStatus(m.message, 'err'); log(m.message, 'l-err');
      break;
    case 'status':
      setStatus(m.text, m.kind === 'err' ? 'err' : m.kind === 'warn' ? 'warn'
              : m.kind === 'ok' ? 'ok' : m.kind === 'run' ? 'run' : '');
      break;
    case 'started': setRunning(true); $('#bar').style.width = '0%'; break;
    case 'progress':
      $('#bar').style.width = (m.pct || 0) + '%';
      setStatus(t('run.progress', { loop:m.loop, loops:m.loops === 0 ? '∞' : m.loops,
                                    step:m.step, steps:m.steps, detail:m.detail || '' }), 'run');
      break;
    case 'finished':
      setRunning(false);
      $('#bar').style.width = m.reason === 'done' ? '100%' : '0%';
      setStatus(m.message, m.reason === 'done' ? 'ok' : m.reason === 'error' ? 'err' : 'warn');
      log(m.message, m.reason === 'done' ? 'l-ok' : m.reason === 'error' ? 'l-err' : 'l-warn');
      setTimeout(() => { if (!running) $('#bar').style.width = '0%'; }, 1400);
      if (queued > 0 && m.reason === 'done') {
        queued--;
        setTimeout(() => { if (!running) start(); }, 220);
      } else if (m.reason !== 'done') queued = 0;
      break;
    case 'hotkey':                                   // eski motorlar
      if (m.name === 'start') start();
      if (m.name === 'stop') stop();
      break;
    case 'trigger': onTrigger(m.spec, m.phase); break;
    case 'bindings':
      if (!m.ok) log('binding error: ' + (m.error || ''), 'l-err');
      break;
    case 'capture':
    case 'cursor':
      $('#capture-overlay').hidden = true;
      if (captureTarget) {
        const st = byId(captureTarget);
        if (st) { pushHistory(); st.x = m.x; st.y = m.y; renderEditor(); updateRailRow(st.id); save(); }
        captureTarget = null;
      }
      setStatusKey('cap.got', { x:m.x, y:m.y }, 'ok');
      break;
    case 'rec':
      if (m.kind === 'stopped') finishRecord();
      else if (m.kind === 'error') { recOn = false; $('#rec-live').hidden = true;
                                     setStatus(m.message || 'record error', 'err'); }
      else if (m.kind !== 'started') {
        recBuf.push(m);
        $('#rec-count').textContent = t('rec.captured', { n: recBuf.length });
      }
      break;
    case 'window':
      if (winGrabCb) { winGrabCb(m.title || ''); winGrabCb = null; }
      break;
    case 'windows': {
      winList = (m.list || []).filter(x => x && x !== 'MacroPad');
      const sel = $('#cfg-window-pick');
      if (sel) {
        const cur2 = prof().config.focusWindow || '';
        sel.innerHTML = `<option value="">${esc(t('set.run.window.nosel'))}</option>` +
          winList.map(w => `<option value="${esc(w)}" ${w === cur2 ? 'selected' : ''}>${esc(w)}</option>`).join('');
        if (!winList.length) setStatus(t('set.run.window.empty'), 'warn');
      }
      break;
    }
    case 'log': log(m.text); break;
  }
});

/* ================================================================
   10. KUCUK PENCERELER
   ================================================================ */
let promptCb = null;
function askText(title, value, cb) {
  $('#prompt-title').textContent = title;
  $('#prompt-input').value = value || '';
  $('#prompt-overlay').hidden = false;
  promptCb = cb;
  setTimeout(() => { $('#prompt-input').focus(); $('#prompt-input').select(); }, 30);
}
function closePrompt(ok) {
  const v = $('#prompt-input').value.trim();
  $('#prompt-overlay').hidden = true;
  const cb = promptCb; promptCb = null;
  if (ok && cb && v) cb(v);
}
function toast(text, actionLabel, cb) {
  clearTimeout(toastTimer);
  $('#toast-text').textContent = text;
  const b = $('#toast-action');
  if (actionLabel) { b.hidden = false; b.textContent = actionLabel; b.onclick = () => { $('#toast').hidden = true; cb && cb(); }; }
  else b.hidden = true;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}

/* ================================================================
   11. TIKLAMALAR
   ================================================================ */
document.addEventListener('click', (e) => {
  if (!e.target.closest('#profile-menu') && !e.target.closest('#btn-profile-menu')) $('#profile-menu').hidden = true;
  if (!e.target.closest('#add-menu') && !e.target.closest('#btn-add')) $('#add-menu').hidden = true;

  const add = e.target.closest('[data-add]');
  if (add) {
    pushHistory();
    const st = newStep(add.dataset.add);
    steps().push(st); prof().sel = st.id;
    $('#add-menu').hidden = true;
    renderAll();
    return;
  }
  const pm = e.target.closest('[data-pm]');
  if (pm) { profileAction(pm.dataset.pm); $('#profile-menu').hidden = true; return; }

  const a = e.target.closest('[data-act]');
  if (!a) return;
  const id = a.dataset.id, list = steps(), i = list.findIndex(s => s.id === id), st = list[i];

  switch (a.dataset.act) {
    case 'select': if (e.target.closest('.tools')) return; prof().sel = id; renderAll(); break;
    case 'playone': playOne(id); break;
    case 'up':   if (i > 0) { pushHistory(); list.splice(i - 1, 0, list.splice(i, 1)[0]); renderAll(); } break;
    case 'down': if (i < list.length - 1) { pushHistory(); list.splice(i + 1, 0, list.splice(i, 1)[0]); renderAll(); } break;
    case 'dup':  { pushHistory(); const c = Object.assign({}, st, { id: uid() });
                   list.splice(i + 1, 0, c); prof().sel = c.id; renderAll(); break; }
    case 'mute': pushHistory(); st.enabled = !st.enabled; renderAll(); break;
    case 'del':  deleteStep(id); break;
    case 'capture': captureTarget = id; $('#capture-overlay').hidden = false; send({ cmd:'capture' }); break;
    case 'cursor':  captureTarget = id; send({ cmd:'cursor' }); break;
    case 'copy':  navigator.clipboard.writeText(st.value || ''); setStatusKey('clip.copied', null, 'ok'); break;
    case 'paste': navigator.clipboard.readText().then(x => {
                    pushHistory(); st.value = (st.value || '') + x;
                    renderEditor(); updateRailRow(id); save(); setStatusKey('clip.pasted', null, 'ok');
                  }).catch(() => setStatusKey('clip.failed', null, 'err')); break;
    case 'clear': pushHistory(); st.value = ''; renderEditor(); updateRailRow(id); save(); break;
    case 'pickkey':
      pickKeyFor = id;
      $('#key-title').textContent = t('f.pickKey');
      $('#key-desc').innerHTML = t('f.pickKey.d');
      $('#keycap-preview').textContent = '…';
      $('#keycap-overlay').hidden = false;
      break;
  }
});

function deleteStep(id) {
  const list = steps(), i = list.findIndex(s => s.id === id);
  if (i < 0) return;
  const name = t('act.' + actOf(list[i]));
  pushHistory();
  list.splice(i, 1);
  prof().sel = list.length ? list[Math.min(i, list.length - 1)].id : null;
  renderAll();
  toast(t('step.deleted', { name:name }), t('step.undo'), undo);
}

/* ================================================================
   12. ALAN DEGISIKLIKLERI + DOGRULAMA
   ================================================================ */
function applyField(el) {
  const st = byId(el.dataset.id);
  if (!st) return null;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'number' || el.type === 'range') {
    v = el.value === '' ? 0 : Number(el.value);
    const min = Number(el.dataset.min || 0);
    if (!isFinite(v)) v = min;
    const bad = v < min;
    el.classList.toggle('bad', bad);
    el.title = bad ? t('f.invalid', { min:min }) : '';
    if (bad) v = min;
    if (el.dataset.mul) v = Math.round(v * Number(el.dataset.mul));
  } else v = el.value;
  st[el.dataset.k] = v;
  return st;
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset && el.dataset.id && el.dataset.k) {
    const st = applyField(el); if (!st) return;
    updateRailRow(st.id);
    if (st.type === 'text' || st.type === 'piano') updateCounter(st.id);
    if (el.dataset.k === 'speed') {
      const v = document.querySelector(`[data-speed="${st.id}"]`);
      if (v) v.textContent = speedReadout(st);
    }
    save(); return;
  }
  if (['rc-repeat','rc-delay','rc-loop'].includes(el.id)) {
    const c = prof().config;
    if (el.id === 'rc-repeat') { c.repeat = Math.max(1, +el.value || 1); lastRepeat = c.repeat; }
    if (el.id === 'rc-delay')  c.startDelay = Math.max(0, +el.value || 0);
    if (el.id === 'rc-loop')   c.loopDelay  = Math.max(0, +el.value || 0);
    save(); return;
  }
  if (el.id === 'cfg-window') {
    prof().config.focusWindow = el.value.trim();
    const sel = $('#cfg-window-pick');
    if (sel) sel.value = winList.indexOf(el.value.trim()) !== -1 ? el.value.trim() : '';
    save(); return;
  }
  if (['cfg-start','cfg-repeat','cfg-loop'].includes(el.id)) {
    const c = prof().config;
    c.startDelay = Math.max(0, +$('#cfg-start').value || 0);
    const rep = $('#cfg-repeat');
    if (rep) { c.repeat = Math.max(1, +rep.value || 1); lastRepeat = c.repeat; }
    c.loopDelay  = Math.max(0, +$('#cfg-loop').value || 0);
    renderRunbar(); save();
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'profile-select') { state.activeId = el.value; renderAll(); return; }
  if (!el.dataset || !el.dataset.id || !el.dataset.k) return;
  const st = applyField(el); if (!st) return;
  if (el.dataset.k === 'mode' || el.dataset.k === 'button' || el.dataset.k === 'double') {
    renderEditor(); renderRail();          // aksiyon adi degismis olabilir
  }
  updateRailRow(st.id); save();
});

/* ================================================================
   13. SURUKLE - BIRAK
   ================================================================ */
let dragId = null;
document.addEventListener('dragstart', (e) => {
  const it = e.target.closest('.rail-item'); if (!it) return;
  dragId = it.dataset.id;
  it.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
});
document.addEventListener('dragend', () => {
  dragId = null;
  document.querySelectorAll('.rail-item').forEach(x =>
    x.classList.remove('dragging','drop-before','drop-after'));
});
document.addEventListener('dragover', (e) => {
  if (!dragId) return;
  const it = e.target.closest('.rail-item');
  document.querySelectorAll('.rail-item').forEach(x => x.classList.remove('drop-before','drop-after'));
  if (!it || it.dataset.id === dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const r = it.getBoundingClientRect();
  it.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
});
document.addEventListener('drop', (e) => {
  if (!dragId) return;
  const it = e.target.closest('.rail-item');
  if (!it || it.dataset.id === dragId) return;
  e.preventDefault();
  const list = steps();
  const from = list.findIndex(s => s.id === dragId);
  let to = list.findIndex(s => s.id === it.dataset.id);
  const r = it.getBoundingClientRect();
  if (e.clientY >= r.top + r.height / 2) to++;
  if (from < to) to--;
  if (from === to || from < 0) return;
  pushHistory();
  list.splice(to, 0, list.splice(from, 1)[0]);
  prof().sel = dragId;
  dragId = null;
  renderAll();
});

/* ================================================================
   14. PROFILLER
   ================================================================ */
function profileAction(what) {
  const p = prof();
  if (what === 'new') {
    askText(t('profile.newName'), t('profile.default', { n: state.profiles.length + 1 }), (name) => {
      pushHistory();
      const st = newStep('text');
      const np = { id: uid('p'), name, config:{ startDelay:3, repeat:1, loopDelay:500 }, steps:[st], sel:st.id };
      state.profiles.push(np); state.activeId = np.id; renderAll();
    });
  } else if (what === 'rename') {
    askText(t('profile.renameTitle'), p.name, (name) => { pushHistory(); p.name = name; renderAll(); });
  } else if (what === 'dup') {
    pushHistory();
    const np = JSON.parse(JSON.stringify(p));
    np.id = uid('p'); np.name = p.name + ' ' + t('profile.copySuffix');
    np.steps.forEach(s => s.id = uid());
    np.sel = np.steps.length ? np.steps[0].id : null;
    state.profiles.push(np); state.activeId = np.id; renderAll();
  } else if (what === 'del') {
    if (state.profiles.length === 1) { setStatusKey('profile.lastOne', null, 'warn'); return; }
    pushHistory();
    state.profiles = state.profiles.filter(x => x.id !== p.id);
    state.activeId = state.profiles[0].id; renderAll();
  } else if (what === 'save') {
    window.macropad.saveMacro({ name:p.name, config:p.config, steps:p.steps })
      .then(r => { if (r && r.ok) setStatus(t('profile.saved', { path:r.path }), 'ok'); });
  } else if (what === 'open') {
    window.macropad.openMacro().then(r => {
      if (!r || !r.ok) return;
      const d = r.data || {};
      if (!Array.isArray(d.steps)) return;
      pushHistory();
      const np = { id: uid('p'), name: d.name || 'Macro',
                   config: Object.assign({ startDelay:3, repeat:1, loopDelay:500 }, d.config || {}),
                   steps: d.steps.map(s => Object.assign({ enabled:true, speed:3 }, s, { id: uid() })) };
      np.sel = np.steps.length ? np.steps[0].id : null;
      state.profiles.push(np); state.activeId = np.id; renderAll();
      setStatus(t('profile.opened', { path:r.path }), 'ok');
    });
  }
}

/* ================================================================
   15. AYARLAR
   ================================================================ */
function bindRow(b) {
  const profs = [['active', t('sc.target.active')]]
    .concat(state.profiles.map(p => [p.id, p.name]));
  return `<div class="bind ${b.enabled === false ? 'off' : ''}" data-bind="${b.id}">
      <div class="bind-top">
        <button class="trig" data-bindcap="${b.id}" title="${t('sc.change')}">${esc(specLabel(b.spec))}</button>
        <span class="spacer"></span>
        <button class="iconbtn" data-bindtoggle="${b.id}"
                title="${b.enabled === false ? t('sc.on') : t('sc.off')}">${b.enabled === false ? '○' : '◉'}</button>
        <button class="iconbtn del" data-binddel="${b.id}" title="${t('step.del')}">✕</button>
      </div>
      <div class="bind-grid">
        <label class="field"><span>${t('sc.mode')}</span>
          <select data-bindmode="${b.id}">${MODES.map(mo =>
            `<option value="${mo}" ${mo === b.mode ? 'selected' : ''}>${t('sc.mode.' + mo)}</option>`).join('')}</select>
        </label>
        <label class="field"><span>${t('sc.target')}</span>
          <select data-bindtarget="${b.id}" ${b.mode === 'stop' ? 'disabled' : ''}>${profs.map(([v, n]) =>
            `<option value="${v}" ${v === b.target ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        </label>
      </div>
      <em class="bind-help">${t('sc.mode.' + b.mode + '.d')}</em>
    </div>`;
}

let activeTab = 'keys';

let winList = [];

function renderSettings() {
  const c = prof().config, u = state.ui;
  $('#tabpanes').innerHTML = `
    <div class="pane on" data-pane="keys">
      <h3>${t('set.keys.title')}</h3><p class="muted">${t('set.keys.desc')}</p>
      <div class="binds">${state.bindings.length ? state.bindings.map(bindRow).join('')
                          : `<p class="muted">${t('sc.empty')}</p>`}</div>
      <button class="btn ghost" id="btn-bind-add">${t('sc.add')}</button>
      <p class="muted">${t('set.keys.note')}</p>
      <button class="btn ghost" id="btn-keys-reset">${t('set.keys.reset')} (F6 / F8)</button>
    </div>

    <div class="pane" data-pane="run">
      <h3>${t('set.run.title')}</h3><p class="muted">${t('set.run.desc')}</p>
      <div class="grid2">
        <label class="field"><span>${t('set.run.startDelay')}</span>
          <input type="number" id="cfg-start" min="0" value="${c.startDelay}">
          <em>${t('set.run.startDelay.h')}</em></label>
        <label class="field"><span>${t('set.run.repeat')}</span>
          <span class="rc-in">
            ${c.repeat === 0 ? `<input type="text" value="∞" disabled class="locked">`
                             : `<input type="number" id="cfg-repeat" min="1" value="${c.repeat}">`}
            <button id="cfg-inf" class="inf-btn ${c.repeat === 0 ? 'on' : ''}"
                    title="${c.repeat === 0 ? t('run.finite') : t('run.infinite')}">∞</button>
          </span>
          <em>${t('set.run.repeat.h')}</em></label>
        <label class="field span2"><span>${t('set.run.loop')}</span>
          <input type="number" id="cfg-loop" min="0" value="${c.loopDelay}"></label>
      </div>
      <label class="field"><span>${t('set.run.window')}</span>
        <span class="rc-in">
          <select id="cfg-window-pick">
            <option value="">${t('set.run.window.nosel')}</option>
            ${winList.map(w => `<option value="${esc(w)}" ${w === c.focusWindow ? 'selected' : ''}>${esc(w)}</option>`).join('')}
          </select>
          <button class="btn ghost" id="btn-refresh-windows" title="${t('set.run.window.refresh')}">⟳</button>
        </span>
        <em>${t('set.run.window.pick')}</em></label>
      <label class="field">
        <span class="rc-in">
          <input type="text" id="cfg-window" value="${esc(c.focusWindow || '')}" placeholder="—">
          <button class="btn ghost" id="btn-grab-window">${t('set.run.window.grab')}</button>
        </span>
        <em>${t('set.run.window.manual')} · ${t('set.run.window.h')}</em></label>
    </div>

    <div class="pane" data-pane="look">
      <h3>${t('set.look.theme')}</h3>
      <div class="segmented" id="seg-theme">
        <button data-theme="dark"  class="${u.theme === 'dark' ? 'on' : ''}">${t('set.look.dark')}</button>
        <button data-theme="light" class="${u.theme === 'light' ? 'on' : ''}">${t('set.look.light')}</button>
      </div>
      <h3>${t('set.look.accent')}</h3>
      <div class="swatches" id="swatches">
        ${[['blue','#6c8cff'],['purple','#8b5cf6'],['green','#10b981'],['orange','#f97316'],['pink','#ec4899']]
          .map(([k,c2]) => `<button data-accent="${k}" style="--c:${c2}" class="${u.accent === k ? 'on' : ''}"></button>`).join('')}
      </div>
      <h3>${t('set.look.unit')}</h3>
      <div class="segmented" id="seg-unit">
        <button data-unit="ms" class="${u.timeUnit !== 's' ? 'on' : ''}">${t('set.look.unit.ms')}</button>
        <button data-unit="s"  class="${u.timeUnit === 's' ? 'on' : ''}">${t('set.look.unit.s')}</button>
      </div>
      <h3>${t('set.look.font')}</h3>
      <div class="segmented" id="seg-font">
        ${['sm','md','lg'].map(f => `<button data-font="${f}" class="${u.font === f ? 'on' : ''}">${t('set.look.' + f)}</button>`).join('')}
      </div>
      <label class="check"><input type="checkbox" id="opt-compact" ${u.compact ? 'checked' : ''}>
        <span>${t('set.look.compact')}</span></label>
      <label class="check"><input type="checkbox" id="opt-hints" ${u.hints ? 'checked' : ''}>
        <span>${t('set.look.hints')}</span></label>
    </div>

    <div class="pane" data-pane="lang">
      <h3>${t('set.lang.title')}</h3><p class="muted">${t('set.lang.desc')}</p>
      <div class="lang-list" id="set-lang-list">
        ${LANGS.map(l => `<button data-lang="${l.code}" class="${u.lang === l.code ? 'on' : ''}">
            <span class="fl">${l.flag}</span>${l.name}</button>`).join('')}
      </div>
      <button class="btn ghost" id="btn-show-tutorial">${t('set.lang.tutorial')}</button>
    </div>

    <div class="pane" data-pane="engine">
      <h3>${t('set.engine.title')}</h3>
      <div class="enginfo" id="enginfo"></div>
      <button class="btn ghost" id="btn-restart-engine">${t('set.engine.restart')}</button>
      <h3 style="margin-top:8px">${t('set.engine.log')}</h3>
      <div class="log" id="log"></div>
      <button class="btn ghost" id="btn-clear-log">${t('set.engine.clear')}</button>
    </div>`;

  $('#log').innerHTML = logBuffer.join('');
  selectTab(activeTab);                    // panel yeniden cizilince sekme kaybolmasin
  renderHotkeyLabels();
  setEngine(engineInfo.ready ? 'on' : 'off', engineInfo.ready ? 'engine.ready' : 'engine.none');
}

function openSettings(tab) {
  renderSettings();
  send({ cmd:'windows' });               // acik pencereleri tazele
  $('#settings').hidden = false;
  if (tab) selectTab(tab);
}
function selectTab(name) {
  activeTab = name;
  document.querySelectorAll('#settings-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name));
}

$('#btn-settings').addEventListener('click', () => openSettings());
$('#btn-close-settings').addEventListener('click', () => { $('#settings').hidden = true; });
$('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') $('#settings').hidden = true; });
$('#settings-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (b) selectTab(b.dataset.tab);
});
function toggleInfinite() {
  const c = prof().config;
  if (c.repeat === 0) c.repeat = lastRepeat || 1;
  else { lastRepeat = c.repeat; c.repeat = 0; }
  renderRunbar(); save();
}

$('#runcfg').addEventListener('click', (e) => {
  if (e.target.closest('#rc-more')) { openSettings('run'); return; }
  if (e.target.closest('#rc-inf')) { e.preventDefault(); toggleInfinite(); }
});

/* ayar paneli icindeki tiklamalar (panel her acilista yeniden cizildigi icin delege) */
$('#tabpanes').addEventListener('click', (e) => {
  /* DIKKAT: <body> uzerinde de data-theme / data-accent / data-font var.
     Kapsam vermeden closest() kullanirsak her tiklama body'ye carpiyor,
     bu yuzden secicileri kaba ile sinirliyoruz. */
  const sw = e.target.closest('#swatches [data-accent]');
  if (sw) { state.ui.accent = sw.dataset.accent; renderAll(); return; }
  const th = e.target.closest('#seg-theme [data-theme]');
  if (th) { state.ui.theme = th.dataset.theme; renderAll(); return; }
  const fo = e.target.closest('#seg-font [data-font]');
  if (fo) { state.ui.font = fo.dataset.font; renderAll(); return; }
  const un = e.target.closest('#seg-unit [data-unit]');
  if (un) { state.ui.timeUnit = un.dataset.unit; renderAll(); return; }
  const lg = e.target.closest('#set-lang-list [data-lang]');
  if (lg) { state.ui.lang = lg.dataset.lang; setLang(state.ui.lang); renderAll(); return; }
  const bc = e.target.closest('[data-bindcap]');
  if (bc) { startBindCapture(bc.dataset.bindcap); return; }
  const bt = e.target.closest('[data-bindtoggle]');
  if (bt) {
    const b = state.bindings.find(x => x.id === bt.dataset.bindtoggle);
    if (b) { b.enabled = b.enabled === false; pushBindings(); save(); renderSettings(); renderHotkeyLabels(); }
    return;
  }
  const bd = e.target.closest('[data-binddel]');
  if (bd) {
    state.bindings = state.bindings.filter(x => x.id !== bd.dataset.binddel);
    pushBindings(); save(); renderSettings(); renderHotkeyLabels();
    return;
  }
  if (e.target.closest('#btn-bind-add')) {
    const b = { id: uid('b'), spec:'', mode:'profile', target:'active', enabled:true };
    state.bindings.push(b);
    renderSettings();
    startBindCapture(b.id);
    return;
  }
  if (e.target.closest('#btn-refresh-windows')) {
    e.preventDefault();
    send({ cmd:'windows' });
    return;
  }
  if (e.target.closest('#btn-grab-window')) {
    e.preventDefault();
    let n = 4;
    const box = $('#cfg-window');
    const tick = setInterval(() => {
      n--;
      box.value = t('set.run.window.wait', { n:n });
      if (n > 0) return;
      clearInterval(tick);
      winGrabCb = (title) => {
        prof().config.focusWindow = title;
        box.value = title;
        save();
        setStatus(title ? t('set.run.window.got', { title:title }) : t('set.run.window.none'),
                  title ? 'ok' : 'warn');
      };
      send({ cmd:'window' });
    }, 1000);
    box.value = t('set.run.window.wait', { n:n });
    return;
  }
  if (e.target.closest('#cfg-inf')) {
    e.preventDefault();
    toggleInfinite();
    renderSettings();
    return;
  }
  if (e.target.closest('#btn-keys-reset')) {
    state.bindings = [
      { id: uid('b'), spec:'key:f6', mode:'profile', target:'active', enabled:true },
      { id: uid('b'), spec:'key:f8', mode:'stop',    target:'active', enabled:true }
    ];
    pushBindings(); save(); renderSettings(); renderHotkeyLabels(); return;
  }
  if (e.target.closest('#btn-restart-engine')) {
    logBuffer = []; $('#log').innerHTML = '';
    engineInfo = { ready:false, version:null, features:[] };
    setEngine('', 'engine.searching'); window.macropad.restart(); return;
  }
  if (e.target.closest('#btn-clear-log')) { logBuffer = []; $('#log').innerHTML = ''; return; }
  if (e.target.closest('#btn-show-tutorial')) { $('#settings').hidden = true; startTutorial(); return; }

});
$('#tabpanes').addEventListener('change', (e) => {
  if (e.target.id === 'opt-compact') { state.ui.compact = e.target.checked; renderAll(); return; }
  if (e.target.id === 'opt-hints')   { state.ui.hints   = e.target.checked; renderAll(); return; }
  if (e.target.id === 'cfg-window-pick') {
    prof().config.focusWindow = e.target.value;
    const box = $('#cfg-window');
    if (box) box.value = e.target.value;
    save();
    return;
  }
  const bm = e.target.dataset.bindmode, bg = e.target.dataset.bindtarget;
  if (bm) {
    const b = state.bindings.find(x => x.id === bm);
    if (b) { b.mode = e.target.value; save(); renderSettings(); renderHotkeyLabels(); }
  } else if (bg) {
    const b = state.bindings.find(x => x.id === bg);
    if (b) { b.target = e.target.value; save(); }
  }
});

/* ================================================================
   16. DIL SECIMI (ilk acilis)
   ================================================================ */
let pendingLang = 'tr';
function showLangPicker() {
  pendingLang = state.ui.lang || detectLang();
  setLang(pendingLang);
  renderStatic();
  $('#lang-list').innerHTML = LANGS.map(l =>
    `<button data-pick="${l.code}" class="${l.code === pendingLang ? 'on' : ''}">
       <span class="fl">${l.flag}</span>${l.name}</button>`).join('');
  $('#lang-overlay').hidden = false;
}
$('#lang-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]'); if (!b) return;
  pendingLang = b.dataset.pick;
  setLang(pendingLang);
  renderStatic();
  $('#lang-list').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.pick === pendingLang));
  $('#lang-continue').textContent = t('lang.continue');
  $('#lang-title').textContent = t('lang.title');
  $('#lang-desc').textContent = t('lang.desc');
});
$('#lang-continue').addEventListener('click', () => {
  state.ui.lang = pendingLang;
  state.onboarding.langChosen = true;
  $('#lang-overlay').hidden = true;
  renderAll();
  startTutorial();
});

/* ================================================================
   17. TANITIM TURU
   ================================================================ */
const TUT = [
  { key:'tut.1', sel:null },
  { key:'tut.2', sel:'#rail' },
  { key:'tut.3', sel:'#btn-add' },
  { key:'tut.4', sel:'#profile-box' },
  { key:'tut.5', sel:'#btn-settings' },
  { key:'tut.6', sel:'#runbar' }
];
let tutIndex = 0;

function startTutorial() { tutIndex = 0; $('#tut').hidden = false; drawTut(); }
function endTutorial() {
  $('#tut').hidden = true;
  state.onboarding.tutorialDone = true;
  save();
}
function drawTut() {
  const step = TUT[tutIndex];
  const hole = $('#tut-hole'), card = $('#tut-card');
  const vars = { start: hkLabel(state.hotkeys.start), stop: hkLabel(state.hotkeys.stop) };
  $('#tut-step').textContent = t('tut.step', { n: tutIndex + 1, total: TUT.length });
  $('#tut-title').textContent = t(step.key + '.t');
  $('#tut-desc').innerHTML = t(step.key + '.d', vars);
  $('#tut-back').style.visibility = tutIndex === 0 ? 'hidden' : 'visible';
  $('#tut-next').textContent = tutIndex === TUT.length - 1 ? t('tut.done') : t('tut.next');
  $('#tut-skip').textContent = t('tut.skip');
  $('#tut-back').textContent = t('tut.back');

  const el = step.sel ? document.querySelector(step.sel) : null;
  if (!el) {
    hole.style.cssText = 'width:0;height:0;left:50%;top:50%;box-shadow:0 0 0 9999px rgba(8,10,16,.74);border:0';
    card.style.left = 'calc(50% - 170px)'; card.style.top = 'calc(50% - 90px)';
    return;
  }
  const r = el.getBoundingClientRect(), pad = 6;
  hole.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;` +
    `height:${r.height + pad * 2}px;box-shadow:0 0 0 9999px rgba(8,10,16,.74)`;
  const cw = 340, ch = 200;
  let left = r.right + 16, top = r.top;
  if (left + cw > window.innerWidth - 12) left = Math.max(12, r.left - cw - 16);
  if (left < 12) left = Math.max(12, Math.min(window.innerWidth - cw - 12, r.left));
  if (top + ch > window.innerHeight - 12) top = Math.max(12, window.innerHeight - ch - 12);
  card.style.left = left + 'px'; card.style.top = top + 'px';
}
$('#tut-next').addEventListener('click', () => {
  if (tutIndex === TUT.length - 1) endTutorial();
  else { tutIndex++; drawTut(); }
});
$('#tut-back').addEventListener('click', () => { if (tutIndex > 0) { tutIndex--; drawTut(); } });
$('#tut-skip').addEventListener('click', endTutorial);
window.addEventListener('resize', () => { if (!$('#tut').hidden) drawTut(); });

/* ================================================================
   17b. KAYIT
   ================================================================ */
let recBuf = [], recOpts = {}, recOn = false;
let winGrabCb = null;

function openRecord() {
  $('#rec-title').textContent = t('rec.title');
  $('#rec-desc').innerHTML = t('rec.desc');
  $('#rec-moves-l').textContent = t('rec.moves');
  $('#rec-delays-l').textContent = t('rec.delays');
  $('#rec-replace-l').textContent = t('rec.replace');
  $('#rec-cancel').textContent = t('cancel');
  $('#rec-go').textContent = t('rec.start');
  $('#rec-setup').hidden = false;
}

function beginRecord() {
  recOpts = { moves: $('#rec-moves').checked,
              delays: $('#rec-delays').checked,
              replace: $('#rec-replace').checked };
  $('#rec-setup').hidden = true;
  let n = 3;
  $('#rec-live-title').textContent = t('rec.counting', { n:n });
  $('#rec-count').textContent = '';
  $('#rec-hint').textContent = t('rec.hint');
  $('#rec-stop').textContent = t('rec.stop');
  $('#rec-live').hidden = false;
  const tick = setInterval(() => {
    n--;
    if (n > 0) { $('#rec-live-title').textContent = t('rec.counting', { n:n }); return; }
    clearInterval(tick);
    recBuf = []; recOn = true;
    $('#rec-live-title').textContent = t('rec.live');
    $('#rec-count').textContent = t('rec.captured', { n:0 });
    send({ cmd:'record_start', options:{ stopKey:'f10', moves: recOpts.moves } });
  }, 800);
}

function endRecord() {
  if (!recOn) { $('#rec-live').hidden = true; return; }
  send({ cmd:'record_stop' });
}

/* kaydedilen olaylari adimlara cevir */
function recordToSteps() {
  const out = [];
  let last = null;
  recBuf.forEach(r => {
    if (recOpts.delays && last !== null) {
      const gap = Math.max(0, (r.t || 0) - last);
      if (gap >= 120) {
        const d = newStep('delay'); d.ms = Math.round(gap); out.push(d);
      }
    }
    last = r.t || 0;
    if (r.kind === 'click') {
      const st = newStep(r.button === 'right' ? 'rightclick'
                       : r.button === 'middle' ? 'middleclick' : 'clickmove');
      st.mode = 'xy'; st.x = r.x; st.y = r.y; st.button = r.button; st.count = 1;
      out.push(st);
    } else if (r.kind === 'key') {
      const st = newStep('key'); st.value = r.key; st.count = 1; out.push(st);
    } else if (r.kind === 'combo') {
      const st = newStep('combo'); st.keysText = (r.keys || []).join('+'); out.push(st);
    } else if (r.kind === 'scroll') {
      const st = newStep('scroll'); st.amount = r.amount || -3; st.count = 1; out.push(st);
    } else if (r.kind === 'move') {
      const st = newStep('move'); st.x = r.x; st.y = r.y; out.push(st);
    }
  });
  return out;
}

function finishRecord() {
  recOn = false;
  $('#rec-live').hidden = true;
  const steps2 = recordToSteps();
  if (!steps2.length) { setStatusKey('rec.none', null, 'warn'); return; }
  pushHistory();
  const p = prof();
  if (recOpts.replace) p.steps = steps2;
  else p.steps = p.steps.concat(steps2);
  p.sel = steps2[0].id;
  renderAll();
  setStatusKey('rec.done', { n: steps2.length }, 'ok');
}

$('#rail-list').addEventListener('click', () => {});   /* delege icin yer tutucu */

document.addEventListener('click', (e) => {
  if (!e.target.closest('#btn-clear-steps')) return;
  const n = steps().length;
  if (!n) return;
  pushHistory();
  prof().steps = [];
  prof().sel = null;
  renderAll();
  toast(t('rail.cleared', { n:n }), t('step.undo'), undo);
});

$('#btn-record').addEventListener('click', openRecord);
$('#rec-cancel').addEventListener('click', () => { $('#rec-setup').hidden = true; });
$('#rec-go').addEventListener('click', beginRecord);
$('#rec-stop').addEventListener('click', endRecord);

/* ================================================================
   18. PANEL BOYUTLANDIRMA
   ================================================================ */
(function () {
  const rz = $('#resizer');
  let dragging = false;
  rz.addEventListener('mousedown', (e) => { dragging = true; rz.classList.add('on'); e.preventDefault(); });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(180, Math.min(460, e.clientX));
    state.ui.railW = w;
    document.documentElement.style.setProperty('--rail', w + 'px');
  });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; rz.classList.remove('on'); save(); } });
})();

/* ================================================================
   19. KLAVYE
   ================================================================ */
function startBindCapture(id) {
  capturingKey = id;
  $('#key-title').textContent = t('sc.capture');
  $('#key-desc').innerHTML = t('sc.capture.d');
  $('#keycap-preview').textContent = '…';
  $('#keycap-overlay').hidden = false;
}
function finishBindCapture(spec) {
  const b = state.bindings.find(x => x.id === capturingKey);
  if (!b) { capturingKey = null; $('#keycap-overlay').hidden = true; return; }
  if (state.bindings.some(x => x.id !== b.id && x.spec === spec)) {
    $('#keycap-preview').textContent = t('sc.dup'); return;
  }
  b.spec = spec;
  capturingKey = null;
  $('#keycap-overlay').hidden = true;
  pushBindings(); save(); renderSettings(); renderHotkeyLabels();
}
/* yakalama sirasinda fare dugmesi de kabul edilir */
$('#keycap-overlay').addEventListener('mousedown', (e) => {
  if (!capturingKey) return;
  e.preventDefault();
  const sp = specFromMouse(e);
  if (sp === 'BLOCKED') { $('#keycap-preview').textContent = t('sc.mouse.blocked'); return; }
  if (sp) finishBindCapture(sp);
});
$('#keycap-overlay').addEventListener('contextmenu', (e) => e.preventDefault());
$('#keycap-overlay').addEventListener('auxclick', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  /* adim icin tus secimi (harf, rakam, islev tusu - hepsi serbest) */
  if (pickKeyFor) {
    e.preventDefault();
    if (e.key === 'Escape') { pickKeyFor = null; $('#keycap-overlay').hidden = true; return; }
    if (['Control','Alt','Shift','Meta'].includes(e.key)) return;
    let k = e.key;
    if (/^F\d{1,2}$/.test(k)) k = k.toLowerCase();
    else if (k === ' ') k = 'space';
    else if (k === 'Enter') k = 'enter';
    else if (k === 'Tab') k = 'tab';
    else if (k === 'Backspace') k = 'backspace';
    else if (k === 'Delete') k = 'delete';
    else if (k.startsWith('Arrow')) k = k.slice(5).toLowerCase();
    else if (k.length === 1) k = k.toLowerCase();
    else k = k.toLowerCase();
    const st = byId(pickKeyFor);
    if (st) { pushHistory(); st.value = k; renderEditor(); updateRailRow(st.id); save(); }
    pickKeyFor = null; $('#keycap-overlay').hidden = true;
    return;
  }
  if (capturingKey) {
    e.preventDefault();
    if (e.key === 'Escape') {
      const b = state.bindings.find(x => x.id === capturingKey);
      if (b && !b.spec) state.bindings = state.bindings.filter(x => x.id !== b.id);
      capturingKey = null; $('#keycap-overlay').hidden = true; renderSettings();
      return;
    }
    if (['Control','Alt','Shift','Meta'].includes(e.key)) return;
    const sp = specFromKey(e);
    if (sp === 'NEED_MOD') { $('#keycap-preview').textContent = t('key.needMod'); return; }
    if (!sp) { $('#keycap-preview').textContent = t('key.bad'); return; }
    finishBindCapture(sp);
    return;
  }
  if (!$('#prompt-overlay').hidden) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''));

  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'd' && cur()) {
    e.preventDefault();
    document.querySelector(`[data-act="dup"][data-id="${cur().id}"]`)?.click(); return;
  }
  if (e.key === 'Delete' && !typing && cur()) { e.preventDefault(); deleteStep(cur().id); return; }

  const hit = state.bindings.find(b => b.enabled !== false && matchSpec(e, b.spec));
  if (hit) { e.preventDefault(); onTrigger(hit.spec, 'down'); }
  else if (e.key === 'Escape') {
    if (!$('#tut').hidden) endTutorial();
    else if (!$('#settings').hidden) $('#settings').hidden = true;
    else if (!$('#capture-overlay').hidden) {
      $('#capture-overlay').hidden = true; captureTarget = null; send({ cmd:'cancel_capture' });
    }
  }
});

/* ================================================================
   20. KALAN BAGLANTILAR
   ================================================================ */
$('#btn-start').addEventListener('click', start);
$('#btn-stop').addEventListener('click', stop);
$('#btn-add').addEventListener('click', () => { $('#add-menu').hidden = !$('#add-menu').hidden; });
$('#btn-profile-menu').addEventListener('click', () => { $('#profile-menu').hidden = !$('#profile-menu').hidden; });
window.addEventListener('keyup', (e) => {
  if (capturingKey) return;
  const hit = state.bindings.find(b => b.enabled !== false && b.mode === 'hold' && matchSpec(e, b.spec));
  if (hit) onTrigger(hit.spec, 'up');
});

$('#btn-cancel-capture').addEventListener('click', () => {
  $('#capture-overlay').hidden = true; captureTarget = null; send({ cmd:'cancel_capture' });
});
$('#modeswitch').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]'); if (!b) return;
  state.ui.mode = b.dataset.mode; renderAll();
});
$('#prompt-ok').addEventListener('click', () => closePrompt(true));
$('#prompt-cancel').addEventListener('click', () => closePrompt(false));
$('#prompt-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') closePrompt(true);
  if (e.key === 'Escape') closePrompt(false);
});

/* gunlugu ayar paneli kapaliyken de biriktir */
log = function (text, cls) {
  const line = `<div class="${cls || ''}">[${new Date().toLocaleTimeString('tr-TR', { hour12:false })}] ${esc(text)}</div>`;
  logBuffer.push(line);
  if (logBuffer.length > 300) logBuffer.shift();
  const el = $('#log');
  if (el) { el.insertAdjacentHTML('beforeend', line); el.scrollTop = el.scrollHeight; }
};

/* ================================================================
   21. BASLANGIC
   ================================================================ */
load();
setLang(state.ui.lang || detectLang());
renderAll();
setEngine('', 'engine.searching');
setStatusKey('run.ready');
window.macropad.hello();

if (!state.onboarding.langChosen) {
  showLangPicker();
} else if (!state.onboarding.tutorialDone) {
  setTimeout(startTutorial, 400);
}
