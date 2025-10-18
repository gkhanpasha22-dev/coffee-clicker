/* ====== Ключи и константы ====== */
const SAVE_KEY = 'coffeePrestigeV6';
const SOUND_KEY = 'coffeeSoundEnabled';
const LB_KEY = 'coffeeLeaderboardV1';

const CLICK_BASE = 10, AUTO_BASE = 100;
const CLICK_SCALE = 1.5, AUTO_SCALE = 1.8;
const PRESTIGE_THRESHOLD = 10000;
const PRESTIGE_POINT_RATE = 10000;
const PRESTIGE_POINT_PER = 5;

/* Lifetime бонус: +1% за каждые 50k, с мягкой кривой */
function lifetimeBonusPct(life){
  const tiers = Math.floor(life / 50000);
  const raw = Math.min(tiers, 200);
  const eased = Math.round(raw * 0.9 + Math.sqrt(raw) * 0.5);
  return eased;
}

/* Стоимость: экспонента + +5% каждые 25 уровней */
function costFor(base, scale, level){
  const stepBoost = 1 + Math.floor(level / 25) * 0.05;
  return Math.round(base * Math.pow(scale, level) * stepBoost);
}

/* ====== Состояние ====== */
let beans=0, totalBrewed=0, lifetimeBrewed=0;
let perClick=1, clickLevel=0, autoLevel=0, perSecond=0;
let prestigePoints=0, prestigeBonus=0;
let peakBeans=0, runStart=Date.now();

/* Перманентные апгрейды престижа */
const prestigeUpgrades = [
  {id:'passive', name:'Кофейная алхимия', desc:'+20 % к пассивному доходу', cost:2, bought:false},
  {id:'click',   name:'Мастер клика',    desc:'+10 % к кликовому доходу',   cost:2, bought:false},
  {id:'boost',   name:'Сверхобжарка',    desc:'+1 % очков престижа за сброс', cost:3, bought:false},
];

/* ====== Селекторы ====== */
const $ = s => document.querySelector(s);
const elBeans = $('#beans');
const elPerClick = $('#perClick');
const elPerSecond = $('#perSecond');
const elClickCost = $('#clickCost');
const elAutoCost = $('#autoCost');
const elPrestigeBonus = $('#prestigeBonus');
const elPrestigePoints = $('#prestigePoints');
const elTotalBrewed = $('#totalBrewed');
const elLifetimeBrewed = $('#lifetimeBrewed');
const elLifetimeBonus = $('#lifetimeBonus');
const elRunTime = $('#runTime');
const elPeak = $('#peakBeans');

const btnBrew = $('#brewButton');
const btnUpClick = $('#upgradeClick');
const btnUpAuto = $('#upgradeAuto');
const btnPrestige = $('#prestigeBtn');

const saveHint = $('#saveHint');
const fxLayer = $('#fx-layer');
const toasts = $('#toasts');
const screenFlash = $('#screenFlash');

const soundToggle = $('#soundToggle');
const soundLabel = $('#soundLabel');

const lbBody = $('#lbBody');
const listPrestige = $('#prestigeUpgradeList');

/* ====== Утилиты ====== */
const fmt = n => n < 1000 ? String(n) : n.toLocaleString('ru-RU');
const two = n => n.toString().padStart(2,'0');

function formatDuration(ms){
  const s = Math.floor(ms/1000);
  const m = Math.floor(s/60);
  const h = Math.floor(m/60);
  const ss = s % 60, mm = m % 60;
  return h>0 ? `${h}:${two(mm)}:${two(ss)}` : `${two(mm)}:${two(ss)}`;
}

function getUpgrade(id){ return prestigeUpgrades.find(u=>u.id===id); }
function totalMult(){
  const lifePct = lifetimeBonusPct(lifetimeBrewed);
  return 1 + (prestigeBonus + lifePct) / 100;
}
function clickMult(){ return totalMult() * (getUpgrade('click')?.bought ? 1.10 : 1); }
function autoMult(){  return totalMult() * (getUpgrade('passive')?.bought ? 1.20 : 1); }

/* ====== Звук ====== */
let audioCtx = null;
let soundEnabled = true;

function ensureAudio(){ if(!audioCtx){ try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch{} } }
function playTone({freq=440, type='sine', duration=0.08, vol=0.2}){
  if(!soundEnabled) return; ensureAudio(); if(!audioCtx) return;
  const osc=audioCtx.createOscillator(), g=audioCtx.createGain();
  osc.type=type; osc.frequency.value=freq; g.gain.value=vol; osc.connect(g).connect(audioCtx.destination);
  osc.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+duration); osc.stop(audioCtx.currentTime+duration);
}
const sfx = {
  click: ()=>playTone({freq:520,type:'triangle',duration:0.05,vol:0.15}),
  buy:   ()=>playTone({freq:740,type:'sine',duration:0.10,vol:0.18}),
  toast: ()=>playTone({freq:880,type:'square',duration:0.06,vol:0.12}),
  prest: ()=>[440,660,880,990].forEach((f,i)=>setTimeout(()=>playTone({freq:f,type:'sawtooth',duration:0.12,vol:0.15}),i*80)),
};
function loadSound(){ const raw=localStorage.getItem(SOUND_KEY); soundEnabled = raw===null ? true : raw==='1'; soundToggle.checked=soundEnabled; soundLabel.textContent=`Звук: ${soundEnabled?'Вкл':'Выкл'}`; }
function saveSound(){ localStorage.setItem(SOUND_KEY, soundEnabled?'1':'0'); }

