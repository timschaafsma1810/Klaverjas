import { ConvexClient } from "convex/browser";
import { api as _api } from "../convex/_generated/api";

// ══════════════════════════════════════════
//  TOEGANGSCODE
// ══════════════════════════════════════════
const ACCESS_CODE='klaverbassie';
function checkAccessCode(){
  const val=(document.getElementById('access-input')?.value||'').trim().toLowerCase();
  if(val===ACCESS_CODE){
    localStorage.setItem('kj_access','1');
    document.getElementById('access-gate').style.display='none';
  } else {
    document.getElementById('access-error').style.display='block';
    document.getElementById('access-input').value='';
    document.getElementById('access-input').focus();
  }
}
(function initAccessGate(){
  const gate=document.getElementById('access-gate');
  if(!gate) return;
  if(localStorage.getItem('kj_access')==='1'){
    gate.style.display='none';
  } else {
    gate.style.display='flex';
    setTimeout(()=>document.getElementById('access-input')?.focus(),100);
  }
})();

// ══════════════════════════════════════════
//  CONVEX SETUP
// ══════════════════════════════════════════
const _convexUrl = import.meta.env.VITE_CONVEX_URL;
let _client;
let _convexReady = false;

if (!_convexUrl) {
  console.error('VITE_CONVEX_URL niet ingesteld! Maak een .env.local bestand aan.');
  document.body.innerHTML = '<div style="color:white;padding:40px;font-family:sans-serif;background:#163d24;min-height:100vh"><h2>⚙️ Nog even instellen...</h2><p style="margin-top:12px">Voer in de terminal uit: <code style="background:rgba(0,0,0,.3);padding:4px 8px;border-radius:4px">npx convex dev</code><br><br>Kopieer daarna de URL naar een bestand <code>.env.local</code> in de map klaverjas.</p></div>';
} else {
  _client = new ConvexClient(_convexUrl);
}


// ══════════════════════════════════════════
//  DATA & STORAGE
// ══════════════════════════════════════════
let players=[];
let games=[];
let current=null;
let tournaments=[];

async function saveAll(){
  if(!_convexReady) return;
  try {
    await Promise.all([
      _client.mutation(_api.data.saveData,{key:'kj_players',value:JSON.stringify(players)}),
      _client.mutation(_api.data.saveData,{key:'kj_games',value:JSON.stringify(games)}),
      _client.mutation(_api.data.saveData,{key:'kj_tournaments',value:JSON.stringify(tournaments)}),
    ]);
  } catch(e){ console.error('Opslaan mislukt:',e); }
}

// Recalculate per-player aggregated stats from all stored games.
function recalcPlayerStats(){
  // Reset all aggregated fields
  players.forEach(p=>{
    p.games=0; p.wins=0; p.losses=0; p.draws=0;
    p.rounds=0; p.totalScore=0; p.highScore=0;
    p.nat=0; p.verz=0; p.pit=0;
    p.natAsMaker=0; p.pitAsMaker=0; p.verzAsMaker=0;
    p.roundsPlayed=0; p.roundsKaap=0;
  });
  games.forEach(g=>{
    if(g.active) return;
    const finalWij=(typeof g.finalWij==='number')?g.finalWij:g.scoreWij;
    const finalZij=(typeof g.finalZij==='number')?g.finalZij:g.scoreZij;
    const wijWon=finalWij>finalZij;
    const draw=finalWij===finalZij;
    function countSp(tag){return g.rounds.filter(r=>r.special&&r.special.includes(tag)).length;}
    const allWijIds=[...g.wij,...(g.wijBench||[])];
    const allZijIds=[...g.zij,...(g.zijBench||[])];
    [...allWijIds,...allZijIds].forEach(pid=>{
      const p=getPlayer(pid);if(!p) return;
      const isWij=allWijIds.includes(pid);
      p.games++; p.rounds+=g.rounds.length;
      if(draw) p.draws++;
      else if((isWij&&wijWon)||(!isWij&&!wijWon)) p.wins++;
      else p.losses++;
      const myScore=isWij?finalWij:finalZij;
      p.totalScore+=myScore;
      if(myScore>p.highScore) p.highScore=myScore;
      if(isWij){p.nat+=countSp('NAT WIJ');p.verz+=countSp('VERZ WIJ');p.pit+=countSp('PIT WIJ');}
      else{p.nat+=countSp('NAT ZIJ');p.verz+=countSp('VERZ ZIJ');p.pit+=countSp('PIT ZIJ');}
    });
    g.rounds.forEach(r=>{
      const makerId=r.spelWij||r.spelZij;
      if(makerId){
        const pp=getPlayer(+makerId);
        if(pp){
          pp.roundsPlayed++;
          if(r.uitId&&String(makerId)!==String(r.uitId)) pp.roundsKaap++;
          if(r.spelWij){
            if(r.special&&r.special.includes('NAT WIJ')) pp.natAsMaker++;
            if(r.special&&r.special.includes('PIT WIJ')) pp.pitAsMaker++;
          } else {
            if(r.special&&r.special.includes('NAT ZIJ')) pp.natAsMaker++;
            if(r.special&&r.special.includes('PIT ZIJ')) pp.pitAsMaker++;
          }
        }
      }
      // Verz: gebruik verzPlayerId als beschikbaar (kan afwijken van de maker)
      if(r.special&&r.special.includes('VERZ')){
        const vId=r.verzPlayerId||r.spelWij||r.spelZij;
        if(vId){const vp=getPlayer(+vId);if(vp) vp.verzAsMaker++;}
      }
    });
  });
  // Geen saveAll() hier — voorkomt Convex-lus en geflicker
}

// Auto-save on unload
window.addEventListener('beforeunload',()=>{if(current&&current.active) saveAll()});

// ══════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════
// Voorkom dat Safari automatisch scrollposities herstelt bij pushState/popState
if('scrollRestoration' in history) history.scrollRestoration='manual';

function _scrollTop(){
  window.scrollTo(0,0);
  document.documentElement.scrollTop=0;
  document.body.scrollTop=0;
}
function switchView(name, pushHistory=true){
  const already=document.getElementById('view-'+name)?.classList.contains('active');
  if(!already){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    const viewEl=document.getElementById('view-'+name);
    const navEl=document.getElementById('nav-'+name);
    if(viewEl) viewEl.classList.add('active');
    if(navEl) navEl.classList.add('active');
    if(pushHistory) history.pushState({view:name},'','/'+name);
  }
  if(name==='home') renderHome();
  if(name==='players') renderPlayers();
  if(name==='history') renderHistory();
  if(name==='game') renderGame();
  if(name==='stats') renderStats();
  if(name==='toernooi') renderToernooi?.();
  _scrollTop();
  requestAnimationFrame(_scrollTop);
}
window.addEventListener('popstate',e=>{
  const name=(e.state&&e.state.view)||'home';
  switchView(name, false);
});
// On first load, set initial history state based on URL or default to home
(function(){
  const path=location.pathname.replace('/','').split('/')[0]||'home';
  const valid=['home','game','players','stats','history','toernooi'];
  const initial=valid.includes(path)?path:'home';
  history.replaceState({view:initial},'','/'+initial);
})();

// ══════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════
let _jagenTimer=null;
function showJagenToast(msg){
  const t=document.getElementById('jagen-toast');
  if(!t) return;
  if(_jagenTimer) clearTimeout(_jagenTimer);
  t.textContent=msg;
  t.classList.add('show');
  _jagenTimer=setTimeout(()=>t.classList.remove('show'),4000);
}

function showToast(msg,err=false){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='show'+(err?' error':'');
  clearTimeout(t._tid);t._tid=setTimeout(()=>t.className='',2400);
}

// ══════════════════════════════════════════
//  MODALS
// ══════════════════════════════════════════
let _modalJustClosed=false;
function openModal(id){document.getElementById(id).classList.add('open')}
function closeModal(id){
  document.getElementById(id).classList.remove('open');
  _modalJustClosed=true;
  setTimeout(()=>{_modalJustClosed=false;},350);
  if(id==='modal-verlies-video'){
    const vid=document.getElementById('verlies-video-player');
    if(vid){vid.pause();vid.currentTime=0;}
  }
}
document.querySelectorAll('.modal-overlay').forEach(o=>{
  o.addEventListener('click',e=>{if(e.target===o){closeModal(o.id);}});
});
function doConfirm(title,msg,cb){
  document.getElementById('confirm-title').textContent=title;
  document.getElementById('confirm-msg').textContent=msg;
  document.getElementById('confirm-yes').onclick=()=>{closeModal('modal-confirm');cb()};
  openModal('modal-confirm');
}

// ══════════════════════════════════════════
//  SOUND ENGINE — <audio> elementen (bypassen iOS silent switch)
// ══════════════════════════════════════════
const _SOUNDS={
  '/sounds/nat.mp3': null,
  '/sounds/verz.mp3': null,
  '/sounds/pit.mp3': null,
  '/sounds/jagen.mp3': null,
};

// Maak <audio> elementen aan en voeg toe aan DOM
(function _initAudioEls(){
  Object.keys(_SOUNDS).forEach(url=>{
    const el=document.createElement('audio');
    el.src=url;
    el.preload='auto';
    el.setAttribute('playsinline','');
    document.body.appendChild(el);
    _SOUNDS[url]=el;
    el.load(); // zorg dat elk element altijd vanaf het begin start
  });
})();

// Bij eerste aanraking: unlock alle audio-elementen (iOS vereist user gesture)
let _audioUnlocked=false;
function _unlockAudio(){
  if(_audioUnlocked) return;
  _audioUnlocked=true;
  Object.values(_SOUNDS).forEach(el=>{
    el.volume=0;
    el.currentTime=0;
    el.play().then(()=>{ el.pause(); el.currentTime=0; el.volume=1; }).catch(()=>{ el.volume=1; });
  });
}
document.addEventListener('touchstart',_unlockAudio,{passive:true,once:true});
document.addEventListener('click',_unlockAudio,{once:true});
let _blockSubmit=false;
window.addEventListener('pageshow',(e)=>{
  if(!e.persisted) return; // alleen bij bfcache-herstel
  // Blokkeer submitRound voor 1,2s — bevroren setTimeout timers vallen anders direct af
  _blockSubmit=true;
  setTimeout(()=>{_blockSubmit=false;},1200);
  // Audio volledig resetten
  Object.values(_SOUNDS).forEach(el=>{el.pause();el.currentTime=0;el.load();});
  // Formuliervelden en stale special-flags wissen
  ['input-wij','input-zij','input-roem-wij','input-roem-zij'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.value='';
    delete el.dataset.special;
    delete el.dataset.natTeam;
  });
});

function playAudioFile(url,vol=1.0){
  const el=_SOUNDS[url];
  if(!el) return;
  el.volume=vol;
  el.currentTime=0;
  el.play().catch(()=>{});
}

// ── Geluid voorkeur ──────────────────────
let _soundEnabled=localStorage.getItem('kj_sound')!=='0';
function toggleSound(){
  _soundEnabled=!_soundEnabled;
  localStorage.setItem('kj_sound',_soundEnabled?'1':'0');
  const btn=document.getElementById('btn-sound-toggle');
  if(btn) btn.textContent=_soundEnabled?'🔔':'🔇';
}
// Init knop-icoon direct
document.addEventListener('DOMContentLoaded',()=>{
  const btn=document.getElementById('btn-sound-toggle');
  if(btn) btn.textContent=_soundEnabled?'🔔':'🔇';
});

function playWaterSound(){ if(_soundEnabled) playAudioFile('/sounds/nat.mp3',0.9); }
function playVerzSound(){ if(_soundEnabled) playAudioFile('/sounds/verz.mp3',1.0); }

function playDestructionSound(){
  if(_soundEnabled) playAudioFile('/sounds/pit.mp3',0.95);
}
function _playDestructionFallback(){
  try{
    const ctx=getAudioCtx();
    const now=ctx.currentTime;
    const master=ctx.createGain();
    master.gain.value=0.7;
    master.connect(ctx.destination);

    // Sub-bass boom: 80Hz → 25Hz over 1.5s
    const boom=ctx.createOscillator();
    const boomGain=ctx.createGain();
    boom.type='sine';
    boom.frequency.setValueAtTime(80,now);
    boom.frequency.exponentialRampToValueAtTime(25,now+1.5);
    boomGain.gain.setValueAtTime(0.001,now);
    boomGain.gain.exponentialRampToValueAtTime(1.0,now+0.01);
    boomGain.gain.exponentialRampToValueAtTime(0.001,now+1.5);
    boom.connect(boomGain);boomGain.connect(master);
    boom.start(now);boom.stop(now+1.5);

    // Mid rumble: 140Hz → 40Hz
    const rumble=ctx.createOscillator();
    const rumbleGain=ctx.createGain();
    rumble.type='sawtooth';
    rumble.frequency.setValueAtTime(140,now);
    rumble.frequency.exponentialRampToValueAtTime(40,now+0.8);
    rumbleGain.gain.setValueAtTime(0.001,now);
    rumbleGain.gain.exponentialRampToValueAtTime(0.5,now+0.005);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001,now+0.8);
    rumble.connect(rumbleGain);rumbleGain.connect(master);
    rumble.start(now);rumble.stop(now+0.8);

    // White noise burst (explosion crunch)
    const bufSize=ctx.sampleRate*0.4;
    const noiseBuf=ctx.createBuffer(1,bufSize,ctx.sampleRate);
    const noiseData=noiseBuf.getChannelData(0);
    for(let i=0;i<bufSize;i++) noiseData[i]=(Math.random()*2-1)*Math.pow(1-i/bufSize,2);
    const noise=ctx.createBufferSource();
    noise.buffer=noiseBuf;
    const noiseFilter=ctx.createBiquadFilter();
    noiseFilter.type='bandpass';
    noiseFilter.frequency.value=300;
    noiseFilter.Q.value=0.8;
    const noiseGain=ctx.createGain();
    noiseGain.gain.setValueAtTime(0.6,now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001,now+0.4);
    noise.connect(noiseFilter);noiseFilter.connect(noiseGain);noiseGain.connect(master);
    noise.start(now);

    // Crackle layer: 3 quick pops
    [0,0.06,0.14].forEach(t=>{
      const pop=ctx.createOscillator();
      const popGain=ctx.createGain();
      pop.type='square';
      pop.frequency.setValueAtTime(200,now+t);
      pop.frequency.exponentialRampToValueAtTime(50,now+t+0.12);
      popGain.gain.setValueAtTime(0.001,now+t);
      popGain.gain.exponentialRampToValueAtTime(0.35,now+t+0.005);
      popGain.gain.exponentialRampToValueAtTime(0.001,now+t+0.12);
      pop.connect(popGain);popGain.connect(master);
      pop.start(now+t);pop.stop(now+t+0.12);
    });
  }catch(e){}
}

// ══════════════════════════════════════════
//  FX ANIMATIONS
// ══════════════════════════════════════════
function showNatFX(){
  playWaterSound();
  const fx=document.getElementById('fx-overlay');
  fx.style.display='flex';
  fx.innerHTML='<div class="nat-splash">💧</div>';
  // add droplets
  for(let i=0;i<6;i++){
    const d=document.createElement('div');
    d.className='nat-drop';
    d.style.left=Math.random()*80+10+'%';
    d.style.top=Math.random()*60+20+'%';
    d.style.animationDelay=Math.random()*0.4+'s';
    d.textContent='💧';
    fx.appendChild(d);
  }
  fx.style.background='rgba(52,152,219,0.15)';
  document.body.style.animation='shake 0.4s ease 2';
  setTimeout(()=>{fx.style.display='none';fx.innerHTML='';document.body.style.animation='';},2000);
}