/* ====== FX ====== */
function toast(title, subtitle=''){ const d=document.createElement('div'); d.className='toast'; d.innerHTML=`${title}${subtitle?`<small>${subtitle}</small>`:''}`; toasts.appendChild(d); sfx.toast(); setTimeout(()=>d.remove(),3800); }
function spawnPlus(x,y,amount=1){ const el=document.createElement('div'); el.className='floatText'; el.textContent=`+${amount}`; el.style.left=`${x}px`; el.style.top=`${y}px`; fxLayer.appendChild(el); el.addEventListener('animationend',()=>el.remove()); }
function spawnParticles(x,y,c=10){ for(let i=0;i<c;i++){ const p=document.createElement('div'); p.className='particle'; const a=Math.random()*Math.PI*2, dist=20+Math.random()*40; const dx=Math.cos(a)*dist, dy=Math.sin(a)*dist; p.style.left=`${x}px`; p.style.top=`${y}px`; p.style.setProperty('--dx',`${dx}px`); p.style.setProperty('--dy',`${dy}px`); fxLayer.appendChild(p); p.addEventListener('animationend',()=>p.remove()); } }
function prestigeFlash(){ screenFlash.classList.remove('active'); void screenFlash.offsetWidth; screenFlash.classList.add('active'); }

/* ====== Стоимость ====== */
function clickCost(){ return costFor(CLICK_BASE, CLICK_SCALE, clickLevel); }
function autoCost(){  return costFor(AUTO_BASE,  AUTO_SCALE,  autoLevel); }

/* ====== UI ====== */
function renderPrestigeUpgrades(){
  listPrestige.innerHTML='';
  prestigeUpgrades.forEach(u=>{
    const row=document.createElement('div'); row.className='prestige-up';
    row.innerHTML = `<div><b>${u.name}</b><div class="desc">${u.desc}</div></div>`;
    const b=document.createElement('button');
    b.textContent = u.bought ? 'Куплено' : `Купить (${u.cost} очков)`;
    b.disabled = u.bought || prestigePoints<u.cost;
    b.onclick = ()=>buyPrestigeUpgrade(u);
    row.appendChild(b); listPrestige.appendChild(row);
  });
}
function updateLeaderboard(){
  const rows = loadLB().slice(0,10);
  const lbBody = document.getElementById('lbBody');
  lbBody.innerHTML='';
  rows.forEach((r,i)=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${i+1}</td>
      <td>${fmt(r.points)}</td>
      <td>${formatDuration(r.runMs)}</td>
      <td>${fmt(r.peakBeans)}</td>
      <td>${new Date(r.ts).toLocaleString()}</td>
    `;
    lbBody.appendChild(tr);
  });
}
function updateUI(){
  elBeans.textContent = `☕ ${fmt(beans)}`;
  elPerClick.textContent = fmt(Math.round(perClick * clickMult()));
  elPerSecond.textContent = fmt(Math.round(perSecond * autoMult()));
  elClickCost.textContent = fmt(clickCost());
  elAutoCost.textContent  = fmt(autoCost());
  elPrestigeBonus.textContent = `${prestigeBonus}%`;
  elPrestigePoints.textContent = fmt(prestigePoints);
  elTotalBrewed.textContent = fmt(totalBrewed);
  elLifetimeBrewed.textContent = fmt(lifetimeBrewed);
  elLifetimeBonus.textContent = `${lifetimeBonusPct(lifetimeBrewed)}%`;
  elRunTime.textContent = formatDuration(Date.now()-runStart);
  elPeak.textContent = fmt(peakBeans);

  btnUpClick.disabled = beans < clickCost();
  btnUpAuto.disabled  = beans < autoCost();
  btnPrestige.disabled = totalBrewed < PRESTIGE_THRESHOLD;

  renderPrestigeUpgrades();
  updateLeaderboard();
}

/* ====== Игровая логика ====== */
function onBrew(ev){
  const rect = btnBrew.getBoundingClientRect();
  const x = ev?.clientX ?? rect.left + rect.width/2;
  const y = ev?.clientY ?? rect.top  + rect.height/2;

  const gain = Math.round(perClick * clickMult());
  beans += gain; totalBrewed += gain; lifetimeBrewed += gain;
  if (beans > peakBeans) peakBeans = beans;

  spawnPlus(x,y,gain); spawnParticles(x,y,10); sfx.click(); updateUI();
}
function onBuyClick(){
  const cost = clickCost(); if (beans < cost) return;
  beans -= cost; clickLevel++; perClick++;
  sfx.buy(); toast('🔧 Улучшение', '+1 к клику'); updateUI();
}
function onBuyAuto(){
  const cost = autoCost(); if (beans < cost) return;
  beans -= cost; autoLevel++; perSecond++;
  sfx.buy(); toast('🤖 Автоматизация', '+1 зерно/сек'); updateUI();
}

function prestigeGainFor(total){
  let gained = Math.floor(total / PRESTIGE_POINT_RATE);
  if (getUpgrade('boost')?.bought) gained = Math.ceil(gained * 1.01);
  return gained;
}
function onPrestige(){
  if (totalBrewed < PRESTIGE_THRESHOLD) return;
  const gained = prestigeGainFor(totalBrewed);
  prestigePoints += gained;
  prestigeBonus = prestigePoints * PRESTIGE_POINT_PER;

  addLB({ points:gained, runMs:Date.now()-runStart, peakBeans, ts:Date.now() });

  prestigeFlash(); sfx.prest(); toast('⚡ Престиж!', `Получено ${gained} очк.`);

  beans=0; totalBrewed=0; perClick=1; clickLevel=0; autoLevel=0; perSecond=0;
  peakBeans=0; runStart=Date.now();

  updateUI(); save();
}
function buyPrestigeUpgrade(u){
  if (u.bought || prestigePoints < u.cost) return;
  prestigePoints -= u.cost; u.bought = true;
  sfx.buy(); toast('✅ Покупка', `«${u.name}» активна`);
  updateUI(); save();
}

/* ====== Лидерборд ====== */
function loadLB(){
  try{ const raw=localStorage.getItem(LB_KEY); const arr = raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; }catch{ return []; }
}
function saveLB(arr){ try{ localStorage.setItem(LB_KEY, JSON.stringify(arr)); }catch{} }
function addLB(entry){
  const arr = loadLB(); arr.push(entry);
  arr.sort((a,b)=> b.points - a.points || a.runMs - b.runMs);
  saveLB(arr);
}

/* ====== Сейвы ====== */
function getState(){
  return { beans,totalBrewed,lifetimeBrewed,perClick,clickLevel,autoLevel,perSecond,prestigePoints,prestigeBonus,prestigeUpgrades };
}
function setState(d){
  beans = d.beans||0; totalBrewed = d.totalBrewed||0; lifetimeBrewed = d.lifetimeBrewed||0;
  perClick = d.perClick||1; clickLevel = d.clickLevel||0; autoLevel = d.autoLevel||0; perSecond = d.perSecond||0;
  prestigePoints = d.prestigePoints||0; prestigeBonus = d.prestigeBonus||0;
  if(Array.isArray(d.prestigeUpgrades)){ d.prestigeUpgrades.forEach(s=>{ const u=prestigeUpgrades.find(x=>x.id===s.id); if(u) u.bought=!!s.bought; }); }
}
function save(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(getState())); saveHint.textContent='💾 Сохранено'; setTimeout(()=>saveHint.textContent='',1500); }catch{} }
function load(){ try{ const raw=localStorage.getItem(SAVE_KEY); if(!raw) return; setState(JSON.parse(raw)); }catch{} }
function fullReset(){
  if(!confirm('Полный сброс всех данных (включая таблицу лидеров)?')) return;
  localStorage.removeItem(SAVE_KEY); localStorage.removeItem(LB_KEY); location.reload();
}

/* ====== Тики ====== */
setInterval(()=>{
  if(perSecond>0){
    const gain = Math.round(perSecond * autoMult());
    beans += gain; totalBrewed += gain; lifetimeBrewed += gain;
    if (beans > peakBeans) peakBeans = beans;
    updateUI();
  }
}, 1000);
setInterval(()=>{ elRunTime.textContent = formatDuration(Date.now()-runStart); }, 1000);
setInterval(save, 5000);

/* ====== События ====== */
btnBrew.addEventListener('click', e=>{ ensureAudio(); onBrew(e); });
btnBrew.addEventListener('touchstart', e=>{ ensureAudio(); const t=e.touches[0]; onBrew({clientX:t.clientX,clientY:t.clientY}); }, {passive:true});
btnUpClick.onclick = onBuyClick;
btnUpAuto.onclick  = onBuyAuto;
btnPrestige.onclick= onPrestige;
document.getElementById('btnSave').onclick = save;
document.getElementById('btnReset').onclick = fullReset;

soundToggle.addEventListener('change', ()=>{ soundEnabled = soundToggle.checked; soundLabel.textContent=`Звук: ${soundEnabled?'Вкл':'Выкл'}`; localStorage.setItem(SOUND_KEY, soundEnabled?'1':'0'); });

/* ====== Init ====== */
(function init(){
  const raw = localStorage.getItem(SOUND_KEY);
  soundEnabled = raw===null ? true : raw==='1';
  soundToggle.checked = soundEnabled;
  soundLabel.textContent = `Звук: ${soundEnabled ? 'Вкл' : 'Выкл'}`;
  load(); runStart = Date.now(); updateUI();
})();