function showVerzFX(){
  playVerzSound();
  const fx=document.getElementById('fx-overlay');
  fx.style.display='flex';
  fx.style.background='rgba(41,128,185,0.18)';
  fx.innerHTML=`
    <div style="font-family:'Playfair Display',serif;font-size:52px;font-weight:900;color:#3498db;text-shadow:0 0 30px rgba(52,152,219,.8);animation:natSplash .5s ease-out">VERZ!</div>
    <div style="font-size:14px;color:rgba(52,152,219,.8);margin-top:8px;font-style:italic">Verzaakt</div>`;
  setTimeout(()=>{fx.style.display='none';fx.innerHTML='';},2200);
}

function showPitFX(){
  playDestructionSound();
  const fx=document.getElementById('fx-overlay');
  fx.style.display='flex';
  fx.style.background='rgba(155,89,182,0.15)';
  fx.innerHTML=`
    <div class="pit-boom">💥</div>
    <div style="font-family:'Playfair Display',serif;font-size:32px;font-weight:900;color:#c39bd3;margin-top:6px;animation:boom .6s ease both;letter-spacing:2px">PIT!</div>
    <div style="font-size:13px;color:rgba(245,240,232,.6);margin-top:6px;animation:boom .8s .4s ease both">PIT gespeeld! 🟣</div>`;
  setTimeout(()=>{fx.style.display='none';fx.innerHTML='';fx.style.background='';},2400);
}

function showRookPauze(){
  openModal('modal-rook');
}

function showWisselReminder(takkieNum){
  const g=current;if(!g) return;
  const hasBench=((g.wijBench||[]).length+(g.zijBench||[]).length)>0;
  if(!hasBench) return;
  const el=document.getElementById('wissel-reminder-content');
  if(el){
    const wijBenchNamen=(g.wijBench||[]).map(id=>getPlayer(id)?.name||'?').join(', ');
    const zijBenchNamen=(g.zijBench||[]).map(id=>getPlayer(id)?.name||'?').join(', ');
    let html=`<div style="font-size:13px;color:rgba(245,240,232,.6);margin-bottom:14px">Takkie ${takkieNum} is erop — wil je wisselen?</div>`;
    if((g.wijBench||[]).length>0) html+=`<div style="font-size:12px;color:rgba(245,240,232,.5);margin-bottom:4px">🟢 Wij bank: <b style="color:var(--cream)">${wijBenchNamen}</b></div>`;
    if((g.zijBench||[]).length>0) html+=`<div style="font-size:12px;color:rgba(245,240,232,.5)">🔴 Zij bank: <b style="color:var(--cream)">${zijBenchNamen}</b></div>`;
    el.innerHTML=html;
  }
  openModal('modal-wissel-reminder');
}

function showVerliesVideo(teamNaam){
  document.getElementById('verlies-team-naam').textContent=teamNaam+' — minder dan 1000 punten! 😂';
  openModal('modal-verlies-video');
  const vid=document.getElementById('verlies-video-player');
  if(vid){vid.currentTime=0;vid.play().catch(()=>{});}
}

// ══════════════════════════════════════════
//  PLAYERS
// ══════════════════════════════════════════
function getPlayer(id){return players.find(p=>p.id==id)}

function addPlayer(){
  const name=document.getElementById('inp-player-name').value.trim();
  if(!name) return showToast('Voer een naam in',true);
  if(players.find(p=>p.name.toLowerCase()===name.toLowerCase())) return showToast('Naam bestaat al',true);
  players.push({id:Date.now(),name,created:new Date().toISOString(),photo:null,
    games:0,wins:0,losses:0,draws:0,nat:0,verz:0,pit:0,
    totalScore:0,highScore:0,rounds:0,roundsPlayed:0,roundsKaap:0});
  saveAll();
  document.getElementById('inp-player-name').value='';
  closeModal('modal-add-player');
  renderPlayers();showToast('✓ '+name+' toegevoegd!');
}

function openAddPlayerModal(){openModal('modal-add-player')}

function renderPlayers(){
  const el=document.getElementById('players-list');
  if(!players.length){
    el.innerHTML=`<div class="empty"><div class="empty-icon">👥</div><div class="empty-text">Nog geen spelers</div><div class="empty-sub">Voeg spelers toe om te beginnen</div></div>`;
    return;
  }
  el.innerHTML=players.map(p=>{
    const wr=p.games?Math.round(p.wins/p.games*100):0;
    const badge=p.games===0?`<span class="neutral-badge">Nieuw</span>`:
      wr>=50?`<span class="win-badge">${wr}% gewonnen</span>`:`<span class="loss-badge">${wr}% gewonnen</span>`;
    const avImg=p.photo?`<img src="${p.photo}" alt="">`:`${p.name[0].toUpperCase()}`;
    const form=getPlayerForm(p.id);
    const trend=trendBadge(form.streak,form.streakType);
    const formRow=form.last5.length?`<div style="display:flex;gap:3px;margin-top:5px">${formBadges(form.last5)}${trend?`<span style="margin-left:4px;font-size:11px;align-self:center">${trend}</span>`:''}</div>`:'';
    const flame=form.streak>=3&&form.streakType==='W'?' 🔥':'';
    return `<div class="player-tile" onclick="openProfile(${p.id})" style="padding:14px 16px">
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div class="avatar" style="width:56px;height:56px;font-size:20px;flex-shrink:0">${avImg}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span class="player-name" style="font-size:16px">${p.name}${flame}</span>
            ${badge}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:12px;color:rgba(245,240,232,.75);margin-bottom:8px">
            <span>🏆 ${p.wins}× gewonnen</span>
            <span>💀 ${p.losses}× verloren</span>
            <span>💧 ${p.nat}× nat</span>
            <span>🔵 ${p.verz||0}× verzaakt</span>
            <span>💥 ${p.pit||0}× pit</span>
          </div>
          ${form.last5.length?`<div style="display:flex;gap:3px">${formBadges(form.last5)}</div>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
//  FORM & TREND HELPER
// ══════════════════════════════════════════
function getPlayerForm(pid){
  const allWijFn=g=>[...g.wij,...(g.wijBench||[])];
  const pg=games
    .filter(g=>!g.active&&(allWijFn(g).includes(pid)||[...g.zij,...(g.zijBench||[])].includes(pid)))
    .sort((a,b)=>new Date(a.date)-new Date(b.date));
  const results=pg.map(g=>{
    const isWij=allWijFn(g).includes(pid);
    const fw=typeof g.finalWij==='number'?g.finalWij:g.scoreWij;
    const fz=typeof g.finalZij==='number'?g.finalZij:g.scoreZij;
    if(fw===fz) return 'G';
    return (isWij?fw>fz:fz>fw)?'W':'V';
  });
  const last5=results.slice(-5);
  let streak=0,streakType=null;
  if(results.length){
    streakType=results[results.length-1];
    for(let i=results.length-1;i>=0;i--){
      if(results[i]===streakType) streak++;
      else break;
    }
  }
  return {results,last5,streak,streakType};
}

function formBadges(last5){
  return last5.map(r=>{
    const bg=r==='W'?'#27ae60':r==='V'?'#e74c3c':'rgba(245,240,232,.2)';
    return `<span style="display:inline-block;width:22px;height:22px;border-radius:5px;background:${bg};
      color:#fff;font-size:10px;font-weight:700;line-height:22px;text-align:center">${r}</span>`;
  }).join('');
}

function trendBadge(streak,streakType){
  if(streak>=3&&streakType==='W') return `<span style="font-size:13px">🔥 ${streak} op rij</span>`;
  if(streak>=3&&streakType==='V') return `<span style="font-size:13px">😰 ${streak} op rij</span>`;
  return '';
}

function openProfile(id){
  const p=getPlayer(id);if(!p) return;
  const wr=p.games?Math.round(p.wins/p.games*100):0;
  const avg=p.rounds?Math.round(p.totalScore/p.rounds):0;
  const since=new Date(p.created).toLocaleDateString('nl-NL',{day:'numeric',month:'long',year:'numeric'});
  const kaapPct=p.roundsPlayed?Math.round(p.roundsKaap/p.roundsPlayed*100):0;
  const spelPct= p.rounds>0 && current? Math.round(p.roundsPlayed/p.rounds*100):0;
  const pg=games.filter(g=>[...g.wij,...(g.wijBench||[]),...g.zij,...(g.zijBench||[])].includes(p.id)).slice(-5).reverse();
  const avImg=p.photo?`<img src="${p.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:`${p.name[0].toUpperCase()}`;
  const form=getPlayerForm(p.id);
  const formHTML=form.last5.length?`
    <div style="margin:10px 0 4px">
      <div style="font-size:10px;color:rgba(245,240,232,.4);margin-bottom:6px;letter-spacing:.5px">LAATSTE ${form.last5.length} BOMEN</div>
      <div style="display:flex;gap:4px;justify-content:center">${formBadges(form.last5)}</div>
      ${form.streak>=3?`<div style="margin-top:6px;font-size:13px">${trendBadge(form.streak,form.streakType)}</div>`:''}
    </div>`:'';
  const recentHTML=pg.length?pg.map(g=>{
    const isWij=[...g.wij,...(g.wijBench||[])].includes(p.id);
    const my=isWij?g.finalWij:g.finalZij,opp=isWij?g.finalZij:g.finalWij;
    const tag=my===opp?`<span class="tag tag-draw">Gelijk</span>`:my>opp?`<span class="tag tag-win">Gewonnen</span>`:`<span class="tag tag-loss">Verloren</span>`;
    const d=new Date(g.date).toLocaleDateString('nl-NL',{day:'numeric',month:'short'});
    return `<div class="stat-row"><div><div style="font-size:13px;font-weight:600">${my} – ${opp}</div><div style="font-size:11px;color:rgba(245,240,232,.4)">${d} · ${g.rounds.length} blaadjes</div></div>${tag}</div>`;
  }).join(''):`<div style="color:rgba(245,240,232,.4);font-size:13px;padding:10px 0">Nog geen spellen</div>`;

  document.getElementById('modal-profile-content').innerHTML=`
    <div class="modal-title">${p.name} <span class="modal-close" onclick="closeModal('modal-profile')">✕</span></div>
    <div style="text-align:center;margin-bottom:18px">
      <label class="avatar-upload">
        <div style="width:76px;height:76px;border-radius:50%;margin:0 auto 10px;background:linear-gradient(135deg,var(--gold),var(--green-light));display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:30px;font-weight:700;color:var(--green);border:3px solid var(--gold);overflow:hidden" id="profile-av-${p.id}">${avImg}</div>
        <div class="avatar-edit-badge">📷</div>
        <input type="file" accept="image/*" onchange="uploadPhoto(${p.id},this)">
      </label>
      <div style="font-family:'Playfair Display',serif;font-size:24px;font-weight:900">${p.name}</div>
      <div style="font-size:11px;color:rgba(245,240,232,.4);margin-top:3px">Speler sinds ${since}</div>
      ${formHTML}
      <div style="margin-top:10px;display:flex;gap:8px;justify-content:center">
        <button class="btn btn-ghost btn-sm" onclick="renamePlayer(${p.id})">✏️ Naam wijzigen</button>
      </div>
    </div>

    <div class="stat-grid" style="margin-bottom:10px">
      <div class="stat-box"><div class="stat-value">${p.games}</div><div class="stat-label">🎮 Bomen</div></div>
      <div class="stat-box"><div class="stat-value" style="color:var(--win)">${p.wins}</div><div class="stat-label">🏆 Gewonnen</div></div>
      <div class="stat-box"><div class="stat-value" style="color:var(--loss)">${p.losses}</div><div class="stat-label">💀 Verloren</div></div>
      <div class="stat-box"><div class="stat-value">${wr}%</div><div class="stat-label">📈 Winrate</div></div>
    </div>

    <div class="stat-grid" style="margin-bottom:10px">
      <div class="stat-box">
        <div class="stat-value" style="color:#e74c3c">${p.nat}</div>
        <div class="stat-label">💧 Keer nat</div>
        ${p.nat>0?`<div style="font-size:10px;color:rgba(245,240,232,.4);margin-top:3px">Zelf: ${p.natAsMaker||0}× · Mee: ${p.nat-(p.natAsMaker||0)}×</div>`:''}
      </div>
      <div class="stat-box">
        <div class="stat-value" style="color:#3498db">${p.verz}</div>
        <div class="stat-label">🔵 Keer verzaakt</div>
        ${p.verz>0?`<div style="font-size:10px;color:rgba(245,240,232,.4);margin-top:3px">Zelf: ${p.verzAsMaker||0}× · Mee: ${p.verz-(p.verzAsMaker||0)}×</div>`:''}
      </div>
      <div class="stat-box"><div class="stat-value">${p.highScore}</div><div class="stat-label">⭐ Hoogste score</div></div>
    </div>
    <div class="stat-grid" style="margin-bottom:10px">
      <div class="stat-box"><div class="stat-value">${avg}</div><div class="stat-label">📊 Gem./ronde</div></div>
      <div class="stat-box"><div class="stat-value">${p.rounds}</div><div class="stat-label">🔄 Blaadjes</div></div>
      <div class="stat-box"><div class="stat-value">${p.roundsPlayed||0}</div><div class="stat-label">🎴 Keer gespeeld</div></div>
      <div class="stat-box" title="% van gespeelde beurten waarbij iemand anders uitbeurt had"><div class="stat-value">${kaapPct}%</div><div class="stat-label">🦅 Gekaapt</div></div>
    </div>

    <div class="card-label" style="margin-bottom:8px">Recente spellen</div>
    ${recentHTML}
    <div style="height:14px"></div>
    <button class="btn btn-red" onclick="deletePlayerConfirm(${p.id})">Speler verwijderen</button>`;
  openModal('modal-profile');
}

function uploadPhoto(id,input){
  const file=input.files[0];if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const SIZE=200;
      const canvas=document.createElement('canvas');
      canvas.width=SIZE;canvas.height=SIZE;
      const ctx=canvas.getContext('2d');
      // Crop to square from center, then draw at SIZE×SIZE
      const s=Math.min(img.width,img.height);
      const ox=(img.width-s)/2;
      const oy=(img.height-s)/2;
      ctx.drawImage(img,ox,oy,s,s,0,0,SIZE,SIZE);
      const dataUrl=canvas.toDataURL('image/jpeg',0.75);
      const p=getPlayer(id);if(!p) return;
      p.photo=dataUrl;saveAll();
      const av=document.getElementById('profile-av-'+id);
      if(av) av.innerHTML=`<img src="${dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      renderPlayers();showToast('📷 Foto opgeslagen!');
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

function renamePlayer(id){
  const p=getPlayer(id);if(!p) return;
  const name=prompt('Nieuwe naam voor '+p.name+':',p.name);
  if(!name||name.trim()===p.name) return;
  if(players.find(x=>x.id!==id&&x.name.toLowerCase()===name.trim().toLowerCase())) return showToast('Naam bestaat al',true);
  p.name=name.trim();saveAll();renderPlayers();closeModal('modal-profile');showToast('✓ Naam gewijzigd');
}

function deletePlayerConfirm(id){
  const p=getPlayer(id);
  doConfirm('Speler verwijderen',`Weet je zeker dat je ${p.name} wilt verwijderen? Spelgeschiedenis blijft bewaard.`,()=>{
    players=players.filter(x=>x.id!==id);saveAll();closeModal('modal-profile');renderPlayers();showToast('Speler verwijderd');
  });
}

// ══════════════════════════════════════════
//  GAME SETUP
// ══════════════════════════════════════════
function updateBenchOptions(){
  const activeIds=['sel-wij1','sel-zij1','sel-wij2','sel-zij2']
    .map(id=>document.getElementById(id)?.value).filter(Boolean);
  const noneOpt=`<option value="">— Geen wisselspeler —</option>`;
  const benchOpts=players
    .filter(p=>!activeIds.includes(String(p.id)))
    .map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  ['sel-wij3','sel-zij3','sel-wij4','sel-zij4'].forEach(sid=>{
    const el=document.getElementById(sid);
    if(!el) return;
    const prev=el.value;
    el.innerHTML=noneOpt+benchOpts;
    el.value=prev&&!activeIds.includes(prev)?prev:'';
  });
}

function updateStarterOptions(){
  const starterSel=document.getElementById('sel-starter');
  const seatIds=['sel-wij1','sel-zij1','sel-wij2','sel-zij2'].map(id=>document.getElementById(id)?.value).filter(Boolean);
  const uniqueIds=[...new Set(seatIds.map(String))];
  const prev=starterSel.value;
  starterSel.innerHTML=uniqueIds.map(id=>{
    const p=getPlayer(+id);
    return p?`<option value="${p.id}">${p.name}</option>`:'';
  }).join('');
  if(uniqueIds.includes(String(prev))) starterSel.value=String(prev);
  else if(uniqueIds[0]) starterSel.value=String(uniqueIds[0]);
  updateBenchOptions();
}

function populateSelects(){
  const opts=players.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const seatDefaults={
    'sel-wij1':players[0]?.id,
    'sel-zij1':players[1]?.id,
    'sel-wij2':players[2]?.id,
    'sel-zij2':players[3]?.id
  };
  ['sel-wij1','sel-zij1','sel-wij2','sel-zij2'].forEach(sid=>{
    const el=document.getElementById(sid);
    el.innerHTML=opts;
    if(seatDefaults[sid]!==undefined) el.value=seatDefaults[sid];
    el.onchange=updateStarterOptions;
  });
  updateStarterOptions();
  // Default starter: Zij 1 (eerste na de dealer)
  const zij1Val=document.getElementById('sel-zij1')?.value;
  const starterSel=document.getElementById('sel-starter');
  if(zij1Val&&starterSel) starterSel.value=String(zij1Val);
}

function openNewGameModal(){
  if(players.length<2){showToast('Voeg eerst minstens 2 spelers toe',true);switchView('players');return}
  populateSelects();
  updateStarterOptions();
  openModal('modal-new-game');
}

function startNewGame(){
  const w1=+document.getElementById('sel-wij1').value;
  const z1=+document.getElementById('sel-zij1').value;
  const w2=+document.getElementById('sel-wij2').value;
  const z2=+document.getElementById('sel-zij2').value;
  const w3El=document.getElementById('sel-wij3');const w3=w3El?.value?+w3El.value:null;
  const z3El=document.getElementById('sel-zij3');const z3=z3El?.value?+z3El.value:null;
  const w4El=document.getElementById('sel-wij4');const w4=w4El?.value?+w4El.value:null;
  const z4El=document.getElementById('sel-zij4');const z4=z4El?.value?+z4El.value:null;
  const starter=+document.getElementById('sel-starter').value;
  const activeIds=[w1,z1,w2,z2];
  const benchIds=[w3,z3,w4,z4].filter(Boolean);
  const allIds=[...activeIds,...benchIds];
  if(new Set(allIds).size<allIds.length) return showToast('Elke speler mag maar 1x meedoen',true);
  if(!activeIds.map(String).includes(String(starter))) return showToast('Kies een starter die in dit potje zit',true);
  const wijBench=[w3,w4].filter(Boolean);
  const zijBench=[z3,z4].filter(Boolean);
  const newGame={id:Date.now(),date:new Date().toISOString(),
    wij:[w1,w2],zij:[z1,z2],wijBench,zijBench,
    seatOrder:[w1,z1,w2,z2],starter,
    scoreWij:0,scoreZij:0,roemWij:0,roemZij:0,
    wisselingen:[],rounds:[],active:true};
  games.push(newGame);
  localStorage.setItem('kj_viewing_id',String(newGame.id));
  current=newGame;
  saveAll();closeModal('modal-new-game');switchView('game');showToast('Boom gestart! 🌳 Veel plezier');
}

function openTable(id){
  const g=games.find(x=>String(x.id)===String(id)&&x.active);
  if(!g) return showToast('Tafel niet gevonden',true);
  localStorage.setItem('kj_viewing_id',String(id));
  current=g;
  switchView('game');
}

function resumeLastGame(){
  const activeGames=games.filter(g=>g.active);
  if(!activeGames.length) return showToast('Geen actief spel gevonden',true);
  if(activeGames.length===1) return openTable(activeGames[0].id);
  switchView('home');
}

function toggleBenchSection(){
  const section=document.getElementById('bench-section');
  const btn=document.getElementById('btn-toggle-bench');
  if(!section) return;
  const isVisible=section.style.display!=='none';
  section.style.display=isVisible?'none':'block';
  if(btn) btn.textContent=isVisible?'+ Wisselspelers toevoegen':'− Wisselspelers verbergen';
}

function openWisselModal(){
  const g=current;if(!g) return;
  const hasWijBench=(g.wijBench||[]).length>0;
  const hasZijBench=(g.zijBench||[]).length>0;
  if(!hasWijBench&&!hasZijBench) return showToast('Geen wisselspelers beschikbaar',true);
  let html='';
  if(hasWijBench){
    html+=`<div style="margin-bottom:14px">
      <div class="card-label">Team Wij — wissel</div>
      <label style="font-size:12px;margin-top:6px">Wie gaat eruit?</label>
      <select id="wissel-wij-uit">${g.wij.map(id=>`<option value="${id}">${getPlayer(id)?.name||'?'}</option>`).join('')}</select>
      <label style="font-size:12px;margin-top:6px">Wie komt erin?</label>
      <select id="wissel-wij-in">${(g.wijBench||[]).map(id=>`<option value="${id}">${getPlayer(id)?.name||'?'}</option>`).join('')}</select>
    </div>`;
  }
  if(hasZijBench){
    html+=`<div style="margin-bottom:14px">
      <div class="card-label">Team Zij — wissel</div>
      <label style="font-size:12px;margin-top:6px">Wie gaat eruit?</label>
      <select id="wissel-zij-uit">${g.zij.map(id=>`<option value="${id}">${getPlayer(id)?.name||'?'}</option>`).join('')}</select>
      <label style="font-size:12px;margin-top:6px">Wie komt erin?</label>
      <select id="wissel-zij-in">${(g.zijBench||[]).map(id=>`<option value="${id}">${getPlayer(id)?.name||'?'}</option>`).join('')}</select>
    </div>`;
  }
  document.getElementById('wissel-content').innerHTML=html;
  openModal('modal-wissel');
}

function confirmWissel(){
  const g=current;if(!g) return;
  if(!g.wisselingen) g.wisselingen=[];
  const wisseling={blaadje:g.rounds.length};
  const wijUitEl=document.getElementById('wissel-wij-uit');
  const wijInEl=document.getElementById('wissel-wij-in');
  if(wijUitEl&&wijInEl){
    const uitId=+wijUitEl.value,inId=+wijInEl.value;
    const uitIdx=g.wij.indexOf(uitId);
    const inBenchIdx=(g.wijBench||[]).indexOf(inId);
    if(uitIdx>=0&&inBenchIdx>=0){
      g.wij[uitIdx]=inId;
      g.wijBench[inBenchIdx]=uitId;
      const seatIdx=g.seatOrder.indexOf(uitId);
      if(seatIdx>=0) g.seatOrder[seatIdx]=inId;
      wisseling.wijUit=uitId;wisseling.wijIn=inId;
    }
  }
  const zijUitEl=document.getElementById('wissel-zij-uit');
  const zijInEl=document.getElementById('wissel-zij-in');
  if(zijUitEl&&zijInEl){
    const uitId=+zijUitEl.value,inId=+zijInEl.value;
    const uitIdx=g.zij.indexOf(uitId);
    const inBenchIdx=(g.zijBench||[]).indexOf(inId);
    if(uitIdx>=0&&inBenchIdx>=0){
      g.zij[uitIdx]=inId;
      g.zijBench[inBenchIdx]=uitId;
      const seatIdx=g.seatOrder.indexOf(uitId);
      if(seatIdx>=0) g.seatOrder[seatIdx]=inId;
      wisseling.zijUit=uitId;wisseling.zijIn=inId;
    }
  }
  g.wisselingen.push(wisseling);
  saveAll();closeModal('modal-wissel');renderGame();
  showToast('✓ Wissel doorgevoerd!');
}

function openAddPlayerToGameModal(){
  const g=current;if(!g) return;
  const inGame=[...g.wij,...g.zij,...(g.wijBench||[]),...(g.zijBench||[])].map(String);
  const available=players.filter(p=>!inGame.includes(String(p.id)));
  const sel=document.getElementById('add-game-player-select');
  sel.innerHTML=`<option value="">— Kies speler —</option>`
    +available.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')
    +`<option value="new">+ Nieuwe speler aanmaken...</option>`;
  document.getElementById('add-game-player-name').style.display='none';
  document.getElementById('add-game-player-name').value='';

  // Team picker: klikbare kaartjes met echte namen
  const wijNames=[...g.wij,...(g.wijBench||[])].map(id=>getPlayer(id)?.name||'?').join(' & ');
  const zijNames=[...g.zij,...(g.zijBench||[])].map(id=>getPlayer(id)?.name||'?').join(' & ');
  let selectedTeam='wij';
  function renderPicker(){
    document.getElementById('add-game-team-picker').innerHTML=['wij','zij'].map(t=>{
      const names=t==='wij'?wijNames:zijNames;
      const active=selectedTeam===t;
      return `<div onclick="window._pickAddTeam('${t}')" style="
        flex:1;padding:12px 10px;border-radius:11px;cursor:pointer;text-align:center;
        border:2px solid ${active?'var(--gold)':'rgba(201,168,76,.25)'};
        background:${active?'rgba(201,168,76,.15)':'rgba(0,0,0,.2)'};
        transition:all .15s">
        <div style="font-size:18px;margin-bottom:4px">${active?'✅':'⬜'}</div>
        <div style="font-size:11px;font-weight:700;color:var(--gold);letter-spacing:.5px;text-transform:uppercase;margin-bottom:3px">${t==='wij'?'Wij':'Zij'}</div>
        <div style="font-size:12px;color:rgba(245,240,232,.7)">${names}</div>
      </div>`;
    }).join('');
  }
  window._pickAddTeam=function(t){selectedTeam=t;renderPicker();};
  window._getAddTeam=function(){return selectedTeam;};
  renderPicker();
  openModal('modal-add-player-game');
}
function onAddGamePlayerSelect(){
  const v=document.getElementById('add-game-player-select').value;
  document.getElementById('add-game-player-name').style.display=v==='new'?'block':'none';
}
function confirmAddPlayerToGame(){
  const g=current;if(!g) return;
  const sel=document.getElementById('add-game-player-select').value;
  const team=window._getAddTeam?.();
  if(!team) return showToast('Kies een team',true);
  let pid;
  if(sel==='new'){
    const naam=document.getElementById('add-game-player-name').value.trim();
    if(!naam) return showToast('Voer een naam in',true);
    const np={id:Date.now(),name:naam,games:0,wins:0,losses:0,draws:0,rounds:0,totalScore:0,highScore:0,nat:0,verz:0,pit:0,natAsMaker:0,pitAsMaker:0,verzAsMaker:0,roundsPlayed:0,roundsKaap:0};
    players.push(np);pid=np.id;
  } else {
    pid=+sel;if(!pid) return showToast('Kies een speler',true);
  }
  if(team==='wij'){if(!g.wijBench)g.wijBench=[];g.wijBench.push(pid);}
  else{if(!g.zijBench)g.zijBench=[];g.zijBench.push(pid);}
  saveAll();closeModal('modal-add-player-game');renderGame();
  showToast('✓ Speler toegevoegd!');
  setTimeout(()=>openWisselModal(),400);
}

// ══════════════════════════════════════════
//  UITBEURT LOGIC (4-player rotation)
// ══════════════════════════════════════════
function getSeatOrder(g=current){
  if(!g) return [];
  if(Array.isArray(g.seatOrder) && g.seatOrder.length) return g.seatOrder.map(Number);
  const inferred=[g.wij?.[0],g.zij?.[0],g.wij?.[1],g.zij?.[1]].filter(v=>v!==undefined&&v!==null).map(Number);
  return inferred.length?inferred:[...(g.wij||[]),...(g.zij||[])].map(Number);
}

function getUitbeurt(roundIndex){
  if(!current) return null;
  const allPlayers=getSeatOrder(current);
  if(!allPlayers.length) return null;
  const starterIdx=Math.max(0,allPlayers.indexOf(Number(current.starter)));
  const idx=(starterIdx+roundIndex)%allPlayers.length;
  return allPlayers[idx];
}

// ══════════════════════════════════════════
//  RENDER GAME
// ══════════════════════════════════════════
function renderGame(){
  const empty=document.getElementById('game-empty-state');
  const active=document.getElementById('game-active-state');
  if(!current||!current.active){
    if(empty) empty.style.display='block';
    if(active) active.style.display='none';
    const hri=document.getElementById('header-round-info');
    if(hri) hri.textContent='';
    return;
  }
  if(empty) empty.style.display='none';
  if(active) active.style.display='block';

  const g=current;
  if(refreshGameAutoSpecials(g)) recalcGameTotals(g), saveAll();
  const wn=g.wij.map(id=>getPlayer(id)?.name||'?').join(' & ');
  const zn=g.zij.map(id=>getPlayer(id)?.name||'?').join(' & ');
  const wBench=(g.wijBench||[]).map(id=>getPlayer(id)?.name||'?');
  const zBench=(g.zijBench||[]).map(id=>getPlayer(id)?.name||'?');
  const rnd=Math.min(g.rounds.length+1,16);

  document.getElementById('wij-label').textContent=wn;
  document.getElementById('zij-label').textContent=zn;
  // Wisselspelers klein eronder
  const wijBenchEl=document.getElementById('wij-bench-label');
  const zijBenchEl=document.getElementById('zij-bench-label');
  if(wijBenchEl) wijBenchEl.textContent=wBench.length?'+ '+wBench.join(', '):'';
  if(zijBenchEl) zijBenchEl.textContent=zBench.length?'+ '+zBench.join(', '):'';
  document.getElementById('wij-pts-label').textContent='Wij (punten)';
  document.getElementById('zij-pts-label').textContent='Zij (punten)';
  document.getElementById('score-wij').textContent=g.scoreWij;
  document.getElementById('score-zij').textContent=g.scoreZij;
  document.getElementById('roem-wij').textContent=g.roemWij;
  document.getElementById('roem-zij').textContent=g.roemZij;
  document.getElementById('round-num').textContent=rnd;
  document.getElementById('ronde-progress').textContent=`blaadje ${Math.min(g.rounds.length+1,16)}/16 · takkie ${Math.ceil((g.rounds.length+1)/4)}/4`;

  const uitId=getUitbeurt(g.rounds.length);
  const uitPlayer=getPlayer(uitId);
  if(uitPlayer){
    document.getElementById('uitbeurt-bar').style.display='flex';
    document.getElementById('uitbeurt-name').textContent=uitPlayer.name;
    document.getElementById('uitbeurt-ronde').textContent=`Blaadje ${rnd}`;
    const uitTeam=getTeamForPlayer(g,uitId);
    const teamTag=document.getElementById('uitbeurt-team-tag');
    if(teamTag){
      teamTag.textContent=uitTeam==='wij'?'Wij':'Zij';
      teamTag.style.color=uitTeam==='wij'?'rgba(100,200,120,.8)':'rgba(200,120,100,.8)';
    }
  }

  const allOpts=getSeatOrder(g).map(id=>`<option value="${id}">${getPlayer(id)?.name||'?'}</option>`).join('');
  const spelSelect=document.getElementById('sel-speler');
  spelSelect.innerHTML=`<option value="">— Kies wie speelt —</option>`+allOpts;
  spelSelect.value=String(uitId||'');

  // Wissel bar altijd tonen (wissel knop alleen als er bankspelers zijn)
  const wisselBar=document.getElementById('wissel-bar');
  if(wisselBar){
    const hasBench=((g.wijBench||[]).length+(g.zijBench||[]).length)>0;
    wisselBar.style.display='block';
    const wisselBtn=document.getElementById('btn-wissel-speler');
    if(wisselBtn) wisselBtn.style.display=hasBench?'inline-flex':'none';
  }

  const q=[20,50,100];
  document.getElementById('quick-wij').innerHTML=q.map(v=>`<button class="quick-btn" onclick="addRoem('wij',${v})">+${v} roem</button>`).join('');
  document.getElementById('quick-zij').innerHTML=q.map(v=>`<button class="quick-btn" onclick="addRoem('zij',${v})">+${v} roem</button>`).join('');

  renderRoundTable();

  if(g.rounds.length===8 && !g._rookShown){
    g._rookShown=true;
    setTimeout(()=>showRookPauze(),400);
  }
}

// ══════════════════════════════════════════
//  INPUT HELPERS
// ══════════════════════════════════════════
function clampAndCalc(team){
  const el=document.getElementById('input-'+team);
  let v=parseInt(el.value);
  if(isNaN(v)) return;
  if(v>162){v=162;el.value=162}
  const other=team==='wij'?'zij':'wij';
  document.getElementById('input-'+other).value=162-v;
}

function addRoem(team,val){
  const el=document.getElementById('input-roem-'+team);
  el.value=(parseInt(el.value)||0)+val;
}

function getTeamForPlayer(g,playerId){
  const id=+playerId;
  if(!g||!playerId&&playerId!==0) return '';
  if(g.wij.includes(id)) return 'wij';
  if(g.zij.includes(id)) return 'zij';
  if((g.wijBench||[]).includes(id)) return 'wij';
  if((g.zijBench||[]).includes(id)) return 'zij';
  return '';
}

function getAutoNatSpecial(g,ronde){
  if(!g||!ronde) return '';
  const makerId=ronde.spelId||ronde.spelWij||ronde.spelZij||null;
  const makerTeam=getTeamForPlayer(g,makerId);
  const totaalWij=(parseInt(ronde.w)||0)+(parseInt(ronde.rw)||0);
  const totaalZij=(parseInt(ronde.z)||0)+(parseInt(ronde.rz)||0);
  if(makerTeam==='wij' && totaalWij<=totaalZij) return 'NAT WIJ (auto)';
  if(makerTeam==='zij' && totaalZij<=totaalWij) return 'NAT ZIJ (auto)';
  return '';
}

function refreshRoundAutoSpecial(g,ronde){
  if(!g||!ronde) return false;
  const currentSpecial=(ronde.special||'').trim();
  const isManual=currentSpecial && !currentSpecial.includes('(auto)');
  if(isManual) return false;
  const nextSpecial=getAutoNatSpecial(g,ronde);
  if(nextSpecial===currentSpecial) return false;
  ronde.special=nextSpecial;
  return true;
}

function refreshGameAutoSpecials(g){
  if(!g||!Array.isArray(g.rounds)) return false;
  let changed=false;
  g.rounds.forEach(r=>{ if(refreshRoundAutoSpecial(g,r)) changed=true; });
  return changed;
}

function getRoundAward(g,ronde){
  if(!ronde) return {w:0,z:0,roemWij:0,roemZij:0};
  const rw=parseInt(ronde.rw)||0;
  const rz=parseInt(ronde.rz)||0;
  let w=parseInt(ronde.w)||0;
  let z=parseInt(ronde.z)||0;
  const special=((ronde.special||'') || getAutoNatSpecial(g,ronde)).toUpperCase();
  if(special.includes('NAT WIJ')){
    return {w:0,z:162+rw+rz,roemWij:0,roemZij:rw+rz};
  }
  if(special.includes('NAT ZIJ')){
    return {w:162+rw+rz,z:0,roemWij:rw+rz,roemZij:0};
  }
  return {w:w+rw,z:z+rz,roemWij:rw,roemZij:rz};
}

function recalcGameTotals(g){
  if(!g) return;
  g.scoreWij=0; g.scoreZij=0; g.roemWij=0; g.roemZij=0;
  (g.rounds||[]).forEach(r=>{
    refreshRoundAutoSpecial(g,r);
    const award=getRoundAward(g,r);
    g.scoreWij+=award.w;
    g.scoreZij+=award.z;
    g.roemWij+=award.roemWij;
    g.roemZij+=award.roemZij;
  });
}

function openLatestFinishedGameForEdit(){
  if(!games.length) return showToast('Nog geen opgeslagen boom gevonden',true);
  const latest=[...games].sort((a,b)=>new Date(b.endDate||b.date)-new Date(a.endDate||a.date))[0];
  if(!latest) return showToast('Nog geen opgeslagen boom gevonden',true);
  editGameFromHistory(latest.id);
}

// ══════════════════════════════════════════
//  SPECIAL SITUATIONS
// ══════════════════════════════════════════
function applySpecialAuto(type){
  const g=current;if(!g) return;
  const spelerId=document.getElementById('sel-speler')?.value;
  if(type==='verz'){
    // VERZ: eerst picker tonen, team bepalen na selectie
    openVerzPicker();
    return;
  }
  // NAT/PIT: automatisch team bepalen via geselecteerde speler
  if(!spelerId){showToast('⚠️ Kies eerst wie speelt');return;}
  const team=getTeamForPlayer(g,+spelerId);
  if(!team){showToast('⚠️ Speler niet gevonden in huidig spel');return;}
  applySpecial(type,team);
}

function applySpecial(type,team){
  if(_modalJustClosed||_blockSubmit) return;
  const other=team==='wij'?'zij':'wij';
  if(type==='nat'){
    // Bewaar ingevoerde roem — die mag niet verloren gaan bij NAT
    const roemWij=document.getElementById('input-roem-wij').value;
    const roemZij=document.getElementById('input-roem-zij').value;
    document.getElementById('input-wij').value='';
    document.getElementById('input-zij').value='';
    document.getElementById('input-'+team).value=0;
    document.getElementById('input-'+other).value=162;
    document.getElementById('input-roem-wij').value=roemWij;
    document.getElementById('input-roem-zij').value=roemZij;
    document.getElementById('input-wij').dataset.special='NAT '+(team==='wij'?'WIJ':'ZIJ');
    document.getElementById('input-wij').dataset.specialTime=Date.now();
    document.getElementById('input-wij').dataset.natTeam=team;
    // FX direct afspelen (geen setTimeout = beter voor iOS geluid)
    showNatFX();
    showToast('💧 NAT '+(team==='wij'?'Wij':'Zij')+' — 0 punten');
    setTimeout(()=>submitRound(),400);
  } else if(type==='verz'){
    // Legacy pad (directe team-keuze) — open picker, selectVerzPlayer handelt de rest af
    openVerzPicker();
  } else if(type==='pit'){
    document.getElementById('input-'+team).value=162;
    document.getElementById('input-'+other).value=0;
    document.getElementById('input-roem-'+team).value=100;
    document.getElementById('input-wij').dataset.special='PIT '+(team==='wij'?'WIJ':'ZIJ');
    document.getElementById('input-wij').dataset.specialTime=Date.now();
    showToast('💥 PIT '+(team==='wij'?'Wij':'Zij')+' — 162 + 100 roem');
    setTimeout(()=>{ showPitFX(); setTimeout(()=>submitRound(),800); },200);
  }
}

let _pendingVerzPlayerId=null; // ID van de speler die verzaakte (kan afwijken van maker)

function openVerzPicker(){
  const g=current;if(!g) return;
  // Toon alle spelers — iedereen kan verzaken
  const wijIds=[...g.wij,...(g.wijBench||[])];
  const zijIds=[...g.zij,...(g.zijBench||[])];
  document.getElementById('verz-picker-title').innerHTML=
    `Wie heeft verzaakt? <span class="modal-close" onclick="closeModal('modal-verz-picker')">✕</span>`;
  const btnHtml=[
    `<div style="font-size:11px;color:rgba(245,240,232,.4);margin-bottom:4px;letter-spacing:.5px">WIJ</div>`,
    ...wijIds.map(id=>{const p=getPlayer(id);return `<button class="btn" style="width:100%;margin-bottom:8px" onclick="selectVerzPlayer(${id})">${p?.name||'?'}</button>`;}),
    `<div style="font-size:11px;color:rgba(245,240,232,.4);margin-bottom:4px;margin-top:4px;letter-spacing:.5px">ZIJ</div>`,
    ...zijIds.map(id=>{const p=getPlayer(id);return `<button class="btn" style="width:100%;margin-bottom:8px" onclick="selectVerzPlayer(${id})">${p?.name||'?'}</button>`;})
  ].join('');
  document.getElementById('verz-picker-buttons').innerHTML=btnHtml;
  openModal('modal-verz-picker');
}
function selectVerzPlayer(playerId){
  closeModal('modal-verz-picker');
  const g=current;if(!g) return;
  _pendingVerzPlayerId=playerId;
  // Team bepalen op basis van wie verzaakte (niet de maker)
  const team=getTeamForPlayer(g,playerId)||'wij';
  const other=team==='wij'?'zij':'wij';
  ['input-wij','input-zij','input-roem-wij','input-roem-zij'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('input-'+team).value=0;
  document.getElementById('input-'+other).value=162;
  document.getElementById('input-roem-'+other).value=100;
  const inputWij=document.getElementById('input-wij');
  inputWij.dataset.special='VERZ '+(team==='wij'?'WIJ':'ZIJ');
  inputWij.dataset.specialTime=Date.now();
  showVerzFX();
  showToast('🔵 VERZ '+(team==='wij'?'Wij':'Zij')+' — '+getPlayer(playerId)?.name+' verzaakte');
  setTimeout(()=>submitRound(),350);
}

// ══════════════════════════════════════════
//  SUBMIT ROUND
// ══════════════════════════════════════════
function isValidRoem(val){
  // Roem bestaat uit eenheden van 20, 50 of 100
  if(val===0) return true;
  if(val<0) return false;
  for(let f=0;f*50<=val;f++){
    if((val-f*50)%20===0) return true;
  }
  return false;
}

function submitRound(){
  if(_blockSubmit) return;
  const g=current;if(!g) return;
  if(g.rounds.length>=16){showToast('Maximaal 16 blaadjes bereikt',true);return}

  const w=parseInt(document.getElementById('input-wij').value);
  const z=parseInt(document.getElementById('input-zij').value);
  const rw=parseInt(document.getElementById('input-roem-wij').value)||0;
  const rz=parseInt(document.getElementById('input-roem-zij').value)||0;
  if(isNaN(w)||isNaN(z)) return showToast('Voer punten in voor beide teams',true);
  if(w+z!==162) return showToast('Punten van Wij en Zij moeten samen 162 zijn',true);
  if(!isValidRoem(rw)) return showToast('Roem Wij klopt niet — gebruik veelvouden van 20, 50 of 100',true);
  if(!isValidRoem(rz)) return showToast('Roem Zij klopt niet — gebruik veelvouden van 20, 50 of 100',true);

  const inputWijEl=document.getElementById('input-wij');
  const specialAge=Date.now()-parseInt(inputWijEl.dataset.specialTime||'0');
  const special=specialAge<5000?(inputWijEl.dataset.special||''):'';
  delete document.getElementById('input-wij').dataset.special;
  delete document.getElementById('input-wij').dataset.natTeam;

  const spelId=document.getElementById('sel-speler').value||null;
  if(!spelId) return showToast('Selecteer eerst wie speelt',true);
  const spelTeam=getTeamForPlayer(g,spelId);
  const spelWij=spelTeam==='wij'?spelId:null;
  const spelZij=spelTeam==='zij'?spelId:null;

  // Enforce correct values for NAT/VERZ regardless of what's in the DOM
  // (prevents accidental field edits between button press and auto-submit)
  let fw=w,fz=z;
  if(special.includes('NAT WIJ')||special.includes('VERZ WIJ')){fw=0;fz=162;}
  else if(special.includes('NAT ZIJ')||special.includes('VERZ ZIJ')){fw=162;fz=0;}

  // Determine who made it and if nat auto-detected
  const uitId=getUitbeurt(g.rounds.length);
  const verzPlayerId=special.includes('VERZ')&&_pendingVerzPlayerId?_pendingVerzPlayerId:null;
  _pendingVerzPlayerId=null;
  const rondeData={w:fw,z:fz,rw,rz,special:'',spelId,spelWij,spelZij,uitId,verzPlayerId};
  rondeData.special=special||getAutoNatSpecial(g,rondeData);
  const autoNat=rondeData.special.includes('(auto)')?rondeData.special:'';
  if(autoNat) showNatFX();

  g.rounds.push(rondeData);
  recalcGameTotals(g);
  saveAll();

  // Update player roundsPlayed / roundsKaap
  const pSpeler=getPlayer(+spelId);
  if(pSpeler){
    pSpeler.roundsPlayed=(pSpeler.roundsPlayed||0)+1;
    if(String(spelId)!==String(uitId)) pSpeler.roundsKaap=(pSpeler.roundsKaap||0)+1;
    saveAll();
  }

  ['input-wij','input-zij','input-roem-wij','input-roem-zij'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('sel-speler').value='';

  if(g.rounds.length>=16){
    showToast('🌳 Boom vol! 16 blaadjes gespeeld');
    setTimeout(()=>confirmEndGame(),700);
  } else {
    showToast('✓ Blaadje '+(g.rounds.length)+' verwerkt');
    checkJagen(g);
    renderGame();
    // Wisselherinnering na elk takkie (4, 8, 12 blaadjes)
    const hasBench=((g.wijBench||[]).length+(g.zijBench||[]).length)>0;
    if(hasBench && g.rounds.length%4===0 && g.rounds.length<16){
      const takkieNum=g.rounds.length/4;
      setTimeout(()=>showWisselReminder(takkieNum),600);
    }
  }
}

function checkJagen(g){
  if(g.rounds.length<3) return;
  function aansluitendVerlies(team){
    let n=0;
    for(let i=g.rounds.length-1;i>=0;i--){
      const r=g.rounds[i];
      const mijn=team==='wij'?r.w+r.rw:r.z+r.rz;
      const ander=team==='wij'?r.z+r.rz:r.w+r.rw;
      if(mijn<ander) n++; else break;
    }
    return n;
  }
  for(const team of ['wij','zij']){
    const n=aansluitendVerlies(team);
    if(n>0&&n%3===0){
      const ids=team==='wij'?[...g.wij,...(g.wijBench||[])]:[...g.zij,...(g.zijBench||[])];
      const namen=ids.map(id=>getPlayer(id)?.name).filter(Boolean);
      const namenStr=namen.length===2?namen.join(' & '):namen.join(', ');
      playAudioFile('/sounds/jagen.mp3');
      setTimeout(()=>showJagenToast('🏹 '+namenStr+' zitten er niet lekker in. Tijd om te jagen!'),600);
      return;
    }
  }
}

function undoLastRound(){
  const g=current;if(!g||!g.rounds.length) return showToast('Geen blaadje om ongedaan te maken',true);
  const l=g.rounds.pop();
  recalcGameTotals(g);
  const p=getPlayer(+(l.spelId||0));
  if(p){
    p.roundsPlayed=Math.max(0,(p.roundsPlayed||0)-1);
    if(String(l.spelId)!==String(l.uitId)) p.roundsKaap=Math.max(0,(p.roundsKaap||0)-1);
  }
  saveAll();renderGame();showToast('↩ Blaadje ongedaan gemaakt');
}

// ══════════════════════════════════════════
//  ROUND TABLE WITH DRAG & EDIT
// ══════════════════════════════════════════
let dragSrcIdx=null;

function renderRoundTable(){
  const g=current;if(!g) return;
  const tb=document.getElementById('round-tbody');
  const tf=document.getElementById('round-tfoot');
  if(!g.rounds.length){
    tb.innerHTML=`<tr><td colspan="6" style="color:rgba(245,240,232,.3);padding:14px;text-align:center">Nog geen blaadjes</td></tr>`;
    tf.innerHTML='';return;
  }

  // Helper: inline score cell with special annotation
  function scoreCell(pts, rSp, team){
    const N=`<b style="color:#e74c3c">N</b>`;
    const V=`<b style="color:#3498db">V</b>`;
    const P=`<b style="color:#9b59b6">P</b>`;
    if(rSp.includes('NAT '+team))  return `${N} 0`;
    if(rSp.includes('VERZ '+team)) return `${V} 0`;
    if(rSp.includes('PIT '+team))  return `${P} ${pts}`;
    return `${pts}`;
  }

  let rows='';
  let cumW=0,cumZ=0,cumRW=0,cumRZ=0;

  g.rounds.forEach((r,i)=>{
    const rSp=r.special||'';
    // Effective punten (enforce 0/162 for NAT/VERZ)
    let pw=r.w,pz=r.z;
    if(rSp.includes('NAT WIJ')||rSp.includes('VERZ WIJ')){pw=0;pz=162;}
    else if(rSp.includes('NAT ZIJ')||rSp.includes('VERZ ZIJ')){pw=162;pz=0;}

    // Bij NAT: roem van verliezende kant gaat naar winnaar
    let dispRW=r.rw||0, dispRZ=r.rz||0;
    if(rSp.includes('NAT WIJ')||rSp.includes('VERZ WIJ')){
      dispRZ=(r.rw||0)+(r.rz||0); dispRW=0;
    } else if(rSp.includes('NAT ZIJ')||rSp.includes('VERZ ZIJ')){
      dispRW=(r.rw||0)+(r.rz||0); dispRZ=0;
    }
    cumW+=pw;cumZ+=pz;cumRW+=dispRW;cumRZ+=dispRZ;

    const rondeSpelerId=r.spelId||r.spelWij||r.spelZij;
    const spelNaam=rondeSpelerId?getPlayer(+rondeSpelerId)?.name?.split(' ')[0]:'';
    const uitNaam=r.uitId?getPlayer(+r.uitId)?.name?.split(' ')[0]:'';
    const wasGekaapt=r.uitId&&String(r.uitId)!==String(rondeSpelerId);
    // Als er gekaapt is: toon uitbeurt bovenaan, dan ↳ speler eronder
    const rondeLabel=wasGekaapt
      ? `<div style="font-size:9px;color:rgba(245,240,232,.4)">${uitNaam} <span style="opacity:.5">uitb.</span></div>
         <div style="font-size:9px;color:rgba(245,240,232,.7)">↳ ${spelNaam} <span style="opacity:.5">speelde</span></div>`
      : `<div style="font-size:9px;color:rgba(245,240,232,.5)">${spelNaam}</div>`;

    rows+=`<tr class="round-row" draggable="true"
      ondragstart="dragStart(${i})" ondragover="dragOver(event,${i})" ondrop="dropRound(${i})" ondragend="dragEnd()"
      id="rnd-row-${i}">
      <td style="text-align:right;color:rgba(201,168,76,.65);font-size:11px;min-width:28px">${dispRW||'—'}</td>
      <td style="text-align:right;font-size:14px;font-weight:700;padding-right:6px">${scoreCell(pw,rSp,'WIJ')}</td>
      <td style="text-align:center;font-size:11px;color:rgba(245,240,232,.45);line-height:1.5;padding:5px 2px">
        <b style="color:rgba(245,240,232,.65)">${i+1}.</b>
        ${rondeLabel}
      </td>
      <td style="text-align:left;font-size:14px;font-weight:700;padding-left:6px">${scoreCell(pz,rSp,'ZIJ')}</td>
      <td style="text-align:left;color:rgba(201,168,76,.65);font-size:11px;min-width:28px">${dispRZ||'—'}</td>
      <td style="padding:0 2px"><button onclick="editRound(${i})" style="background:none;border:none;color:rgba(201,168,76,.45);cursor:pointer;font-size:11px;padding:3px">✏️</button></td>
    </tr>`;

    // Subtotaal na elke takkie (na 4, 8, 12 blaadjes — niet na laatste takkie van 16)
    if((i+1)%4===0 && i<g.rounds.length-1){
      const takkieNum=(i+1)/4;
      rows+=`<tr style="background:rgba(201,168,76,.07)">
        <td style="text-align:right;font-size:10px;color:rgba(201,168,76,.55);padding:5px 3px">${cumRW||''}</td>
        <td style="text-align:right;font-weight:700;color:var(--gold);font-size:13px;padding-right:6px">${cumW}</td>
        <td style="text-align:center;font-size:9px;color:rgba(201,168,76,.6);letter-spacing:.8px;padding:5px 2px">TAKKIE ${takkieNum}</td>
        <td style="text-align:left;font-weight:700;color:var(--gold);font-size:13px;padding-left:6px">${cumZ}</td>
        <td style="text-align:left;font-size:10px;color:rgba(201,168,76,.55);padding:5px 3px">${cumRZ||''}</td>
        <td></td>
      </tr>`;
    }
  });

  tb.innerHTML=rows;

  tf.innerHTML=`<tr class="totaal-row">
    <td style="text-align:right;font-size:11px">${g.roemWij||0}</td>
    <td style="text-align:right">${g.scoreWij}</td>
    <td style="text-align:center;font-size:10px;letter-spacing:.8px">TOTAAL</td>
    <td style="text-align:left">${g.scoreZij}</td>
    <td style="text-align:left;font-size:11px">${g.roemZij||0}</td>
    <td></td>
  </tr>`;
}

function dragStart(i){dragSrcIdx=i;document.getElementById('rnd-row-'+i).classList.add('dragging')}
function dragOver(e,i){e.preventDefault();document.querySelectorAll('.round-row').forEach(r=>r.classList.remove('drag-over'));document.getElementById('rnd-row-'+i).classList.add('drag-over')}
function dragEnd(){document.querySelectorAll('.round-row').forEach(r=>{r.classList.remove('dragging');r.classList.remove('drag-over')})}
function dropRound(toIdx){
  const g=current;if(!g||dragSrcIdx===null) return;
  const moved=g.rounds.splice(dragSrcIdx,1)[0];
  g.rounds.splice(toIdx,0,moved);
  // Recalc totals
  recalcGameTotals(g);
  dragSrcIdx=null;saveAll();renderGame();
}

function clampEditRound(team){
  const el=document.getElementById('edit-input-'+team);
  let v=parseInt(el.value);
  if(isNaN(v)) return;
  if(v<0){v=0;el.value=0}
  if(v>162){v=162;el.value=162}
  const other=team==='wij'?'zij':'wij';
  document.getElementById('edit-input-'+other).value=162-v;
}

function editRound(i){
  const g=current;if(!g) return;
  const r=g.rounds[i];
  document.getElementById('edit-round-index').value=i;
  document.getElementById('edit-input-wij').value=r.w;
  document.getElementById('edit-input-zij').value=r.z;
  document.getElementById('edit-input-roem-wij').value=r.rw||0;
  document.getElementById('edit-input-roem-zij').value=r.rz||0;
  const specRow=document.getElementById('edit-special-row');
  const specLabel=document.getElementById('edit-special-label');
  const manualSpecial=(r.special||'').replace(/\s*\(auto\)/,'').trim();
  if(manualSpecial&&!manualSpecial.includes('(auto)')){
    specRow.style.display='flex';
    specLabel.textContent=manualSpecial;
  } else {
    specRow.style.display='none';
  }
  openModal('modal-edit-round');
}
function clearEditSpecial(){
  const g=current;if(!g) return;
  const i=parseInt(document.getElementById('edit-round-index').value);
  const r=g.rounds[i];if(!r) return;
  r.special='';
  refreshRoundAutoSpecial(g,r);
  recalcGameTotals(g);saveAll();
  document.getElementById('edit-special-row').style.display='none';
  renderGame();
  showToast('✓ Bijzonderheid verwijderd');
}

function saveEditedRound(){
  const g=current;if(!g) return;
  const i=parseInt(document.getElementById('edit-round-index').value);
  const r=g.rounds[i];
  if(!r) return;
  const newW=parseInt(document.getElementById('edit-input-wij').value);
  const newZ=parseInt(document.getElementById('edit-input-zij').value);
  const newRW=parseInt(document.getElementById('edit-input-roem-wij').value)||0;
  const newRZ=parseInt(document.getElementById('edit-input-roem-zij').value)||0;
  if(isNaN(newW)||isNaN(newZ)) return showToast('Vul punten voor beide teams in',true);
  if(newW<0||newZ<0||newW>162||newZ>162) return showToast('Punten moeten tussen 0 en 162 liggen',true);
  if(newW+newZ!==162) return showToast('Punten van Wij en Zij moeten samen 162 zijn',true);
  if(!isValidRoem(newRW)) return showToast('Roem Wij klopt niet — gebruik veelvouden van 20, 50 of 100',true);
  if(!isValidRoem(newRZ)) return showToast('Roem Zij klopt niet — gebruik veelvouden van 20, 50 of 100',true);
  r.w=newW;r.z=newZ;r.rw=newRW;r.rz=newRZ;
  refreshRoundAutoSpecial(g,r);
  recalcGameTotals(g);
  saveAll();
  closeModal('modal-edit-round');
  renderGame();
  showToast('✓ Blaadje '+(i+1)+' aangepast');
}

// ══════════════════════════════════════════
//  END GAME
// ══════════════════════════════════════════
function handleEndGameButton(){
  const g=current;if(!g) return;
  confirmEndGame();
}

function confirmEndGame(){
  const g=current;if(!g) return;
  const allWij=[...g.wij,...(g.wijBench||[])];
  const allZij=[...g.zij,...(g.zijBench||[])];
  const wn=allWij.map(id=>getPlayer(id)?.name||'?').join(' & ');
  const zn=allZij.map(id=>getPlayer(id)?.name||'?').join(' & ');
  const rondes=g.rounds.length;
  const boom=rondes>=16?'✅ Volledige boom (16 blaadjes)':'⚠️ Vroeg gestopt ('+rondes+'/16 blaadjes)';
  const saveBtn=document.getElementById('end-game-save-btn');
  if(saveBtn) saveBtn.textContent=rondes>=16?'✓ Opslaan en nieuwe boom starten':'✓ Opslaan & afsluiten';
  document.getElementById('end-game-summary').innerHTML=`
    <div style="text-align:center">
      <div style="font-size:12px;color:rgba(245,240,232,.4);margin-bottom:8px">${boom}</div>
      <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;color:var(--gold);text-transform:uppercase;opacity:.7;margin-bottom:2px">Wij</div>
      <div style="font-size:13px;color:rgba(245,240,232,.6)">${wn}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin:8px 0">
        <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:900;color:var(--gold)">${g.scoreWij}</div>
        <div style="color:rgba(245,240,232,.3)">–</div>
        <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:900;color:var(--gold)">${g.scoreZij}</div>
      </div>
      <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;color:var(--gold);text-transform:uppercase;opacity:.7;margin-bottom:2px">Zij</div>
      <div style="font-size:13px;color:rgba(245,240,232,.6)">${zn}</div>
    </div>`;
  openModal('modal-end-game');
  // Toon verliesvideo direct als een team minder dan 1000 haalt (voor opslaan)
  if(g.rounds.length>=16){
    recalcGameTotals(g);
    const minScore=Math.min(g.scoreWij,g.scoreZij);
    if(minScore<1000){
      const verliesNaam=g.scoreWij<=g.scoreZij?
        allWij.map(id=>getPlayer(id)?.name||'?').join(' & '):
        allZij.map(id=>getPlayer(id)?.name||'?').join(' & ');
      setTimeout(()=>showVerliesVideo(verliesNaam),800);
    }
  }
}

function endGame(){
  const g=current;if(!g) return;
  recalcGameTotals(g);
  g.active=false;g.finalWij=g.scoreWij;g.finalZij=g.scoreZij;g.endDate=new Date().toISOString();
  const wijWon=g.scoreWij>g.scoreZij,draw=g.scoreWij===g.scoreZij;
  const completed=g.rounds.length>=16;

  function countSp(tag){return g.rounds.filter(r=>r.special&&r.special.includes(tag)).length}

  // Per-player stats are not updated here; they will be recalculated from the games list.
  // Maker stats will also be recalculated by recalcPlayerStats().

  g.completed=completed;
  // Game zit al in de games-array (actieve games worden daar bijgehouden)
  // Voeg toe aan actief toernooi indien aanwezig
  const activeTournament=tournaments.find(t=>t.active);
  if(activeTournament&&!activeTournament.gameIds.includes(String(g.id))) activeTournament.gameIds.push(String(g.id));
  localStorage.removeItem('kj_viewing_id');
  current=null;
  // Recalculate player stats after saving the completed game
  recalcPlayerStats();
  saveAll();
  closeModal('modal-end-game');
  showToast('🏁 Boom opgeslagen!');
  switchView('home');
}

// ══════════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════════
function renderHistory(){
  const el=document.getElementById('history-list');
  if(!games.length){el.innerHTML=`<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Nog geen spellen</div><div class="empty-sub">Start je eerste boom!</div></div>`;return}
  el.innerHTML=[...games].reverse().map(g=>{
    const wn=[...g.wij,...(g.wijBench||[])].map(id=>getPlayer(id)?.name||'?').join(' & ');
    const zn=[...g.zij,...(g.zijBench||[])].map(id=>getPlayer(id)?.name||'?').join(' & ');
    const d=new Date(g.date).toLocaleDateString('nl-NL',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    const scoreW=g.active?g.scoreWij:g.finalWij;
    const scoreZ=g.active?g.scoreZij:g.finalZij;
    const won=scoreW>scoreZ,draw=scoreW===scoreZ;
    const boomTag=g.active?'🔴':g.completed?'🌳':'🌿';
    const statusTag=g.active
      ?`<span class="tag" style="background:rgba(39,174,96,.2);color:#2ecc71">Bezig</span>`
      :draw?`<span class="tag tag-draw">Gelijk</span>`:won?`<span class="tag tag-win">Wij won</span>`:`<span class="tag tag-loss">Zij won</span>`;
    return `<div class="game-tile">
      <div class="game-tile-header">
        <span class="game-date">${d} · ${g.rounds.length} blaadjes ${boomTag}</span>
        ${statusTag}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div onclick="${g.active?`openTable('${g.id}')`:`openGameDetail('${g.id}')`}" style="flex:1;cursor:pointer">
          <div style="font-size:12px;color:rgba(245,240,232,.5);margin-bottom:2px">${wn} vs ${zn}</div>
          <div class="game-score-big">${scoreW} – ${scoreZ}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="editGameFromHistory('${g.id}')" style="background:rgba(201,168,76,.15);border:1px solid rgba(201,168,76,.3);color:var(--gold);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer">✏️</button>
          <button onclick="deleteGame('${g.id}')" style="background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.3);color:var(--red);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function deleteGame(id){
  doConfirm('Spel verwijderen','Weet je zeker dat je dit spel wilt verwijderen? Statistieken worden aangepast om dit spel te negeren.',()=>{
    // Remove the game
    games=games.filter(g=>String(g.id)!==String(id));
    // Recalculate player stats after deletion
    recalcPlayerStats();
    saveAll();
    renderHistory();
    showToast('Spel verwijderd');
  });
}

function editGameFromHistory(id){
  const g=games.find(x=>String(x.id)===String(id));if(!g) return;
  doConfirm('Spel hervatten','Dit spel wordt hervat zodat je het kunt aanpassen.',()=>{
    g.active=true;
    delete g.finalWij;
    delete g.finalZij;
    delete g.endDate;
    recalcGameTotals(g);
    localStorage.setItem('kj_viewing_id',String(g.id));
    current=g;
    recalcPlayerStats();
    saveAll();
    switchView('game');
    showToast('Spel hervat voor bewerking');
  });
}

function openGameDetail(id){
  const g=games.find(x=>String(x.id)===String(id));if(!g) return;
  const wn=g.wij.map(id=>getPlayer(id)?.name||'?').join(' & ');
  const zn=g.zij.map(id=>getPlayer(id)?.name||'?').join(' & ');
  const dateStr=new Date(g.date).toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const fw=typeof g.finalWij==='number'?g.finalWij:g.scoreWij;
  const fz=typeof g.finalZij==='number'?g.finalZij:g.scoreZij;

  function scoreCell(pts,rSp,team){
    const N=`<b style="color:#e74c3c">N</b>`;
    const V=`<b style="color:#3498db">V</b>`;
    const P=`<b style="color:#9b59b6">P</b>`;
    if(rSp.includes('NAT '+team))  return `${N} 0`;
    if(rSp.includes('VERZ '+team)) return `${V} 0`;
    if(rSp.includes('PIT '+team))  return `${P} ${pts}`;
    return `${pts}`;
  }

  let rows='';
  let cumW=0,cumZ=0,cumRW=0,cumRZ=0;
  g.rounds.forEach((r,i)=>{
    const rSp=r.special||'';
    let pw=r.w,pz=r.z;
    if(rSp.includes('NAT WIJ')||rSp.includes('VERZ WIJ')){pw=0;pz=162;}
    else if(rSp.includes('NAT ZIJ')||rSp.includes('VERZ ZIJ')){pw=162;pz=0;}
    let dispRW=r.rw||0,dispRZ=r.rz||0;
    if(rSp.includes('NAT WIJ')||rSp.includes('VERZ WIJ')){dispRZ=(r.rw||0)+(r.rz||0);dispRW=0;}
    else if(rSp.includes('NAT ZIJ')||rSp.includes('VERZ ZIJ')){dispRW=(r.rw||0)+(r.rz||0);dispRZ=0;}
    cumW+=pw;cumZ+=pz;cumRW+=dispRW;cumRZ+=dispRZ;
    const rondeSpelerId=r.spelId||r.spelWij||r.spelZij;
    const spelNaam=rondeSpelerId?getPlayer(+rondeSpelerId)?.name?.split(' ')[0]:'';
    const uitNaam=r.uitId?getPlayer(+r.uitId)?.name?.split(' ')[0]:'';
    const wasGekaapt=r.uitId&&String(r.uitId)!==String(rondeSpelerId);
    const rondeLabel=wasGekaapt
      ?`<div style="font-size:9px;color:rgba(245,240,232,.4)">${uitNaam} <span style="opacity:.5">uitb.</span></div>
        <div style="font-size:9px;color:rgba(245,240,232,.7)">↳ ${spelNaam} <span style="opacity:.5">speelde</span></div>`
      :`<div style="font-size:9px;color:rgba(245,240,232,.5)">${spelNaam}</div>`;
    rows+=`<tr>
      <td style="text-align:right;color:rgba(201,168,76,.65);font-size:11px;min-width:28px">${dispRW||'—'}</td>
      <td style="text-align:right;font-size:14px;font-weight:700;padding-right:6px">${scoreCell(pw,rSp,'WIJ')}</td>
      <td style="text-align:center;font-size:11px;color:rgba(245,240,232,.45);line-height:1.5;padding:5px 2px">
        <b style="color:rgba(245,240,232,.65)">${i+1}.</b>
        ${rondeLabel}
      </td>
      <td style="text-align:left;font-size:14px;font-weight:700;padding-left:6px">${scoreCell(pz,rSp,'ZIJ')}</td>
      <td style="text-align:left;color:rgba(201,168,76,.65);font-size:11px;min-width:28px">${dispRZ||'—'}</td>
    </tr>`;
    if((i+1)%4===0&&i<g.rounds.length-1){
      const takkieNum=(i+1)/4;
      rows+=`<tr style="background:rgba(201,168,76,.07)">
        <td style="text-align:right;font-size:10px;color:rgba(201,168,76,.55);padding:5px 3px">${cumRW||''}</td>
        <td style="text-align:right;font-weight:700;color:var(--gold);font-size:13px;padding-right:6px">${cumW}</td>
        <td style="text-align:center;font-size:9px;color:rgba(201,168,76,.6);letter-spacing:.8px;padding:5px 2px">TAKKIE ${takkieNum}</td>
        <td style="text-align:left;font-weight:700;color:var(--gold);font-size:13px;padding-left:6px">${cumZ}</td>
        <td style="text-align:left;font-size:10px;color:rgba(201,168,76,.55);padding:5px 3px">${cumRZ||''}</td>
      </tr>`;
    }
  });

  document.getElementById('modal-game-detail-content').innerHTML=`
    <div class="modal-title">Spel details <span class="modal-close" onclick="closeModal('modal-game-detail')">✕</span></div>
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:11px;color:rgba(245,240,232,.4);margin-bottom:6px">${dateStr}</div>
      <div style="font-size:12px;color:rgba(245,240,232,.6)">${wn}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin:6px 0">
        <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:900;color:${fw>fz?'var(--win)':'var(--gold)'}">${fw}</div>
        <div style="color:rgba(245,240,232,.25)">–</div>
        <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:900;color:${fz>fw?'var(--win)':'var(--gold)'}">${fz}</div>
      </div>
      <div style="font-size:12px;color:rgba(245,240,232,.6)">${zn}</div>
      <div style="font-size:11px;color:rgba(245,240,232,.35);margin-top:6px">${g.rounds.length} blaadjes · Roem: ${g.roemWij||0} – ${g.roemZij||0} · ${g.completed?'🌳 Volledige boom':'🌿 Onvolledig'}</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-size:11px;color:rgba(245,240,232,.5);font-weight:600;letter-spacing:.8px">${wn.toUpperCase()}</span>
      <span style="font-size:11px;color:rgba(245,240,232,.5);font-weight:600;letter-spacing:.8px">${zn.toUpperCase()}</span>
    </div>
    <table class="round-table" style="width:100%">
      <tbody>${rows}</tbody>
      <tfoot><tr class="totaal-row">
        <td style="text-align:right;font-size:11px">${g.roemWij||0}</td>
        <td style="text-align:right">${fw}</td>
        <td style="text-align:center;font-size:10px;letter-spacing:.8px">TOTAAL</td>
        <td style="text-align:left">${fz}</td>
        <td style="text-align:left;font-size:11px">${g.roemZij||0}</td>
      </tr></tfoot>
    </table>`;
  openModal('modal-game-detail');
}

// ══════════════════════════════════════════
//  STATISTICS
// ══════════════════════════════════════════
let statsFilter='algemeen';
let duoStatsFilter='all';

function renderStats(){
  // Ensure player stats reflect current games before rendering stats
  recalcPlayerStats();
  const filterEl=document.getElementById('stats-filter-row');
  const filters=[
    {k:'algemeen',l:'📊 Algemeen'},
    {k:'duo',l:'👫 Duo\'s'},
    {k:'tegenstanders',l:'⚔️ vs Tegenstanders'},
    {k:'records',l:'🏆 Records'},
  ];
  filterEl.innerHTML=filters.map(f=>`<div class="filter-chip ${statsFilter===f.k?'active':''}" onclick="setStatsFilter('${f.k}')">${f.l}</div>`).join('');
  renderStatsContent();
}

function setStatsFilter(f){statsFilter=f;renderStats()}

function renderStatsContent(){
  const el=document.getElementById('stats-content');
  if(!games.length){el.innerHTML=`<div class="empty"><div class="empty-icon">📊</div><div class="empty-text">Nog geen statistieken</div><div class="empty-sub">Speel eerst een paar bomen!</div></div>`;return}
  if(statsFilter==='algemeen') el.innerHTML=renderAlgemeenStats();
  else if(statsFilter==='duo') el.innerHTML=renderDuoStats();
  else if(statsFilter==='tegenstanders') el.innerHTML=renderTegStats();
  else if(statsFilter==='records') el.innerHTML=renderRecordsStats();
}

function renderAlgemeenStats(){
  const totGames=games.length;
  const totRondes=games.reduce((s,g)=>s+g.rounds.length,0);
  const completedBomen=games.filter(g=>g.completed).length;
  let allNat=0,allVerz=0,allPit=0;
  games.forEach(g=>g.rounds.forEach(r=>{if(r.special){if(r.special.includes('NAT'))allNat++;if(r.special.includes('VERZ'))allVerz++;if(r.special.includes('PIT'))allPit++;}}));
  const topScorer=players.sort((a,b)=>b.highScore-a.highScore)[0];
  const mostWins=players.sort((a,b)=>b.wins-a.wins)[0];
  return `
    <div class="card">
      <div class="card-label">Overzicht</div>
      <div class="stat-grid">
        <div class="stat-box"><div class="stat-value">${totGames}</div><div class="stat-label">🌳 Bomen</div></div>
        <div class="stat-box"><div class="stat-value">${completedBomen}</div><div class="stat-label">✅ Volledig</div></div>
        <div class="stat-box"><div class="stat-value">${totRondes}</div><div class="stat-label">🔄 Rondes</div></div>
        <div class="stat-box"><div class="stat-value">${Math.round(totRondes/(totGames||1))}</div><div class="stat-label">Gem. blaadjes</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-label">Speciale situaties (totaal)</div>
      <div class="stat-grid">
        <div class="stat-box"><div class="stat-value" style="color:#e74c3c">${allNat}</div><div class="stat-label">💧 Nat</div></div>
        <div class="stat-box"><div class="stat-value" style="color:#3498db">${allVerz}</div><div class="stat-label">🔵 Verzaakt</div></div>
        <div class="stat-box"><div class="stat-value" style="color:#9b59b6">${allPit}</div><div class="stat-label">💥 Pit</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-label">Leaderboard</div>
      ${players.sort((a,b)=>b.wins-a.wins).map((p,i)=>{
        const wr=p.games?Math.round(p.wins/p.games*100):0;
        return `<div class="stat-row">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="font-size:16px">${['🥇','🥈','🥉'][i]||'  '}</div>
            <div>
              <div style="font-weight:700">${p.name}</div>
              <div style="font-size:11px;color:rgba(245,240,232,.4)">${p.wins}× gewonnen van ${p.games} bomen</div>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:700;color:var(--gold)">${wr}%</div>
            <div style="font-size:10px;color:rgba(245,240,232,.35)">winrate</div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function getDuoKey(a,b){return [a,b].sort().join('-')}

function renderDuoStats(){
  const duos={};
  games.forEach(g=>{
    const teams=[[...g.wij],[...g.zij]];
    teams.forEach((team,ti)=>{
      if(team.length<2) return;
      const key=getDuoKey(team[0],team[1]);
      if(!duos[key]) duos[key]={key,p1:team[0],p2:team[1],games:0,wins:0,losses:0,draws:0,nat:0,verz:0,pit:0,
        natByP1:0,natByP2:0,natUnknown:0,pitByP1:0,pitByP2:0,pitUnknown:0,verzByP1:0,verzByP2:0,verzUnknown:0,completedBomen:0};
      const d=duos[key];
      d.games++;
      const isWij=ti===0;
      const won=isWij?(g.finalWij>g.finalZij):(g.finalZij>g.finalWij);
      const draw=g.finalWij===g.finalZij;
      if(draw) d.draws++; else if(won) d.wins++; else d.losses++;
      if(g.completed) d.completedBomen++;
      g.rounds.forEach(r=>{
        if(!r.special) return;
        const sp=r.special;
        const teamTag=isWij?'WIJ':'ZIJ';
        if(sp.includes('NAT '+teamTag)){
          d.nat++;
          // Maker: spelWij/spelZij > spelId (fallback oude data) > uitId
          let natMaker=isWij?+r.spelWij:+r.spelZij;
          if(!natMaker) natMaker=+r.spelId||0;
          if(!natMaker&&r.uitId&&team.includes(+r.uitId)) natMaker=+r.uitId;
          if(natMaker===team[0]) d.natByP1++;
          else if(natMaker===team[1]) d.natByP2++;
          else d.natUnknown++;
        }
        if(sp.includes('VERZ '+teamTag)){
          d.verz++;
          // verzPlayerId > spelWij/spelZij (team-specifiek) > spelId (oude data zonder spelWij)
          const vId=r.verzPlayerId||(isWij?r.spelWij:r.spelZij)||r.spelId;
          const vm=+vId;
          if(vm===team[0]) d.verzByP1++;
          else if(vm===team[1]) d.verzByP2++;
          else d.verzUnknown++;
        }
        if(sp.includes('PIT '+teamTag)){
          d.pit++;
          const pitMaker=isWij?+r.spelWij:+r.spelZij;
          if(pitMaker===team[0]) d.pitByP1++;
          else if(pitMaker===team[1]) d.pitByP2++;
          else d.pitUnknown++;
        }
      });
    });
  });

  const entries=Object.values(duos).sort((a,b)=>{
    const wrA=a.games?a.wins/a.games:0;
    const wrB=b.games?b.wins/b.games:0;
    return wrB-wrA||b.games-a.games;
  });
  if(!entries.length) return `<div class="empty"><div class="empty-icon">👫</div><div class="empty-text">Nog geen duo-data</div></div>`;

  if(duoStatsFilter!=='all' && !entries.find(d=>d.key===duoStatsFilter)) duoStatsFilter='all';
  const cards=entries.map(d=>{
    const p1=getPlayer(d.p1),p2=getPlayer(d.p2);
    if(!p1||!p2) return '';
    const wr=d.games?Math.round(d.wins/d.games*100):0;
    const natAvg=d.games?(d.nat/d.games).toFixed(1):0;
    const verzAvg=d.games?(d.verz/d.games).toFixed(1):0;
    return `<div class="duo-card">
      <div class="duo-header">
        <div style="display:flex;gap:-6px">
          <div class="avatar" style="width:36px;height:36px;font-size:14px">${p1.name[0]}</div>
          <div class="avatar" style="width:36px;height:36px;font-size:14px;margin-left:-8px">${p2.name[0]}</div>
        </div>
        <div>
          <div class="duo-name">${p1.name} & ${p2.name}</div>
          <div style="font-size:11px;color:rgba(245,240,232,.4)">${d.games} bomen samen</div>
        </div>
        <div style="margin-left:auto;text-align:right">
          <div style="font-weight:700;color:${wr>=50?'var(--win)':'var(--loss)'}">${wr}%</div>
          <div style="font-size:10px;color:rgba(245,240,232,.35)">winrate</div>
        </div>
      </div>
      <div class="bar-wrap" style="margin-bottom:10px"><div class="bar-fill" style="width:${wr}%"></div></div>
      <div class="stat-grid" style="margin-bottom:10px">
        <div class="stat-box"><div class="stat-value" style="color:var(--win)">${d.wins}</div><div class="stat-label">🏆 Gewonnen</div></div>
        <div class="stat-box"><div class="stat-value" style="color:var(--loss)">${d.losses}</div><div class="stat-label">💀 Verloren</div></div>
        <div class="stat-box"><div class="stat-value">${d.completedBomen}</div><div class="stat-label">🌳 Volledige bomen</div></div>
        <div class="stat-box"><div class="stat-value">${d.games-d.completedBomen}</div><div class="stat-label">🌿 Onvolledig</div></div>
      </div>
      <div class="stat-grid">
        <div class="stat-box">
          <div class="stat-value" style="color:#e74c3c">${d.nat}</div><div class="stat-label">💧 Keer nat</div>
          ${d.nat>0?`<div style="font-size:10px;color:rgba(245,240,232,.4);margin-top:4px">${p1.name}: ${d.natByP1}× · ${p2.name}: ${d.natByP2}×${d.natUnknown?` · ?: ${d.natUnknown}×`:''}</div>`:''}
        </div>
        <div class="stat-box">
          <div class="stat-value" style="color:#9b59b6">${d.pit}</div><div class="stat-label">💥 Pit</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style="color:#3498db">${d.verz}</div><div class="stat-label">🔵 Verzaakt</div>
          ${d.verz>0?`<div style="font-size:10px;color:rgba(245,240,232,.4);margin-top:4px">${p1.name}: ${d.verzByP1}× · ${p2.name}: ${d.verzByP2}×${d.verzUnknown?` · ?: ${d.verzUnknown}×`:''}</div>`:''}
        </div>
      </div>
    </div>`;
  }).join('');

  return cards;
}

function renderTegStats(){
  // Head-to-head between duo pairs
  const matchups={};
  games.forEach(g=>{
    const wKey=getDuoKey(g.wij[0],g.wij[1]);
    const zKey=getDuoKey(g.zij[0],g.zij[1]);
    const mk=wKey+'|'+zKey;
    const mk2=zKey+'|'+wKey;
    const key=mk<mk2?mk:mk2;
    if(!matchups[key]) matchups[key]={wDuo:g.wij,zDuo:g.zij,games:0,wWins:0,zWins:0,draws:0};
    const m=matchups[key];m.games++;
    if(g.finalWij>g.finalZij) m.wWins++;
    else if(g.finalZij>g.finalWij) m.zWins++;
    else m.draws++;
  });
  const entries=Object.values(matchups).sort((a,b)=>b.games-a.games);
  if(!entries.length) return `<div class="empty"><div class="empty-icon">⚔️</div><div class="empty-text">Nog geen onderlinge duels</div></div>`;
  return entries.map(m=>{
    const wn=m.wDuo.map(id=>getPlayer(id)?.name||'?').join(' & ');
    const zn=m.zDuo.map(id=>getPlayer(id)?.name||'?').join(' & ');
    const wWr=m.games?Math.round(m.wWins/m.games*100):0;
    return `<div class="duo-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div><div style="font-weight:700;font-size:14px">${wn}</div><div style="font-size:10px;color:rgba(245,240,232,.4)">vs</div><div style="font-weight:700;font-size:14px">${zn}</div></div>
        <div style="text-align:right"><div style="font-size:11px;color:rgba(245,240,232,.4)">${m.games} duels</div></div>
      </div>
      <div class="stat-row"><span>${wn}</span><span style="font-weight:700;color:var(--win)">${m.wWins}× gewonnen (${wWr}%)</span></div>
      <div class="stat-row"><span>${zn}</span><span style="font-weight:700;color:var(--loss)">${m.zWins}× gewonnen (${Math.round(m.zWins/m.games*100)}%)</span></div>
      ${m.draws?`<div class="stat-row"><span>Gelijk</span><span>${m.draws}×</span></div>`:''}
    </div>`;
  }).join('');
}

function renderRecordsStats(){
  const active=players.filter(p=>p.games>0);
  if(!active.length) return `<div class="empty"><div class="empty-icon">🏆</div><div class="empty-text">Nog geen records</div></div>`;

  function av(p){
    if(!p) return '';
    const img=p.photo?`<img src="${p.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:`<span style="font-size:13px;font-weight:700">${p.name[0].toUpperCase()}</span>`;
    return `<div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--green-light));display:flex;align-items:center;justify-content:center;color:var(--green);flex-shrink:0;overflow:hidden;border:2px solid rgba(201,168,76,.4)">${img}</div>`;
  }
  function longestStreak(pid,type){
    const form=getPlayerForm(pid);let max=0,cur=0;
    form.results.forEach(r=>{if(r===type){cur++;if(cur>max)max=cur;}else cur=0;});
    return max;
  }
  function row(icon,label,p,val,extra=''){
    if(!p) return '';
    return `<div class="stat-row">
      <div style="display:flex;align-items:center;gap:10px">
        ${av(p)}
        <div>
          <div style="font-size:13px;font-weight:600">${icon} ${label}</div>
          <div style="font-size:11px;color:rgba(245,240,232,.4)">${p.name}${extra}</div>
        </div>
      </div>
      <div style="font-weight:700;color:var(--gold);text-align:right">${val}</div>
    </div>`;
  }

  // Grootste comeback: max achterstand op enig moment in gewonnen spel
  let biggestComeback={pid:null,val:0};
  // Laagste eindscore
  let lowestScore={pid:null,val:Infinity};
  // Vaakst overwinning verspeeld (voorstond halverwege maar verloor)
  const verspeeld={};
  games.filter(g=>!g.active&&g.rounds.length>=2).forEach(g=>{
    const fw=(typeof g.finalWij==='number')?g.finalWij:g.scoreWij;
    const fz=(typeof g.finalZij==='number')?g.finalZij:g.scoreZij;
    if(fw===fz) return;
    const wijWon=fw>fz;
    // Laagste score
    const loser=wijWon?fz:fw;
    if(loser<lowestScore.val){
      lowestScore={pid:(wijWon?g.zij:g.wij)[0],val:loser};
    }
    // Grootste comeback
    let wR=0,zR=0,maxDeficit=0;
    g.rounds.forEach(r=>{
      wR+=r.w+r.rw; zR+=r.z+r.rz;
      const deficit=wijWon?zR-wR:wR-zR;
      if(deficit>maxDeficit) maxDeficit=deficit;
    });
    if(maxDeficit>biggestComeback.val){
      biggestComeback={pid:(wijWon?g.wij:g.zij)[0],val:maxDeficit};
    }
    // Overwinning verspeeld: alleen tellen als er exact >=8 blaadjes zijn gespeeld
    // en het team na 2 takkies (8 blaadjes) voor stond maar uiteindelijk verloor
    if(g.rounds.length>=8){
      let wH=0,zH=0;
      g.rounds.slice(0,8).forEach(r=>{wH+=r.w+r.rw;zH+=r.z+r.rz;});
      if(wH>zH&&!wijWon){
        [...g.wij,...(g.wijBench||[])].forEach(pid=>{verspeeld[pid]=(verspeeld[pid]||0)+1;});
      } else if(zH>wH&&wijWon){
        [...g.zij,...(g.zijBench||[])].forEach(pid=>{verspeeld[pid]=(verspeeld[pid]||0)+1;});
      }
    }
  });

  const byVerspeeld=[...active].filter(p=>verspeeld[p.id]>0).sort((a,b)=>(verspeeld[b.id]||0)-(verspeeld[a.id]||0));

  const byWins=[...active].sort((a,b)=>b.wins-a.wins);
  const byHighScore=[...active].sort((a,b)=>b.highScore-a.highScore);
  const byGames=[...active].sort((a,b)=>b.games-a.games);
  const byWr=active.filter(p=>p.games>=2).sort((a,b)=>(b.wins/b.games)-(a.wins/a.games));
  const byNat=[...active].sort((a,b)=>b.nat-a.nat);
  const byVerz=[...active].sort((a,b)=>(b.verz||0)-(a.verz||0));
  const byPit=[...active].sort((a,b)=>(b.pit||0)-(a.pit||0));
  const byLosses=[...active].sort((a,b)=>b.losses-a.losses);
  const byKaap=[...active].sort((a,b)=>(b.roundsKaap||0)-(a.roundsKaap||0));
  const byWinStreak=[...active].map(p=>({p,s:longestStreak(p.id,'W')})).sort((a,b)=>b.s-a.s);
  const byLossStreak=[...active].map(p=>({p,s:longestStreak(p.id,'V')})).sort((a,b)=>b.s-a.s);
  const onFire=active.filter(p=>{const f=getPlayerForm(p.id);return f.streak>=3&&f.streakType==='W';}).sort((a,b)=>getPlayerForm(b.id).streak-getPlayerForm(a.id).streak);
  const koud=active.filter(p=>{const f=getPlayerForm(p.id);return f.streak>=3&&f.streakType==='V';}).sort((a,b)=>getPlayerForm(b.id).streak-getPlayerForm(a.id).streak);

  const trendsHTML=(onFire.length||koud.length)?`
    <div class="card">
      <div class="card-label">🔥 Huidige vorm</div>
      ${onFire.map(p=>{const f=getPlayerForm(p.id);return row('🔥','On fire!',p,`${f.streak}× op rij gewonnen`);}).join('')}
      ${koud.map(p=>{const f=getPlayerForm(p.id);return row('😰','Tegenvallende reeks',p,`${f.streak}× op rij verloren`);}).join('')}
    </div>`:'';

  return trendsHTML+`
    <div class="card">
      <div class="card-label">🏅 Erelijst</div>
      ${row('🏆','Meeste overwinningen',byWins[0],byWins[0]?.wins+'× gewonnen')}
      ${row('⭐','Hoogste score ooit',byHighScore[0],byHighScore[0]?.highScore+' punten')}
      ${row('📈','Beste winrate',byWr[0],byWr[0]?Math.round(byWr[0].wins/byWr[0].games*100)+'%':'—',' (min. 2 bomen)')}
      ${row('🎮','Meest actief',byGames[0],byGames[0]?.games+' bomen gespeeld')}
      ${row('🔥','Langste winststreek ooit',byWinStreak[0]?.p,byWinStreak[0]?.s+'× op rij')}
      ${row('💥','Meeste pits',byPit[0],(byPit[0]?.pit||0)+'× pit')}
      ${row('🦅','Vaakst gekaapt',byKaap[0],(byKaap[0]?.roundsKaap||0)+'× andermans beurt gepakt')}
      ${biggestComeback.pid?row('📈','Grootste comeback',getPlayer(biggestComeback.pid),'+'+biggestComeback.val+' punten achterstand omgebogen'):''}
    </div>
    <div class="card">
      <div class="card-label">😅 Twijfelachtige records</div>
      ${row('💧','Vaakst nat',byNat[0],byNat[0]?.nat+'× nat')}
      ${row('🔵','Vaakst verzaakt',byVerz[0],(byVerz[0]?.verz||0)+'× verzaakt')}
      ${row('💀','Meeste verliespartijen',byLosses[0],byLosses[0]?.losses+'× verloren')}
      ${row('😰','Langste verliesreeks ooit',byLossStreak[0]?.p,byLossStreak[0]?.s+'× op rij verloren')}
      ${byVerspeeld[0]?row('😬','Vaakst overwinning verspeeld',byVerspeeld[0],(verspeeld[byVerspeeld[0].id]||0)+'× voorgestaan maar toch verloren'):''}
      ${lowestScore.pid?row('📉','Laagste eindscore',getPlayer(lowestScore.pid),lowestScore.val+' punten'):''}
    </div>
    ${(()=>{
      // Duo records
      const duoMap={};
      games.filter(g=>!g.active&&g.wij.length>=2&&g.zij.length>=2).forEach(g=>{
        [[g.wij,true],[g.zij,false]].forEach(([team,isWij])=>{
          const key=getDuoKey(team[0],team[1]);
          if(!duoMap[key]) duoMap[key]={p1:team[0],p2:team[1],games:0,wins:0,nat:0,verz:0};
          const d=duoMap[key]; d.games++;
          const fw=(typeof g.finalWij==='number')?g.finalWij:g.scoreWij;
          const fz=(typeof g.finalZij==='number')?g.finalZij:g.scoreZij;
          if(isWij?fw>fz:fz>fw) d.wins++;
          g.rounds.forEach(r=>{
            if(!r.special) return;
            const tag=isWij?'WIJ':'ZIJ';
            if(r.special.includes('NAT '+tag)) d.nat++;
            if(r.special.includes('VERZ '+tag)) d.verz++;
          });
        });
      });
      const duos=Object.values(duoMap).filter(d=>d.games>0);
      if(!duos.length) return '';
      function drow(icon,label,d,val){
        if(!d) return '';
        const p1=getPlayer(d.p1),p2=getPlayer(d.p2);
        if(!p1||!p2) return '';
        const imgs=[p1,p2].map(p=>{
          const img=p.photo?`<img src="${p.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:`<span style="font-size:11px;font-weight:700">${p.name[0]}</span>`;
          return `<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--green-light));display:flex;align-items:center;justify-content:center;color:var(--green);overflow:hidden;border:2px solid rgba(201,168,76,.4)">${img}</div>`;
        }).join('');
        return `<div class="stat-row">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="display:flex">${imgs}</div>
            <div>
              <div style="font-size:13px;font-weight:600">${icon} ${label}</div>
              <div style="font-size:11px;color:rgba(245,240,232,.4)">${p1.name} & ${p2.name}</div>
            </div>
          </div>
          <div style="font-weight:700;color:var(--gold);text-align:right">${val}</div>
        </div>`;
      }
      const byWr=duos.filter(d=>d.games>=2).sort((a,b)=>(b.wins/b.games)-(a.wins/a.games));
      const byGames=[...duos].sort((a,b)=>b.games-a.games);
      const byNat=[...duos].sort((a,b)=>b.nat-a.nat);
      const byVerz=[...duos].sort((a,b)=>b.verz-a.verz);
      return `<div class="card">
        <div class="card-label">🤝 Duo records</div>
        ${drow('🏆','Beste duo',byWr[0]||byGames[0],byWr[0]?Math.round(byWr[0].wins/byWr[0].games*100)+'% winrate':(Math.round((byGames[0]?.wins||0)/(byGames[0]?.games||1)*100)+'% winrate'))}
        ${drow('🎮','Meest samen gespeeld',byGames[0],byGames[0]?.games+' bomen')}
        ${byNat[0]?.nat>0?drow('💧','Vaakst samen nat',byNat[0],byNat[0].nat+'× nat'):''}
        ${byVerz[0]?.verz>0?drow('🔵','Vaakst samen verzaakt',byVerz[0],byVerz[0].verz+'× verzaakt'):''}
      </div>`;
    })()}`;
}

// ══════════════════════════════════════════
//  HOME
// ══════════════════════════════════════════
function renderHome(){
  // Actieve tafels
  const activeGames=games.filter(g=>g.active);
  const tafelsSection=document.getElementById('active-tafels-section');
  const tafelsEl=document.getElementById('active-tafels-list');
  if(tafelsSection&&tafelsEl){
    if(activeGames.length){
      tafelsSection.style.display='block';
      const viewId=localStorage.getItem('kj_viewing_id');
      tafelsEl.innerHTML=activeGames.map(g=>{
        const wn=g.wij.map(id=>getPlayer(id)?.name||'?').join(' & ');
        const zn=g.zij.map(id=>getPlayer(id)?.name||'?').join(' & ');
        const rnd=Math.min(g.rounds.length+1,16);
        const isViewing=String(g.id)===viewId;
        return `<div class="game-tile" onclick="openTable('${g.id}')" style="cursor:pointer;${isViewing?'border-color:var(--gold);border-width:2px':''}">
          <div class="game-tile-header">
            <span class="game-date">🌳 Blaadje ${rnd}/16 · Takkie ${Math.ceil(rnd/4)}/4</span>
            ${isViewing?'<span class="tag tag-win">Jouw tafel</span>':'<span class="tag" style="background:rgba(201,168,76,.15);color:var(--gold)">Open ›</span>'}
          </div>
          <div style="font-size:12px;color:rgba(245,240,232,.5);margin-bottom:4px">${wn} vs ${zn}</div>
          <div class="game-score-big">${g.scoreWij} – ${g.scoreZij}</div>
        </div>`;
      }).join('');
    } else {
      tafelsSection.style.display='none';
    }
  }
  // Recente afgeronde spellen
  const el=document.getElementById('recent-games-list');
  const recent=[...games].filter(g=>!g.active).reverse().slice(0,5);
  if(!recent.length){el.innerHTML=`<div class="empty"><div class="empty-icon">🃏</div><div class="empty-text">Nog geen spellen gespeeld</div><div class="empty-sub">Druk op "Nieuw spel starten" om te beginnen</div></div>`;return}
  el.innerHTML=recent.map(g=>{
    const wn=g.wij.map(id=>getPlayer(id)?.name||'?').join(' & ');
    const zn=g.zij.map(id=>getPlayer(id)?.name||'?').join(' & ');
    const d=new Date(g.date).toLocaleDateString('nl-NL',{day:'numeric',month:'short'});
    const won=g.finalWij>g.finalZij,draw=g.finalWij===g.finalZij;
    return `<div class="game-tile" onclick="openGameDetail('${g.id}')">
      <div class="game-tile-header">
        <span class="game-date">${d} · ${g.rounds.length} blaadjes ${g.completed?'🌳':'🌿'}</span>
        ${draw?`<span class="tag tag-draw">Gelijk</span>`:won?`<span class="tag tag-win">Wij won</span>`:`<span class="tag tag-loss">Zij won</span>`}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-size:11px;color:rgba(245,240,232,.5)">${wn} vs ${zn}</div><div class="game-score-big">${g.finalWij} – ${g.finalZij}</div></div>
        <div style="color:rgba(245,240,232,.2);font-size:22px">›</div>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
//  CONVEX INIT & REALTIME
// ══════════════════════════════════════════
function _refreshActiveView(){
  const active=document.querySelector('.view.active');
  const name=active?active.id.replace('view-',''):'home';
  if(name==='home') renderHome();
  else if(name==='players') renderPlayers();
  else if(name==='history') renderHistory();
  else if(name==='game') renderGame();
  else if(name==='stats') renderStats();
  else if(name==='toernooi') renderToernooi();
}

_client.onUpdate(_api.data.getData,{},(data)=>{
  if(!data) return;
  players = data.kj_players ?? [];
  games   = data.kj_games   ?? [];
  tournaments = data.kj_tournaments ?? [];
  // Migratie: als er nog een kj_current bestaat (oud formaat), neem die op in games
  const legacy = data.kj_current;
  if(legacy && legacy.active && !games.find(g=>String(g.id)===String(legacy.id))){
    games.push(legacy);
  }
  // current is device-lokaal: welke tafel bekijkt dit apparaat?
  const viewId = localStorage.getItem('kj_viewing_id');
  current = viewId ? (games.find(g=>String(g.id)===viewId&&g.active)||null) : null;
  _convexReady = true;
  _refreshActiveView();
});

// Fallback: toon laadscherm tot data binnenkomt
document.getElementById('app-loading')?.remove();


// ══════════════════════════════════════════
//  YOUTUBE IFRAME API (pit geluid)
// ══════════════════════════════════════════
let _ytPlayer=null,_ytReady=false;
window.onYouTubeIframeAPIReady=function(){
  _ytPlayer=new YT.Player('yt-player',{
    height:'1',width:'1',
    videoId:'WEEM2Qc9sUg',
    playerVars:{autoplay:0,controls:0,playsinline:1},
    events:{onReady:function(){_ytReady=true;}}
  });
};
function playPitYouTubeSound(){
  if(!_ytReady||!_ytPlayer) return;
  try{
    _ytPlayer.seekTo(0);
    _ytPlayer.unMute();
    _ytPlayer.setVolume(70);
    _ytPlayer.playVideo();
    setTimeout(()=>{ try{_ytPlayer.stopVideo();}catch(e){} },6000);
  }catch(e){}
}

// ══════════════════════════════════════════
//  TOERNOOI
// ══════════════════════════════════════════
function openNewTournamentModal(){
  const el=document.getElementById('inp-toernooi-naam');
  if(el) el.value='';
  const dt=document.getElementById('inp-toernooi-datum');
  if(dt) dt.value=new Date().toISOString().split('T')[0];
  openModal('modal-new-toernooi');
}

function startTournament(){
  const naam=(document.getElementById('inp-toernooi-naam')?.value||'').trim();
  if(!naam) return showToast('Voer een naam in',true);
  if(tournaments.some(t=>t.active)) return showToast('Er is al een actief toernooi. Sluit dat eerst af.',true);
  const datum=document.getElementById('inp-toernooi-datum')?.value||new Date().toISOString().split('T')[0];
  tournaments.push({id:Date.now(),name:naam,date:datum,active:true,gameIds:[]});
  saveAll();closeModal('modal-new-toernooi');renderToernooi();showToast('🏆 Toernooi gestart!');
}

function endTournament(){
  const t=tournaments.find(x=>x.active);if(!t) return;
  doConfirm('Toernooi afsluiten','Weet je zeker dat je het toernooi wilt afsluiten?',()=>{
    t.active=false;t.endDate=new Date().toISOString();
    saveAll();renderToernooi();showToast('Toernooi afgesloten');
  });
}

function getTournamentStandings(t){
  const tourGames=games.filter(g=>t.gameIds.includes(String(g.id)));
  const stats={};
  tourGames.forEach(g=>{
    [[...g.wij],[...g.zij]].forEach((team,ti)=>{
      const isWij=ti===0;
      const myScore=isWij?g.finalWij:g.finalZij;
      const won=isWij?(g.finalWij>g.finalZij):(g.finalZij>g.finalWij);
      const draw=g.finalWij===g.finalZij;
      team.forEach(pid=>{
        if(!stats[pid]) stats[pid]={games:0,wins:0,losses:0,draws:0,points:0};
        stats[pid].games++;stats[pid].points+=myScore;
        if(draw) stats[pid].draws++;else if(won) stats[pid].wins++;else stats[pid].losses++;
      });
    });
  });
  return Object.entries(stats)
    .map(([id,s])=>({player:getPlayer(+id),...s}))
    .filter(x=>x.player)
    .sort((a,b)=>b.wins-a.wins||b.points-a.points);
}

function renderToernooi(){
  const activeTournament=tournaments.find(t=>t.active);
  const activeSection=document.getElementById('toernooi-active-section');
  if(activeSection) activeSection.style.display=activeTournament?'block':'none';
  if(activeTournament){
    document.getElementById('toernooi-active-name').textContent=activeTournament.name;
    const d=new Date(activeTournament.date).toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    document.getElementById('toernooi-active-date').textContent=d;
    const standings=getTournamentStandings(activeTournament);
    const bomen=games.filter(g=>activeTournament.gameIds.includes(String(g.id))).length;
    document.getElementById('toernooi-standings').innerHTML=`
      <div style="font-size:12px;color:rgba(245,240,232,.4);margin-bottom:10px">${bomen} boom${bomen!==1?'en':''} gespeeld</div>
      ${standings.length?standings.map((s,i)=>`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(201,168,76,.1)">
          <div style="font-size:18px;font-weight:700;color:var(--gold);width:24px">${i+1}</div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:600">${s.player.name}</div>
            <div style="font-size:11px;color:rgba(245,240,232,.4)">${s.games} bomen · ${s.wins}× gewonnen · ${s.points} punten</div>
          </div>
          <div style="font-size:20px">${i===0?'🥇':i===1?'🥈':i===2?'🥉':''}</div>
        </div>
      `).join(''):`<div style="color:rgba(245,240,232,.4);font-size:13px;padding:10px 0">Nog geen bomen gespeeld in dit toernooi</div>`}
    `;
  }
  const pastTournaments=[...tournaments].filter(t=>!t.active).reverse();
  const histList=document.getElementById('toernooi-history-list');
  if(histList) histList.innerHTML=pastTournaments.length?pastTournaments.map(t=>{
    const bomen=games.filter(g=>t.gameIds.includes(String(g.id))).length;
    const d=new Date(t.date).toLocaleDateString('nl-NL',{day:'numeric',month:'long',year:'numeric'});
    return `<div class="game-tile" onclick="openTournamentDetail('${t.id}')">
      <div class="game-tile-header"><span class="game-date">${d}</span><span style="font-size:11px;color:rgba(245,240,232,.4)">${bomen} bomen</span></div>
      <div style="font-size:14px;font-weight:600;margin-top:4px">${t.name}</div>
    </div>`;
  }).join(''):`<div class="empty"><div class="empty-icon">🏆</div><div class="empty-text">Nog geen eerdere toernooien</div></div>`;
}

function openTournamentDetail(id){
  const t=tournaments.find(x=>String(x.id)===String(id));if(!t) return;
  const standings=getTournamentStandings(t);
  const bomen=games.filter(g=>t.gameIds.includes(String(g.id))).length;
  const d=new Date(t.date).toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('modal-toernooi-detail-content').innerHTML=`
    <div class="modal-title">${t.name} <span class="modal-close" onclick="closeModal('modal-toernooi-detail')">✕</span></div>
    <div style="font-size:12px;color:rgba(245,240,232,.4);margin-bottom:16px">${d} · ${bomen} bomen gespeeld</div>
    ${standings.length?standings.map((s,i)=>`
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(201,168,76,.1)">
        <div style="font-size:20px;font-weight:700;color:var(--gold);width:28px">${i+1}</div>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:600">${s.player.name}</div>
          <div style="font-size:12px;color:rgba(245,240,232,.4)">${s.games} bomen · ${s.wins}× gewonnen · ${s.losses}× verloren · ${s.points} punten</div>
        </div>
        <div style="font-size:22px">${i===0?'🥇':i===1?'🥈':i===2?'🥉':''}</div>
      </div>
    `).join(''):`<div style="color:rgba(245,240,232,.4);padding:12px 0">Geen data beschikbaar</div>`}
    <div style="height:14px"></div>
    <button class="btn btn-red" onclick="deleteTournament('${t.id}')">Toernooi verwijderen</button>
  `;
  openModal('modal-toernooi-detail');
}

function deleteTournament(id){
  doConfirm('Toernooi verwijderen','Dit verwijdert het toernooi maar niet de afzonderlijke bomen.',()=>{
    tournaments=tournaments.filter(t=>String(t.id)!==String(id));
    saveAll();closeModal('modal-toernooi-detail');renderToernooi();showToast('Toernooi verwijderd');
  });
}

// Expose functions voor HTML onclick handlers
Object.assign(window,{
  _dbg:()=>games,
  switchView,
  showToast,
  openModal,
  closeModal,
  doConfirm,
  playWaterSound,
  playVerzSound,
  playDestructionSound,
  showVerzFX,
  checkAccessCode,
  showNatFX,
  showPitFX,
  showRookPauze,
  getPlayer,
  addPlayer,
  openAddPlayerModal,
  renderPlayers,
  openProfile,
  uploadPhoto,
  renamePlayer,
  deletePlayerConfirm,
  updateStarterOptions,
  populateSelects,
  openNewGameModal,
  startNewGame,
  openTable,
  resumeLastGame,
  getSeatOrder,
  getUitbeurt,
  renderGame,
  clampAndCalc,
  addRoem,
  getTeamForPlayer,
  getAutoNatSpecial,
  refreshRoundAutoSpecial,
  refreshGameAutoSpecials,
  getRoundAward,
  recalcGameTotals,
  openLatestFinishedGameForEdit,
  applySpecial,
  applySpecialAuto,
  openVerzPicker,
  selectVerzPlayer,
  submitRound,
  undoLastRound,
  renderRoundTable,
  dragStart,
  dragOver,
  dragEnd,
  dropRound,
  clampEditRound,
  editRound,
  clearEditSpecial,
  saveEditedRound,
  handleEndGameButton,
  confirmEndGame,
  endGame,
  renderHistory,
  deleteGame,
  editGameFromHistory,
  openGameDetail,
  renderStats,
  setStatsFilter,
  renderStatsContent,
  renderAlgemeenStats,
  getDuoKey,
  renderDuoStats,
  renderTegStats,
  renderRecordsStats,
  renderHome,
  recalcPlayerStats,
  toggleBenchSection,
  openWisselModal,
  confirmWissel,
  openAddPlayerToGameModal,
  onAddGamePlayerSelect,
  confirmAddPlayerToGame,
  showWisselReminder,
  showVerliesVideo,
  playPitYouTubeSound,
  openNewTournamentModal,
  startTournament,
  endTournament,
  renderToernooi,
  openTournamentDetail,
  deleteTournament,
  toggleSound,
});
