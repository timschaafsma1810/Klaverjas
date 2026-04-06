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
let _localGamePending = null; // ID van lokaal aangemaakt spel nog niet bevestigd door Convex
let _savePending = 0;         // Aantal saves in-flight — blokkeer onUpdate overschrijven
let _pendingConvexData = null;// Gebufferde Convex update die wacht tot save klaar is

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
  _savePending++;
  let saveOk=false;
  try {
    await Promise.all([
      _client.mutation(_api.data.saveData,{key:'kj_players',value:JSON.stringify(players)}),
      _client.mutation(_api.data.saveData,{key:'kj_games',value:JSON.stringify(games)}),
      _client.mutation(_api.data.saveData,{key:'kj_tournaments',value:JSON.stringify(tournaments)}),
    ]);
    saveOk=true;
  } catch(e){ console.error('Opslaan mislukt:',e); showToast('⚠️ Opslaan mislukt, probeer opnieuw',true); }
  finally{
    _savePending--;
    if(_savePending===0 && _pendingConvexData){
      if(saveOk){
        // Save geslaagd: pas gebufferde Convex update toe
        const d=_pendingConvexData;
        _pendingConvexData=null;
        _applyConvexData(d);
      } else {
        // Save mislukt: gooi stale Convex data weg, behoud lokale state
        _pendingConvexData=null;
      }
    }
  }
}

// Recalculate per-player aggregated stats from all stored games.
function recalcPlayerStats(){
  // Reset all aggregated fields
  players.forEach(p=>{
    p.games=0; p.wins=0; p.losses=0; p.draws=0;
    p.rounds=0; p.totalScore=0; p.highScore=0;
    p.totalCardScore=0; p.totalRoemScore=0;
    p.totalPointDiff=0;
    p.nat=0; p.verz=0; p.pit=0;
    p.natAsMaker=0; p.pitAsMaker=0; p.verzAsMaker=0;
    p.roundsPlayed=0; p.roundsKaap=0;
  });
  games.forEach(g=>{
    if(g.active) return;
    if(g.deletedAt) return;
    const finalWij=(typeof g.finalWij==='number')?g.finalWij:g.scoreWij;
    const finalZij=(typeof g.finalZij==='number')?g.finalZij:g.scoreZij;
    const wijWon=finalWij>finalZij;
    const draw=finalWij===finalZij;
    function countSp(tag){return g.rounds.filter(r=>r.special&&r.special.includes(tag)).length;}
    // Alleen bankspelers die daadwerkelijk zijn gewisseld tellen mee
    const wijEverIn=new Set((g.wisselingen||[]).map(w=>w.wijIn).filter(Boolean));
    const zijEverIn=new Set((g.wisselingen||[]).map(w=>w.zijIn).filter(Boolean));
    const allWijIds=[...g.wij,...(g.wijBench||[]).filter(id=>wijEverIn.has(id))];
    const allZijIds=[...g.zij,...(g.zijBench||[]).filter(id=>zijEverIn.has(id))];
    [...allWijIds,...allZijIds].forEach(pid=>{
      const p=getPlayer(pid);if(!p) return;
      const isWij=allWijIds.includes(pid);
      p.games++;
      p.totalPointDiff+=(isWij?finalWij:finalZij)-(isWij?finalZij:finalWij);
      if(draw) p.draws++;
      else if((isWij&&wijWon)||(!isWij&&!wijWon)) p.wins++;
      else p.losses++;
      // Punten alleen van voltooide bomen
      if(g.completed){
        p.rounds+=g.rounds.length;
        const myScore=isWij?finalWij:finalZij;
        p.totalScore+=myScore;
        if(myScore>p.highScore) p.highScore=myScore;
        g.rounds.forEach(r=>{
          const award=getRoundAward(g,r);
          const card=isWij?(award.w-award.roemWij):(award.z-award.roemZij);
          const roem=isWij?award.roemWij:award.roemZij;
          p.totalCardScore+=Math.max(0,card);
          p.totalRoemScore+=Math.max(0,roem);
        });
      }
      if(isWij){p.nat+=countSp('NAT WIJ');p.verz+=countSp('VERZ WIJ');p.pit+=countSp('PIT WIJ');}
      else{p.nat+=countSp('NAT ZIJ');p.verz+=countSp('VERZ ZIJ');p.pit+=countSp('PIT ZIJ');}
    });
    g.rounds.forEach(r=>{
      // Gebruik spelId als primaire identifier (spelWij/spelZij als fallback voor legacy data)
      const makerId=r.spelId||r.spelWij||r.spelZij;
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
        const vId=r.verzPlayerId||r.spelWij||r.spelZij||r.spelId;
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
  const origName=name;
  // Spelers-tab is samengevoegd in de Stats-view
  if(name==='players'){statsFilter='spelers';name='stats';}
  const already=document.getElementById('view-'+name)?.classList.contains('active');
  if(!already){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    const viewEl=document.getElementById('view-'+name);
    if(viewEl) viewEl.classList.add('active');
    if(pushHistory) history.pushState({view:origName},'','/'+origName);
  }
  // Altijd nav-highlight bijwerken (ook bij al-actieve view, bv. wisselen tussen tabs)
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  // players is samengevoegd in stats — highlight nav-stats
  const navId=origName==='players'?'stats':origName;
  const navEl=document.getElementById('nav-'+navId);
  if(navEl) navEl.classList.add('active');
  if(origName==='home') renderHome();
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

function formatDuration(ms){
  if(!ms||ms<0) return null;
  const mins=Math.floor(ms/60000);
  if(mins<1) return '<1m';
  if(mins<60) return mins+'m';
  return Math.floor(mins/60)+'u '+(mins%60?mins%60+'m':'');
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
    totalScore:0,totalCardScore:0,totalRoemScore:0,highScore:0,rounds:0,roundsPlayed:0,roundsKaap:0});
  saveAll();
  document.getElementById('inp-player-name').value='';
  closeModal('modal-add-player');
  renderPlayers();showToast('✓ '+name+' toegevoegd!');
}

function openAddPlayerModal(){openModal('modal-add-player')}

function renderPlayers(){
  recalcPlayerStats();
  const el=document.getElementById('players-list');
  if(!players.length){
    el.innerHTML=`<div class="empty"><div class="empty-icon">👥</div><div class="empty-text">Nog geen spelers</div><div class="empty-sub">Voeg spelers toe om te beginnen</div></div>`;
    return;
  }
  const sorted=[...players].sort((a,b)=>((b.wins||0)/(b.games||1))-((a.wins||0)/(a.games||1)));
  el.innerHTML=sorted.map(p=>{
    const wr=p.games?Math.round(p.wins/p.games*100):0;
    const badge=p.games===0?`<span class="neutral-badge">Nieuw</span>`:
      wr>=50?`<span class="win-badge">${wr}% gewonnen</span>`:`<span class="loss-badge">${wr}% gewonnen</span>`;
    const avImg=p.photo?`<img src="${p.photo}" alt="">`:`${p.name[0].toUpperCase()}`;
    const form=getPlayerForm(p.id);
    const trend=trendBadge(form.streak,form.streakType);
    const formRow=form.last5.length?`<div style="display:flex;gap:3px;margin-top:5px">${formBadges(form.last5)}${trend?`<span style="margin-left:4px;font-size:11px;align-self:center">${trend}</span>`:''}</div>`:'';
    const flame=form.streak>=3&&form.streakType==='W'?' 🔥':'';
    const ice=form.streak>=3&&form.streakType==='V'?' 🥶':'';
    return `<div class="player-tile" onclick="openProfile(${p.id})" style="padding:14px 16px">
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div class="avatar" style="width:56px;height:56px;font-size:20px;flex-shrink:0">${avImg}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span class="player-name" style="font-size:16px">${p.name}${flame}${ice}</span>
            ${badge}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:12px;color:rgba(245,240,232,.75);margin-bottom:8px">
            <span>🏆 ${p.wins}× gewonnen</span>
            <span>💀 ${p.losses}× verloren</span>
            <span>💧 ${p.natAsMaker||0}× nat</span>
            <span>🔵 ${p.verzAsMaker||0}× verzaakt</span>
            <span>💥 ${p.pitAsMaker||0}× pit</span>
          </div>
          ${form.last5.length?`<div style="display:flex;gap:3px">${formBadges(form.last5)}</div>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// Geeft alle spelers die daadwerkelijk hebben meegespeeld voor een team,
// inclusief wisselspelers die erin zijn gekomen.
function getGameTeamIds(g, team){
  const isWij=team==='wij';
  const starters=isWij?g.wij:g.zij;
  const bench=isWij?(g.wijBench||[]):(g.zijBench||[]);
  const everIn=new Set((g.wisselingen||[]).map(w=>isWij?w.wijIn:w.zijIn).filter(Boolean));
  return [...new Set([...starters,...bench.filter(id=>everIn.has(id))])];
}
function getGameTeamNames(g, team){
  return getGameTeamIds(g,team).map(id=>getPlayer(id)?.name||'?').join(' & ');
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
  const avgCard=p.rounds?Math.round((p.totalCardScore||0)/p.rounds):0;
  const avgRoem=p.rounds?Math.round((p.totalRoemScore||0)/p.rounds):0;
  const since=new Date(p.created).toLocaleDateString('nl-NL',{day:'numeric',month:'long',year:'numeric'});
  const kaapCount=p.roundsKaap||0;
  const spelPct=p.rounds>0?Math.round(p.roundsPlayed/p.rounds*100):0;
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
      <div class="stat-box"><div class="stat-value">${p.games}</div><div class="stat-label">🌳 Bomen</div></div>
      <div class="stat-box"><div class="stat-value" style="color:var(--win)">${p.wins}</div><div class="stat-label">🏆 Gewonnen</div></div>
      <div class="stat-box"><div class="stat-value" style="color:var(--loss)">${p.losses}</div><div class="stat-label">💀 Verloren</div></div>
      <div class="stat-box"><div class="stat-value">${wr}%</div><div class="stat-label">📈 Winrate</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#e74c3c">${p.natAsMaker||0}</div><div class="stat-label">💧 Keer nat</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#3498db">${p.verzAsMaker||0}</div><div class="stat-label">🔵 Keer verzaakt</div></div>
      <div class="stat-box"><div class="stat-value">${p.highScore}</div><div class="stat-label">⭐ Hoogste score</div></div>
      <div class="stat-box"><div class="stat-value">${avg}</div><div class="stat-label">📊 Gem. per ronde</div></div>
      <div class="stat-box"><div class="stat-value">${avgCard}</div><div class="stat-label">🃏 Gem. kaart</div></div>
      <div class="stat-box"><div class="stat-value">${avgRoem}</div><div class="stat-label">🌟 Gem. roem</div></div>
      <div class="stat-box" title="Aantal keer dat jij maakte terwijl het niet jouw uitbeurt was"><div class="stat-value">${kaapCount}</div><div class="stat-label">🦅 Keer gekaapd</div></div>
      <div class="stat-box"><div class="stat-value">${p.rounds}</div><div class="stat-label">📄 Blaadjes</div></div>
      <div class="stat-box"><div class="stat-value">${p.roundsPlayed||0}</div><div class="stat-label">🎯 Keer maker</div></div>
      <div class="stat-box" title="% van blaadjes waarbij deze speler de maker was"><div class="stat-value">${spelPct}%</div><div class="stat-label">📊 % Maker</div></div>
    </div>

    <div class="card-label" style="margin-bottom:8px">Recente spellen</div>
    ${recentHTML}
    <div style="height:14px"></div>
    <button class="btn btn-red" onclick="deletePlayerConfirm(${p.id})">Speler uit de app verwijderen</button>`;
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
  const benchSection=document.getElementById('bench-section');
  const benchSelects=benchSection?[...benchSection.querySelectorAll('select')]:[];
  benchSelects.forEach(el=>{
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
  // Reset bench-sectie bij heropenen modal
  const benchSection=document.getElementById('bench-section');
  if(benchSection) benchSection.innerHTML='';
  document.getElementById('btn-add-bench-wij')?.style.removeProperty('display');
  document.getElementById('btn-add-bench-zij')?.style.removeProperty('display');
  const opts=players.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const seatDefaults={
    'sel-wij1':players[0]?.id,
    'sel-zij1':players[1]?.id,
    'sel-wij2':players[2]?.id,
    'sel-zij2':players[3]?.id
  };
  let starterManuallySet=false;
  const starterSel=document.getElementById('sel-starter');

  ['sel-wij1','sel-zij1','sel-wij2','sel-zij2'].forEach(sid=>{
    const el=document.getElementById(sid);
    el.innerHTML=opts;
    if(seatDefaults[sid]!==undefined) el.value=seatDefaults[sid];
    el.onchange=()=>{
      updateStarterOptions();
      // Speler 2 (sel-zij1) stuurt starter aan, tenzij gebruiker die al handmatig heeft gekozen
      if(sid==='sel-zij1'&&!starterManuallySet){
        if(starterSel) starterSel.value=el.value;
      }
    };
  });

  // Zodra gebruiker starter handmatig aanpast: niet meer auto-volgen
  if(starterSel) starterSel.onchange=()=>{ starterManuallySet=true; };

  updateStarterOptions();
  // Default starter = Speler 2 (sel-zij1)
  const zij1Val=document.getElementById('sel-zij1')?.value;
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
  if(!activeIds.map(String).includes(String(starter))) return showToast('Kies een starter die in deze boom zit',true);
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
  _localGamePending=String(newGame.id);
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

function addBenchSlot(team='wij'){
  const section=document.getElementById('bench-section');
  if(!section) return;
  const teamLabel=team==='wij'?'Wij':'Zij';
  // Hoeveel slots zijn er al voor dit team?
  const existing=section.querySelectorAll(`select[data-bench-team="${team}"]`).length;
  if(existing>=2){showToast(`Maximaal 2 bankspelers per team`,true);return;}
  const slotNum=existing+1;
  const slotId=`sel-${team}${2+slotNum}`; // sel-wij3/sel-wij4 of sel-zij3/sel-zij4
  const noneOpt=`<option value="">— Geen wisselspeler —</option>`;
  const activeIds=['sel-wij1','sel-zij1','sel-wij2','sel-zij2']
    .map(id=>document.getElementById(id)?.value).filter(Boolean);
  const opts=noneOpt+players.filter(p=>!activeIds.includes(String(p.id)))
    .map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const lbl=document.createElement('label');
  lbl.textContent=`Team "${teamLabel}" — Bankspeler ${slotNum}`;
  const sel=document.createElement('select');
  sel.id=slotId;
  sel.dataset.benchTeam=team;
  sel.innerHTML=opts;
  section.appendChild(lbl);
  section.appendChild(sel);
  if(existing+1>=2) document.getElementById(`btn-add-bench-${team}`)?.style.setProperty('display','none');
  updateBenchOptions();
}

function toggleWisselCard(team){
  const cb=document.getElementById('cb-'+team+'-wisselt');
  if(!cb) return;
  cb.checked=!cb.checked;
  const on=cb.checked;
  const fields=document.getElementById('fields-'+team+'-wissel');
  const card=document.getElementById('card-'+team+'-wissel');
  const indicator=document.getElementById('toggle-'+team+'-wissel');
  if(fields) fields.style.display=on?'block':'none';
  if(indicator){
    indicator.textContent=on?'✓':'—';
    indicator.style.background=on?'var(--gold)':'rgba(245,240,232,.15)';
    indicator.style.color=on?'var(--green)':'rgba(245,240,232,.5)';
    indicator.style.borderColor=on?'var(--gold)':'rgba(245,240,232,.2)';
    indicator.style.fontWeight=on?'700':'400';
  }
  if(card){
    card.style.borderColor=on?'rgba(201,168,76,.5)':'rgba(245,240,232,.1)';
    card.style.background=on?'rgba(201,168,76,.07)':'rgba(0,0,0,.15)';
    const lbl=card.querySelector('.wissel-team-label');
    if(lbl) lbl.style.color=on?'var(--gold)':'rgba(245,240,232,.4)';
  }
}

function openWisselModal(){
  const g=current;if(!g) return;
  const hasWijBench=(g.wijBench||[]).length>0;
  const hasZijBench=(g.zijBench||[]).length>0;
  if(!hasWijBench&&!hasZijBench) return showToast('Geen wisselspelers beschikbaar',true);

  const wijInHistory=(g.wisselingen||[]).map(w=>w.wijIn).filter(Boolean);
  const zijInHistory=(g.wisselingen||[]).map(w=>w.zijIn).filter(Boolean);
  const defaultWijUit=g.wij.find(id=>!wijInHistory.includes(id))??g.wij[0];
  const defaultZijUit=g.zij.find(id=>!zijInHistory.includes(id))??g.zij[0];

  function opts(ids,defaultId){
    return ids.map(id=>`<option value="${id}"${id===defaultId?' selected':''}>${getPlayer(id)?.name||'?'}</option>`).join('');
  }

  // Als maar één team bench heeft: die direct open, geen toggle nodig
  const bothHaveBench=hasWijBench&&hasZijBench;

  function teamCard(team,label,hasBench,startIds,benchIds,defaultUit){
    if(!hasBench) return '';
    const showToggle=bothHaveBench;
    const startsOn=true; // standaard altijd aan, afvinken om uit te zetten
    const toggleHTML=showToggle?`
      <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;margin-bottom:0;user-select:none" onclick="toggleWisselCard('${team}')">
        <span class="wissel-team-label" style="font-size:13px;font-weight:700;letter-spacing:.8px;color:var(--gold)">TEAM ${label.toUpperCase()} WISSELT</span>
        <span id="toggle-${team}-wissel" style="width:34px;height:20px;border-radius:10px;background:var(--gold);color:var(--green);display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;transition:all .2s;border:1px solid var(--gold)">✓</span>
        <input type="checkbox" id="cb-${team}-wisselt" checked style="display:none">
      </label>`:`
      <div class="wissel-team-label" style="font-size:12px;font-weight:700;letter-spacing:.8px;color:var(--gold);margin-bottom:8px">TEAM ${label.toUpperCase()} WISSELT</div>`;
    return `
    <div id="card-${team}-wissel" style="border:1px solid rgba(201,168,76,.5);border-radius:12px;padding:12px 14px;margin-bottom:10px;background:rgba(201,168,76,.07);transition:all .2s">
      ${toggleHTML}
      <div id="fields-${team}-wissel" style="display:block;margin-top:${showToggle?'10px':'0'}">
        <label style="font-size:12px;color:rgba(245,240,232,.6);margin-top:4px">Wie gaat eruit?</label>
        <select id="wissel-${team}-uit">${opts(startIds,defaultUit)}</select>
        <label style="font-size:12px;color:rgba(245,240,232,.6);margin-top:8px">Wie komt erin?</label>
        <select id="wissel-${team}-in">${benchIds.map(id=>`<option value="${id}">${getPlayer(id)?.name||'?'}</option>`).join('')}</select>
      </div>
    </div>`;
  }

  const html=
    teamCard('wij','Wij',hasWijBench,g.wij,g.wijBench||[],defaultWijUit)+
    teamCard('zij','Zij',hasZijBench,g.zij,g.zijBench||[],defaultZijUit);

  document.getElementById('wissel-content').innerHTML=html;
  openModal('modal-wissel');
}

function confirmWissel(){
  const g=current;if(!g) return;
  if(!g.wisselingen) g.wisselingen=[];
  const wisseling={blaadje:g.rounds.length};
  const cbWij=document.getElementById('cb-wij-wisselt');
  const cbZijCheck=document.getElementById('cb-zij-wisselt');
  // Beide teams hebben toggle maar geen is aan → waarschuw
  if(cbWij&&cbZijCheck&&!cbWij.checked&&!cbZijCheck.checked){
    return showToast('Zet minstens één team aan om te wisselen',true);
  }
  const wijWisselt=!cbWij||cbWij.checked;
  const wijUitEl=document.getElementById('wissel-wij-uit');
  const wijInEl=document.getElementById('wissel-wij-in');
  if(wijWisselt&&wijUitEl&&wijInEl){
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
  const cbZij=document.getElementById('cb-zij-wisselt');
  const zijWisselt=!cbZij||cbZij.checked;
  const zijUitEl=document.getElementById('wissel-zij-uit');
  const zijInEl=document.getElementById('wissel-zij-in');
  if(zijWisselt&&zijUitEl&&zijInEl){
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

function openVolgordeModal(){
  const g=current;if(!g) return;
  const so=getSeatOrder(g);
  if(so.length<4) return showToast('Volgorde wisselen niet beschikbaar',true);
  // Bereken uitkomer en deler
  const roundIndex=g.rounds.length;
  const starterIdx=Math.max(0,so.indexOf(Number(g.starter)));
  const uitIdx=(starterIdx+roundIndex)%4;
  const dealerIdx=(starterIdx+roundIndex-1+4)%4;
  // Posities rondom tafel: bottom=0, right=1, top=2, left=3 (W-Z-W-Z)
  const positions=['bottom','right','top','left'];
  function seatHTML(seatPos,playerIdx){
    const pid=so[playerIdx];
    const p=getPlayer(pid);
    const name=p?.name||'?';
    const isWij=playerIdx%2===0;
    const teamColor=isWij?'#c9a84c':'rgba(245,240,232,.7)';
    const isUit=playerIdx===uitIdx;
    const isDealer=playerIdx===dealerIdx;
    const avatarInner=p?.photo
      ?`<img src="${p.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      :`<span style="font-size:18px;font-weight:700;color:var(--green)">${name[0].toUpperCase()}</span>`;
    const badge=isUit
      ?`<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);background:#c9a84c;color:#163d24;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;white-space:nowrap">UITBEURT</div>`
      :isDealer
      ?`<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);background:rgba(245,240,232,.15);color:rgba(245,240,232,.7);font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;white-space:nowrap">DELER</div>`
      :'';
    // Positie op de tafel
    const posStyle={
      bottom:'bottom:0;left:50%;transform:translateX(-50%)',
      top:'top:0;left:50%;transform:translateX(-50%)',
      left:'left:0;top:50%;transform:translateY(-50%)',
      right:'right:0;top:50%;transform:translateY(-50%)',
    }[seatPos];
    return `<div style="position:absolute;${posStyle};display:flex;flex-direction:column;align-items:center;gap:4px">
      <div style="position:relative">
        ${badge}
        <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,${teamColor},${isWij?'#8b6914':'rgba(180,160,120,.5)'}
);display:flex;align-items:center;justify-content:center;border:2px solid ${isUit?'#c9a84c':isDealer?'rgba(245,240,232,.3)':'rgba(201,168,76,.2)'};overflow:hidden">${avatarInner}</div>
      </div>
      <div style="font-size:11px;font-weight:600;color:${teamColor};max-width:64px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
    </div>`;
  }
  document.getElementById('volgorde-content').innerHTML=`
    <div style="position:relative;width:240px;height:240px;margin:0 auto 20px">
      <!-- Ronde tafel -->
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:110px;height:110px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#1e5c34,#0f2d18);border:2px solid rgba(201,168,76,.35);box-shadow:0 0 20px rgba(0,0,0,.4)">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;opacity:.35">♣</div>
      </div>
      ${seatHTML('bottom',0)}
      ${seatHTML('left',1)}
      ${seatHTML('top',2)}
      ${seatHTML('right',3)}
    </div>
    <button class="btn btn-ghost" style="margin-bottom:10px" onclick="swapVolgorde('wij')">
      🔀 WIJ: ${getPlayer(so[0])?.name||'?'} ↔ ${getPlayer(so[2])?.name||'?'}
    </button>
    <button class="btn btn-ghost" onclick="swapVolgorde('zij')">
      🔀 ZIJ: ${getPlayer(so[1])?.name||'?'} ↔ ${getPlayer(so[3])?.name||'?'}
    </button>`;
  openModal('modal-volgorde');
}

function swapVolgorde(team){
  const g=current;if(!g) return;
  const so=getSeatOrder(g);
  // Onthoud de starter-positie (index) vóór de wissel, niet de speler-ID
  const starterPos=Math.max(0,so.indexOf(Number(g.starter)));
  if(team==='wij'){
    [so[0],so[2]]=[so[2],so[0]];
  } else {
    [so[1],so[3]]=[so[3],so[1]];
  }
  // Herveranker de starter aan dezelfde positie-index zodat de rotatie intact blijft
  g.starter=so[starterPos];
  g.seatOrder=so;
  saveAll();closeModal('modal-volgorde');renderGame();
  showToast('✓ Volgorde gewisseld');
}

function openRemovePlayerModal(){
  const g=current;if(!g) return;
  const allIds=[...g.wij,...g.zij,...(g.wijBench||[]),...(g.zijBench||[])];
  // Wie heeft ooit aan tafel gezeten?
  const playedIds=new Set(g.rounds.map(r=>String(r.spelId||r.spelWij||r.spelZij)).filter(Boolean));
  const everIn=new Set([...(g.wisselingen||[]).map(w=>w.wijIn),...(g.wisselingen||[]).map(w=>w.zijIn)].filter(Boolean).map(String));
  const everOut=new Set([...(g.wisselingen||[]).map(w=>w.wijUit),...(g.wisselingen||[]).map(w=>w.zijUit)].filter(Boolean).map(String));
  const activeCount=g.wij.length+g.zij.length;
  const removable=allIds.filter(pid=>{
    const s=String(pid);
    // Ooit maker geweest
    if(playedIds.has(s)) return false;
    // Ooit ingewisseld (was aan tafel)
    if(everIn.has(s)) return false;
    // Ooit uitgewisseld (was originele starter die aan tafel zat)
    if(everOut.has(s)) return false;
    // Huidige starter en er zijn al ronden gespeeld (zat aan tafel)
    const isActive=g.wij.includes(pid)||g.zij.includes(pid);
    if(isActive&&g.rounds.length>0) return false;
    // Minimaal 4 actieve spelers houden na verwijdering
    if(isActive&&activeCount<=4) return false;
    return true;
  });
  if(!removable.length){
    showToast('Geen spelers die verwijderd kunnen worden (iedereen heeft al gespeeld of minimaal 4 spelers vereist)',true);
    return;
  }
  document.getElementById('remove-player-content').innerHTML=`
    <p style="font-size:13px;color:rgba(245,240,232,.6);margin-bottom:14px">Alleen spelers die nog niet gespeeld hebben kunnen verwijderd worden.</p>
    ${removable.map(pid=>{
      const p=getPlayer(pid);if(!p) return '';
      const team=getTeamForPlayer(g,pid);
      const teamLabel=team==='wij'?'Wij':'Zij';
      const isBench=!g.wij.includes(pid)&&!g.zij.includes(pid);
      return `<button class="btn btn-ghost" style="margin-bottom:8px;display:flex;justify-content:space-between" onclick="confirmRemovePlayer(${pid})">
        <span>${p.name}</span>
        <span style="font-size:11px;color:rgba(245,240,232,.4)">${teamLabel}${isBench?' (bank)':''}</span>
      </button>`;
    }).join('')}`;
  openModal('modal-remove-player');
}

function confirmRemovePlayer(pid){
  const g=current;if(!g) return;
  // Verwijder uit actief team
  let removed=false;
  ['wij','zij'].forEach(team=>{
    const arr=g[team];
    const idx=arr.indexOf(pid);
    if(idx>=0){arr.splice(idx,1);removed=true;}
  });
  // Verwijder uit bench
  ['wijBench','zijBench'].forEach(key=>{
    if(!g[key]) return;
    const idx=g[key].indexOf(pid);
    if(idx>=0){g[key].splice(idx,1);removed=true;}
  });
  // Verwijder uit seatOrder
  if(g.seatOrder){
    const si=g.seatOrder.indexOf(pid);
    if(si>=0) g.seatOrder.splice(si,1);
  }
  if(removed){saveAll();closeModal('modal-remove-player');renderGame();showToast('✓ Speler verwijderd');}
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
    const np={id:Date.now(),name:naam,games:0,wins:0,losses:0,draws:0,rounds:0,totalScore:0,totalCardScore:0,totalRoemScore:0,highScore:0,nat:0,verz:0,pit:0,natAsMaker:0,pitAsMaker:0,verzAsMaker:0,roundsPlayed:0,roundsKaap:0};
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
  const wn=getGameTeamNames(g,'wij');
  const zn=getGameTeamNames(g,'zij');
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
  const diffEl=document.getElementById('score-diff');
  if(diffEl){
    const diff=g.scoreWij-g.scoreZij;
    if(diff===0){diffEl.textContent='';diffEl.style.color='';}
    else{
      const leader=diff>0?'WIJ':'ZIJ';
      diffEl.textContent=`+${Math.abs(diff)} ${leader}`;
      diffEl.style.color=diff>0?'rgba(201,168,76,.7)':'rgba(245,240,232,.5)';
    }
  }
  document.getElementById('round-num').textContent=rnd;
  document.getElementById('ronde-progress').textContent=`blaadje ${Math.min(g.rounds.length+1,16)}/16 · takkie ${Math.ceil((g.rounds.length+1)/4)}/4`;

  const seatPlayers=getSeatOrder(g);
  const starterIdx=Math.max(0,seatPlayers.indexOf(Number(g.starter)));
  const roundIndex=g.rounds.length;
  const uitId=getUitbeurt(roundIndex);
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
  // Deler = de speler vóór de uitkomer in de zetelorde
  const dealerBar=document.getElementById('dealer-bar');
  const dealerNameEl=document.getElementById('dealer-name');
  if(dealerBar&&dealerNameEl&&seatPlayers.length){
    const dealerIdx=(starterIdx+roundIndex-1+seatPlayers.length)%seatPlayers.length;
    const dealerPlayer=getPlayer(seatPlayers[dealerIdx]);
    if(dealerPlayer){
      dealerBar.style.display='block';
      dealerNameEl.textContent=dealerPlayer.name;
    }
  }

  const allOpts=getSeatOrder(g).map(id=>`<option value="${id}">${getPlayer(id)?.name||'?'}</option>`).join('');
  const spelSelect=document.getElementById('sel-speler');
  spelSelect.innerHTML=`<option value="">— Kies wie speelt —</option>`+allOpts;
  spelSelect.value=String(uitId||'');

  // Wissel bar altijd tonen
  const wisselBar=document.getElementById('wissel-bar');
  if(wisselBar){
    const hasBench=((g.wijBench||[]).length+(g.zijBench||[]).length)>0;
    wisselBar.style.display='block';
    const wisselBtn=document.getElementById('btn-wissel-speler');
    if(wisselBtn) wisselBtn.style.display=hasBench?'inline-flex':'none';
    const volgordeBtn=document.getElementById('btn-volgorde');
    if(volgordeBtn) volgordeBtn.style.display='inline-flex';
    const removeBtn=document.getElementById('btn-remove-player');
    if(removeBtn){
      const allIds=[...g.wij,...g.zij,...(g.wijBench||[]),...(g.zijBench||[])];
      const playedIds=new Set(g.rounds.map(r=>String(r.spelId||r.spelWij||r.spelZij)).filter(Boolean));
      const everIn=new Set([...(g.wisselingen||[]).map(w=>w.wijIn),...(g.wisselingen||[]).map(w=>w.zijIn)].filter(Boolean).map(String));
      const everOut=new Set([...(g.wisselingen||[]).map(w=>w.wijUit),...(g.wisselingen||[]).map(w=>w.zijUit)].filter(Boolean).map(String));
      const activeCount=g.wij.length+g.zij.length;
      const hasRemovable=allIds.some(pid=>{
        const s=String(pid);
        if(playedIds.has(s)||everIn.has(s)||everOut.has(s)) return false;
        const isActive=g.wij.includes(pid)||g.zij.includes(pid);
        if(isActive&&(g.rounds.length>0||activeCount<=4)) return false;
        return true;
      });
      removeBtn.style.display=hasRemovable?'inline-flex':'none';
    }
  }

  const q=[20,50,100];
  const wisBtn='<button class="quick-btn" onclick="clearRoem(\'wij\')" style="color:rgba(231,76,60,.8)">× wis</button>';
  const wisBtnZ='<button class="quick-btn" onclick="clearRoem(\'zij\')" style="color:rgba(231,76,60,.8)">× wis</button>';
  document.getElementById('quick-wij').innerHTML=q.map(v=>`<button class="quick-btn" onclick="addRoem('wij',${v})">+${v} roem</button>`).join('')+wisBtn;
  document.getElementById('quick-zij').innerHTML=q.map(v=>`<button class="quick-btn" onclick="addRoem('zij',${v})">+${v} roem</button>`).join('')+wisBtnZ;

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

function clearRoem(team){
  document.getElementById('input-roem-'+team).value='';
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
  if(special.includes('NAT WIJ')||special.includes('VERZ WIJ')){
    return {w:0,z:162+rw+rz,roemWij:0,roemZij:rw+rz};
  }
  if(special.includes('NAT ZIJ')||special.includes('VERZ ZIJ')){
    return {w:162+rw+rz,z:0,roemWij:rw+rz,roemZij:0};
  }
  if(special.includes('PIT WIJ')){
    return {w:w+rw+rz,z:0,roemWij:rw+rz,roemZij:0};
  }
  if(special.includes('PIT ZIJ')){
    return {w:0,z:z+rw+rz,roemWij:0,roemZij:rw+rz};
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
    // Som beide teams' roem + 100 basis, geef alles aan de winnaar
    const roemW=parseInt(document.getElementById('input-roem-wij').value)||0;
    const roemZ=parseInt(document.getElementById('input-roem-zij').value)||0;
    const totalRoem=roemW+roemZ+100;
    document.getElementById('input-wij').value='';
    document.getElementById('input-zij').value='';
    document.getElementById('input-'+team).value=0;
    document.getElementById('input-'+other).value=162;
    document.getElementById('input-roem-'+team).value=0;
    document.getElementById('input-roem-'+other).value=totalRoem;
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
    const roemW=parseInt(document.getElementById('input-roem-wij').value)||0;
    const roemZ=parseInt(document.getElementById('input-roem-zij').value)||0;
    const totalRoem=roemW+roemZ+100;
    document.getElementById('input-'+team).value=162;
    document.getElementById('input-'+other).value=0;
    document.getElementById('input-roem-'+team).value=totalRoem;
    document.getElementById('input-roem-'+other).value=0;
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
  const wijIds=[...g.wij];
  const zijIds=[...g.zij];
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
  // Som beide teams' roem + 100 basis, geef alles aan de winnaar
  const prevRoemW=parseInt(document.getElementById('input-roem-wij').value)||0;
  const prevRoemZ=parseInt(document.getElementById('input-roem-zij').value)||0;
  const totalRoem=prevRoemW+prevRoemZ+100;
  ['input-wij','input-zij','input-roem-wij','input-roem-zij'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('input-'+team).value=0;
  document.getElementById('input-'+other).value=162;
  document.getElementById('input-roem-'+other).value=totalRoem;
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
      const namenStr=namen.length<=1?namen[0]||'':namen.slice(0,-1).join(', ')+' & '+namen[namen.length-1];
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
  let wijLossStreak=0,zijLossStreak=0;

  g.rounds.forEach((r,i)=>{
    const rSp=r.special||'';
    const wijNat=rSp.includes('NAT WIJ')||rSp.includes('VERZ WIJ');
    const zijNat=rSp.includes('NAT ZIJ')||rSp.includes('VERZ ZIJ');
    // Effective punten (enforce 0/162 for NAT/VERZ)
    let pw=r.w,pz=r.z;
    if(wijNat){pw=0;pz=162;}
    else if(zijNat){pw=162;pz=0;}

    // Bij NAT: roem van verliezende kant gaat naar winnaar
    let dispRW=r.rw||0, dispRZ=r.rz||0;
    if(wijNat){dispRZ=(r.rw||0)+(r.rz||0);dispRW=0;}
    else if(zijNat){dispRW=(r.rw||0)+(r.rz||0);dispRZ=0;}
    cumW+=pw;cumZ+=pz;cumRW+=dispRW;cumRZ+=dispRZ;

    // Jagen: track wie er minder totaalpunten (kaart+roem) had deze ronde
    const totalW=pw+dispRW, totalZ=pz+dispRZ;
    if(totalW<totalZ){wijLossStreak++;zijLossStreak=0;}
    else if(totalZ<totalW){zijLossStreak++;wijLossStreak=0;}
    else{wijLossStreak=0;zijLossStreak=0;}
    const isJagen=wijLossStreak>=3||zijLossStreak>=3;

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
  // Speler-select vullen
  const spelSel=document.getElementById('edit-speler-select');
  if(spelSel){
    const allPlayers=getSeatOrder(g);
    const currentSpeler=r.spelId||r.spelWij||r.spelZij;
    spelSel.innerHTML=`<option value="">— Onbekend —</option>`+
      allPlayers.map(id=>`<option value="${id}"${String(id)===String(currentSpeler)?'selected':''}>${getPlayer(id)?.name||'?'}</option>`).join('');
  }
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
  // Speler updaten als gewijzigd
  const spelSel=document.getElementById('edit-speler-select');
  if(spelSel&&spelSel.value){
    const newSpelId=+spelSel.value;
    r.spelId=newSpelId;
    const spelTeam=getTeamForPlayer(g,newSpelId);
    r.spelWij=spelTeam==='wij'?newSpelId:null;
    r.spelZij=spelTeam==='zij'?newSpelId:null;
  }
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
  const durMs=g.date?Date.now()-new Date(g.date).getTime():null;
  const durStr=durMs?formatDuration(durMs):'';
  const boom=rondes>=16?'✅ Volledige boom (16 blaadjes)':'⚠️ Vroeg gestopt ('+rondes+'/16 blaadjes)';
  const saveBtn=document.getElementById('end-game-save-btn');
  if(saveBtn) saveBtn.textContent=rondes>=16?'✓ Opslaan en nieuwe boom starten':'✓ Opslaan & afsluiten';
  document.getElementById('end-game-summary').innerHTML=`
    <div style="text-align:center">
      <div style="font-size:12px;color:rgba(245,240,232,.4);margin-bottom:4px">${boom}</div>
      ${durStr?`<div style="font-size:11px;color:rgba(245,240,232,.3);margin-bottom:8px">⏱ ${durStr}</div>`:''}
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
  const trashedCount=games.filter(g=>g.deletedAt).length;
  el.innerHTML=[...games].filter(g=>!g.deletedAt).reverse().map(g=>{
    const wn=[...g.wij,...(g.wijBench||[])].map(id=>getPlayer(id)?.name||'?').join(' & ');
    const zn=[...g.zij,...(g.zijBench||[])].map(id=>getPlayer(id)?.name||'?').join(' & ');
    const d=new Date(g.date).toLocaleDateString('nl-NL',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    const scoreW=g.active?g.scoreWij:g.finalWij;
    const scoreZ=g.active?g.scoreZij:g.finalZij;
    const won=scoreW>scoreZ,draw=scoreW===scoreZ;
    const boomTag=g.active?'🔴':g.completed?'🌳':'🌿';
    const winnerName=won?getGameTeamNames(g,'wij'):getGameTeamNames(g,'zij');
    const statusTag=g.active
      ?`<span class="tag" style="background:rgba(39,174,96,.2);color:#2ecc71">Bezig</span>`
      :draw?`<span class="tag tag-draw">Gelijk</span>`:won?`<span class="tag tag-win">${winnerName} gewonnen</span>`:`<span class="tag tag-loss">${winnerName} gewonnen</span>`;
    const gameDur=(!g.active&&g.date&&g.endDate)?formatDuration(new Date(g.endDate)-new Date(g.date)):null;
    return `<div class="game-tile">
      <div class="game-tile-header" style="flex-direction:column;align-items:flex-start;gap:5px">
        <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
          <span class="game-date">${d} · ${g.rounds.length} blaadjes ${boomTag}${gameDur?' · ⏱'+gameDur:''}</span>
        </div>
        <div>${statusTag}</div>
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
  }).join('')+`
    <div style="padding:12px 16px 4px">
      <button class="btn btn-ghost" onclick="openTrash()" style="display:flex;align-items:center;gap:8px;justify-content:center">
        🗑 Prullenbak${trashedCount>0?` <span style="background:rgba(231,76,60,.25);color:#e74c3c;border-radius:10px;padding:1px 7px;font-size:11px">${trashedCount}</span>`:''}
      </button>
    </div>`;
}

function deleteGame(id){
  doConfirm('Naar prullenbak','Dit spel wordt naar de prullenbak verplaatst. Je kunt het binnen 30 dagen herstellen.',()=>{
    const g=games.find(g=>String(g.id)===String(id));
    if(g){ g.deletedAt=Date.now(); saveAll(); recalcPlayerStats(); renderHistory(); showToast('🗑 Naar prullenbak verplaatst'); }
  });
}

function openTrash(){
  // Auto-purge spellen ouder dan 30 dagen
  const cutoff=Date.now()-30*24*60*60*1000;
  const before=games.length;
  games=games.filter(g=>!g.deletedAt||g.deletedAt>cutoff);
  if(games.length!==before){saveAll();}

  const trashed=games.filter(g=>g.deletedAt).sort((a,b)=>b.deletedAt-a.deletedAt);
  const el=document.getElementById('modal-trash-content');

  if(!trashed.length){
    el.innerHTML=`<div class="modal-title">🗑 Prullenbak <span class="modal-close" onclick="closeModal('modal-trash')">✕</span></div>
      <div class="empty" style="padding:20px 0"><div class="empty-icon">🗑</div><div class="empty-text">Prullenbak is leeg</div></div>`;
  } else {
    const rows=trashed.map(g=>{
      const wn=getGameTeamNames(g,'wij');
      const zn=getGameTeamNames(g,'zij');
      const d=new Date(g.date).toLocaleDateString('nl-NL',{day:'numeric',month:'short',year:'numeric'});
      const daysLeft=Math.max(1,Math.ceil((30*24*60*60*1000-(Date.now()-g.deletedAt))/(24*60*60*1000)));
      const fw=g.finalWij??g.scoreWij??0;
      const fz=g.finalZij??g.scoreZij??0;
      return `<div style="padding:12px 0;border-bottom:1px solid rgba(245,240,232,.08)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div>
            <div style="font-size:11px;color:rgba(245,240,232,.4);margin-bottom:2px">${d} · ${g.rounds.length} blaadjes</div>
            <div style="font-size:12px;color:rgba(245,240,232,.7);margin-bottom:2px">${wn} vs ${zn}</div>
            <div style="font-size:16px;font-weight:700;color:var(--gold)">${fw} – ${fz}</div>
          </div>
          <div style="font-size:10px;color:rgba(245,240,232,.3);white-space:nowrap;padding-top:2px">nog ${daysLeft} dag${daysLeft!==1?'en':''}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" style="flex:1;font-size:12px" onclick="restoreGame('${g.id}')">↩ Herstellen</button>
          <button class="btn btn-red btn-sm" style="flex:1;font-size:12px" onclick="permanentDeleteGame('${g.id}')">🗑 Nu verwijderen</button>
        </div>
      </div>`;
    }).join('');
    el.innerHTML=`<div class="modal-title">🗑 Prullenbak <span class="modal-close" onclick="closeModal('modal-trash')">✕</span></div>
      <div style="font-size:11px;color:rgba(245,240,232,.4);margin-bottom:4px">Spellen worden na 30 dagen definitief verwijderd · niet meegerekend in statistieken</div>
      ${rows}
      ${trashed.length>1?`<button class="btn btn-red" style="margin-top:12px;width:100%" onclick="emptyTrash()">🗑 Prullenbak leegmaken (${trashed.length})</button>`:''}`;
  }
  openModal('modal-trash');
}

function restoreGame(id){
  const g=games.find(g=>String(g.id)===String(id));
  if(g){delete g.deletedAt;saveAll();recalcPlayerStats();openTrash();renderHistory();showToast('↩ Spel hersteld');}
}

function permanentDeleteGame(id){
  doConfirm('Definitief verwijderen','Dit spel wordt permanent verwijderd en kan niet worden hersteld.',()=>{
    games=games.filter(g=>String(g.id)!==String(id));
    saveAll();recalcPlayerStats();openTrash();renderHistory();showToast('🗑 Spel verwijderd');
  });
}

function emptyTrash(){
  doConfirm('Prullenbak leegmaken','Alle spellen in de prullenbak worden permanent verwijderd.',()=>{
    games=games.filter(g=>!g.deletedAt);
    saveAll();recalcPlayerStats();closeModal('modal-trash');renderHistory();showToast('🗑 Prullenbak leeggemaakt');
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
  const wn=getGameTeamNames(g,'wij');
  const zn=getGameTeamNames(g,'zij');
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
  let wijLossStreak=0,zijLossStreak=0;
  g.rounds.forEach((r,i)=>{
    const rSp=r.special||'';
    const wijNat=rSp.includes('NAT WIJ')||rSp.includes('VERZ WIJ');
    const zijNat=rSp.includes('NAT ZIJ')||rSp.includes('VERZ ZIJ');
    let pw=r.w,pz=r.z;
    if(wijNat){pw=0;pz=162;}
    else if(zijNat){pw=162;pz=0;}
    let dispRW=r.rw||0,dispRZ=r.rz||0;
    if(wijNat){dispRZ=(r.rw||0)+(r.rz||0);dispRW=0;}
    else if(zijNat){dispRW=(r.rw||0)+(r.rz||0);dispRZ=0;}
    cumW+=pw;cumZ+=pz;cumRW+=dispRW;cumRZ+=dispRZ;
    const totalW=pw+dispRW,totalZ=pz+dispRZ;
    if(totalW<totalZ){wijLossStreak++;zijLossStreak=0;}
    else if(totalZ<totalW){zijLossStreak++;wijLossStreak=0;}
    else{wijLossStreak=0;zijLossStreak=0;}
    const isJagen=wijLossStreak>=3||zijLossStreak>=3;
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
let statsFilter='spelers';

function renderSpelersLeaderboard(){
  if(!players.length){
    return `<div class="empty"><div class="empty-icon">👥</div><div class="empty-text">Nog geen spelers</div><div class="empty-sub">Voeg spelers toe om te beginnen</div></div>
      <div style="padding:8px 16px 16px"><button class="btn btn-ghost" onclick="openAddPlayerModal()">+ Nieuwe speler toevoegen</button></div>`;
  }
  const medals=['🥇','🥈','🥉'];

  // Samengestelde score: winrate 35% · avg kaartpunten/boom 40% · avg roem/boom 15% · wins (absoluut) 10%
  const activePlayers=players.filter(p=>p.games>0);
  const maxCard=Math.max(...activePlayers.map(p=>p.games?(p.totalCardScore||0)/p.games:0),1);
  const maxRoem2=Math.max(...activePlayers.map(p=>p.games?(p.totalRoemScore||0)/p.games:0),1);
  const maxWins2=Math.max(...activePlayers.map(p=>p.wins||0),1);
  const playerScore=p=>{
    if(!p.games) return 0;
    const wr=p.wins/p.games;
    const card=((p.totalCardScore||0)/p.games)/maxCard;
    const roem=((p.totalRoemScore||0)/p.games)/maxRoem2;
    const wins=(p.wins||0)/maxWins2;
    return wr*0.35 + card*0.40 + roem*0.15 + wins*0.10;
  };

  const ranked=[...players].sort((a,b)=>playerScore(b)-playerScore(a));

  const rows=ranked.map((p,i)=>{
    const wr=p.games?Math.round(p.wins/p.games*100):null;
    const avgCard2=p.games?Math.round((p.totalCardScore||0)/p.games):null;
    const avgRoem2=p.games?Math.round((p.totalRoemScore||0)/p.games):null;
    const score=Math.round(playerScore(p)*100);
    const avImg=p.photo?`<img src="${p.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:`${p.name[0].toUpperCase()}`;
    const form=getPlayerForm(p.id);
    const rank=i<3?`<span style="font-size:18px">${medals[i]}</span>`:`<span style="font-size:13px;color:rgba(245,240,232,.35);font-weight:700">${i+1}</span>`;
    const flame=form.streak>=3&&form.streakType==='W'?' 🔥':'';
    const ice=form.streak>=3&&form.streakType==='V'?' 🥶':'';
    return `<div class="player-tile" onclick="openProfile(${p.id})" style="padding:12px 16px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:26px;text-align:center;flex-shrink:0">${rank}</div>
        <div class="avatar" style="width:44px;height:44px;font-size:16px;flex-shrink:0">${avImg}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
            <span style="font-weight:700;font-size:15px">${p.name}${flame}${ice}</span>
            <div style="text-align:right">
              <div style="font-size:14px;font-weight:800;color:var(--gold)">${p.games?score:'—'}</div>
              <div style="font-size:9px;color:rgba(201,168,76,.5)">score</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:11px;color:rgba(245,240,232,.55);margin-bottom:${form.last5.length?'6':'0'}px">
            <span>🏆 ${p.wins}× gewonnen</span>
            <span>📈 ${wr!==null?wr+'%':'—'} winrate</span>
            <span>📊 ${avgCard2!==null?avgCard2:'—'} kaart/boom</span>
            <span>🌟 ${avgRoem2!==null?avgRoem2:'—'} roem/boom</span>
          </div>
          ${form.last5.length?`<div style="display:flex;gap:3px;align-items:center">
            <span style="font-size:9px;color:rgba(245,240,232,.3);margin-right:2px">LAATSTE</span>
            ${formBadges(form.last5)}
          </div>`:''}
        </div>
      </div>
    </div>`;
  }).join('');

  return `<div style="display:flex;align-items:center;gap:8px;padding:12px 16px 4px">
      <div style="font-size:12px;font-weight:600;color:rgba(245,240,232,.4);flex:1">Samengestelde score op basis van 4 factoren</div>
      <button onclick="openScoreInfo()" style="background:rgba(201,168,76,.15);border:1px solid rgba(201,168,76,.3);color:rgba(201,168,76,.8);border-radius:50%;width:24px;height:24px;font-size:12px;cursor:pointer;padding:0;line-height:1;flex-shrink:0">ℹ</button>
    </div>
    <div style="padding-bottom:4px">${rows}</div>
    <div style="padding:4px 16px 16px">
      <button class="btn btn-ghost" onclick="openAddPlayerModal()">+ Nieuwe speler toevoegen</button>
    </div>`;
}
let duoStatsFilter='all';

function renderStats(){
  // Ensure player stats reflect current games before rendering stats
  recalcPlayerStats();
  const filterEl=document.getElementById('stats-filter-row');
  const filters=[
    {k:'spelers',l:'👥 Spelers'},
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
  if(statsFilter==='spelers') el.innerHTML=renderSpelersLeaderboard();
  else if(statsFilter==='algemeen') el.innerHTML=renderAlgemeenStats();
  else if(statsFilter==='duo') el.innerHTML=renderDuoStats();
  else if(statsFilter==='tegenstanders') el.innerHTML=renderTegStats();
  else if(statsFilter==='records') el.innerHTML=renderRecordsStats();
}

function renderAlgemeenStats(){
  const totGames=games.length;
  const totRondes=games.reduce((s,g)=>s+g.rounds.length,0);
  const completedBomen=games.filter(g=>g.completed).length;
  const finishedGames=games.filter(g=>!g.active);
  const avgBlaadjes=finishedGames.length?Math.round(finishedGames.reduce((s,g)=>s+g.rounds.length,0)/finishedGames.length):0;
  const timedGames=finishedGames.filter(g=>g.completed&&g.date&&g.endDate);
  const avgDurMs=timedGames.length?timedGames.reduce((s,g)=>s+(new Date(g.endDate)-new Date(g.date)),0)/timedGames.length:null;
  const avgDurStr=avgDurMs?formatDuration(avgDurMs):null;
  const totalDurMs=timedGames.length?timedGames.reduce((s,g)=>s+(new Date(g.endDate)-new Date(g.date)),0):null;
  const totalDurStr=totalDurMs?formatDuration(totalDurMs):null;
  const completedFinished=finishedGames.filter(g=>g.completed&&typeof g.finalWij==='number'&&typeof g.finalZij==='number');
  const avgDiff=completedFinished.length?Math.round(completedFinished.reduce((s,g)=>s+Math.abs(g.finalWij-g.finalZij),0)/completedFinished.length):null;
  let allNat=0,allVerz=0,allPit=0;
  games.forEach(g=>g.rounds.forEach(r=>{if(r.special){if(r.special.includes('NAT'))allNat++;if(r.special.includes('VERZ'))allVerz++;if(r.special.includes('PIT'))allPit++;}}));
  const topScorer=players.sort((a,b)=>b.highScore-a.highScore)[0];
  const mostWins=players.sort((a,b)=>b.wins-a.wins)[0];
  return `
    <div class="card">
      <div class="card-label">Overzicht</div>
      <div class="stat-grid">
        <div class="stat-box"><div class="stat-value">${totGames}</div><div class="stat-label">🌳 Bomen</div></div>
        <div class="stat-box"><div class="stat-value">${totGames?Math.round(completedBomen/totGames*100):0}%</div><div class="stat-label">✅ Volledig</div></div>
        <div class="stat-box"><div class="stat-value">${avgBlaadjes}</div><div class="stat-label">📋 Gem. blaadjes</div></div>
        ${avgDurStr?`<div class="stat-box"><div class="stat-value">${avgDurStr}</div><div class="stat-label">⏱ Gem. speelduur</div></div>`:''}
        ${totalDurStr?`<div class="stat-box"><div class="stat-value">${totalDurStr}</div><div class="stat-label">🕐 Totale speeltijd</div></div>`:''}
        ${avgDiff!==null?`<div class="stat-box"><div class="stat-value">${avgDiff}</div><div class="stat-label">⚔️ Gem. puntenverschil</div></div>`:''}
      </div>
    </div>
    <div class="card">
      <div class="card-label">Speciale situaties (totaal)</div>
      <div style="font-size:11px;color:rgba(245,240,232,.35);margin-bottom:8px">Tik voor details per speler</div>
      <div class="stat-grid">
        <div class="stat-box" onclick="openSpecialsDetail('nat')" style="cursor:pointer"><div class="stat-value" style="color:#e74c3c">${allNat}</div><div class="stat-label">💧 Nat</div></div>
        <div class="stat-box" onclick="openSpecialsDetail('verz')" style="cursor:pointer"><div class="stat-value" style="color:#3498db">${allVerz}</div><div class="stat-label">🔵 Verzaakt</div></div>
        <div class="stat-box" onclick="openSpecialsDetail('pit')" style="cursor:pointer"><div class="stat-value" style="color:#9b59b6">${allPit}</div><div class="stat-label">💥 Pit</div></div>
        <div class="stat-box" onclick="openSpecialsDetail('kaap')" style="cursor:pointer"><div class="stat-value" style="color:var(--gold)">${players.reduce((s,p)=>s+(p.roundsKaap||0),0)}</div><div class="stat-label">🦅 Gekaapt</div></div>
      </div>
    </div>
    `;
}

function openSpecialsDetail(type){
  const cfg={
    nat: {icon:'💧',label:'Nat',getCount:p=>p.natAsMaker||0},
    verz:{icon:'🔵',label:'Verzaakt',getCount:p=>p.verzAsMaker||0},
    pit: {icon:'💥',label:'Pit',getCount:p=>p.pitAsMaker||0},
    kaap:{icon:'🦅',label:'Gekaapt',getCount:p=>p.roundsKaap||0},
  };
  const c=cfg[type];if(!c) return;

  function av(p){
    const inner=p.photo
      ?`<img src="${p.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      :`${p.name[0].toUpperCase()}`;
    return `<div class="avatar" style="width:36px;height:36px;font-size:14px;flex-shrink:0">${inner}</div>`;
  }

  const sorted=players.map(p=>({p,count:c.getCount(p)})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count);
  const perSpeler=sorted.length
    ?sorted.map(({p,count})=>`
      <div class="stat-row">
        <div style="display:flex;align-items:center;gap:10px">${av(p)}<span style="font-weight:600">${p.name}</span></div>
        <span style="font-weight:700;color:var(--gold)">${count}×</span>
      </div>`).join('')
    :`<div style="color:rgba(245,240,232,.4);font-size:13px;padding:8px 0">Nog geen data</div>`;

  let duoHTML='';
  if(type==='pit'||type==='nat'||type==='verz'){
    const tag=type==='pit'?'PIT':type==='nat'?'NAT':'VERZ';
    const duoCounts={};
    games.forEach(g=>{
      g.rounds.forEach((r,i)=>{
        if(!r.special) return;
        const sp=r.special.toUpperCase();
        if(!sp.includes(tag)) return;
        const isWij=sp.includes(tag+' WIJ')||(!sp.includes(tag+' ZIJ')&&sp.includes(tag));
        const {wij,zij}=getActiveTeamsAtRound(g,i);
        const team=isWij?wij:zij;
        if(team.length>=2){
          const key=getDuoKey(team[0],team[1]);
          duoCounts[key]=(duoCounts[key]||0)+1;
        }
      });
    });
    const duoList=Object.entries(duoCounts).map(([key,count])=>{
      const [a,b]=key.split('-').map(Number);
      return {pa:getPlayer(a),pb:getPlayer(b),count};
    }).filter(x=>x.pa&&x.pb).sort((a,b)=>b.count-a.count);
    if(duoList.length){
      duoHTML=`<div class="card-label" style="margin:14px 0 8px">Per duo</div>`
        +duoList.map(({pa,pb,count})=>`
        <div class="stat-row">
          <div style="display:flex;align-items:center;gap:6px">
            ${av(pa)}<span style="font-size:11px;color:rgba(245,240,232,.4)">+</span>${av(pb)}
            <span style="font-weight:600;margin-left:4px">${pa.name} & ${pb.name}</span>
          </div>
          <span style="font-weight:700;color:var(--gold)">${count}×</span>
        </div>`).join('');
    }
  }

  document.getElementById('modal-specials-detail-content').innerHTML=`
    <div class="modal-title">${c.icon} ${c.label} — details <span class="modal-close" onclick="closeModal('modal-specials-detail')">✕</span></div>
    <div class="card-label" style="margin-bottom:8px">Per speler</div>
    ${perSpeler}
    ${duoHTML}
    <div style="height:4px"></div>`;
  openModal('modal-specials-detail');
}

function getDuoKey(a,b){return [a,b].sort().join('-')}

// Bepaal de actieve 2 spelers per team op het moment van ronde roundIdx (0-based)
// door de wisselingen terug te spelen vanuit de huidige staat van g.wij/g.zij
function getActiveTeamsAtRound(g, roundIdx){
  let wij=[...g.wij], zij=[...g.zij];
  const ws=g.wisselingen||[];
  // Undo alle wisselingen om startopstelling te reconstrueren
  [...ws].reverse().forEach(w=>{
    if(w.wijIn!==undefined){const i=wij.indexOf(w.wijIn);if(i>=0)wij[i]=w.wijUit;}
    if(w.zijIn!==undefined){const i=zij.indexOf(w.zijIn);if(i>=0)zij[i]=w.zijUit;}
  });
  // Replay wisselingen tot en met roundIdx
  ws.forEach(w=>{
    if(w.blaadje<=roundIdx){
      if(w.wijIn!==undefined){const i=wij.indexOf(w.wijUit);if(i>=0)wij[i]=w.wijIn;}
      if(w.zijIn!==undefined){const i=zij.indexOf(w.zijUit);if(i>=0)zij[i]=w.zijIn;}
    }
  });
  return {wij,zij};
}

function renderDuoStats(){
  const duos={};
  const ensureDuo=(a,b)=>{
    const key=getDuoKey(a,b);
    if(!duos[key]) duos[key]={key,p1:Math.min(a,b)===a?a:b,p2:Math.min(a,b)===a?b:a,
      games:0,wins:0,totalGamePoints:0,totalGameRoem:0,
      roundsActive:0,pointsInRounds:0,totalRoem:0,
      nat:0,verz:0,pit:0,
      natByP1:0,natByP2:0,natUnknown:0,
      verzByP1:0,verzByP2:0,verzUnknown:0,
      pitByP1:0,pitByP2:0,pitUnknown:0};
    return duos[key];
  };

  games.forEach(g=>{
    // "bomen samen": tellen voor alle spelers die samen in het spel zaten (actief of bank)
    const wijAll=[...g.wij,...(g.wijBench||[])];
    const zijAll=[...g.zij,...(g.zijBench||[])];
    const finalWij=g.active?g.scoreWij:(g.finalWij??g.scoreWij);
    const finalZij=g.active?g.scoreZij:(g.finalZij??g.scoreZij);
    const wijWon=!g.active&&finalWij>finalZij;
    const zijWon=!g.active&&finalZij>finalWij;
    [wijAll,zijAll].forEach((team,ti)=>{
      const pts=ti===0?finalWij:finalZij;
      const won=ti===0?wijWon:zijWon;
      for(let a=0;a<team.length;a++)
        for(let b=a+1;b<team.length;b++){
          const d=ensureDuo(team[a],team[b]);
          d.games++;
          d.totalGamePoints+=pts||0;
          d.totalGameRoem+=(ti===0?(g.roemWij||0):(g.roemZij||0));
          if(won) d.wins++;
        }
    });

    // Roem per ronde bijhouden voor actieve duo
    g.rounds.forEach((r,i)=>{
      const {wij:wa,zij:za}=getActiveTeamsAtRound(g,i);
      if(wa.length>=2){const d=ensureDuo(wa[0],wa[1]);d.totalRoem+=(r.rw||0);}
      if(za.length>=2){const d=ensureDuo(za[0],za[1]);d.totalRoem+=(r.rz||0);}
    });

    // nat/verz/pit: altijd toegeschreven aan het ACTIEVE duo op dat moment
    g.rounds.forEach((r,i)=>{
      if(!r.special) return;
      const sp=r.special;
      const {wij:wa,zij:za}=getActiveTeamsAtRound(g,i);
      // Effectieve punten voor deze ronde (0 bij nat/verz)
      const sp0=r.special||'';
      const rPtsWij=sp0.includes('NAT WIJ')||sp0.includes('VERZ WIJ')?0:(r.w||0);
      const rPtsZij=sp0.includes('NAT ZIJ')||sp0.includes('VERZ ZIJ')?0:(r.z||0);
      [{team:wa,tag:'WIJ',isWij:true,rPts:rPtsWij},{team:za,tag:'ZIJ',isWij:false,rPts:rPtsZij}].forEach(({team,tag,isWij,rPts})=>{
        if(team.length<2) return;
        const d=ensureDuo(team[0],team[1]);
        d.roundsActive++;
        d.pointsInRounds+=rPts;
        const [pa,pb]=[team[0],team[1]].sort();
        // p1/p2 in duos zijn gesorteerd op ID — match via key
        const actualP1=duos[d.key].p1, actualP2=duos[d.key].p2;

        if(sp.includes('NAT '+tag)){
          d.nat++;
          let maker=isWij?+r.spelWij:+r.spelZij;
          if(!maker) maker=+r.spelId||0;
          if(!maker&&r.uitId&&team.includes(+r.uitId)) maker=+r.uitId;
          if(maker===actualP1) d.natByP1++;
          else if(maker===actualP2) d.natByP2++;
          else d.natUnknown++;
        }
        if(sp.includes('VERZ '+tag)){
          d.verz++;
          const vId=r.verzPlayerId||(isWij?r.spelWij:r.spelZij)||r.spelId;
          const vm=+vId;
          if(vm===actualP1) d.verzByP1++;
          else if(vm===actualP2) d.verzByP2++;
          else d.verzUnknown++;
        }
        if(sp.includes('PIT '+tag)){
          d.pit++;
          const maker=isWij?+r.spelWij:+r.spelZij;
          if(maker===actualP1) d.pitByP1++;
          else if(maker===actualP2) d.pitByP2++;
          else d.pitUnknown++;
        }
      });
    });
  });

  const allEntries=Object.values(duos)
    .filter(d=>d.games>0&&getPlayer(d.p1)&&getPlayer(d.p2));

  if(!allEntries.length) return `<div class="empty"><div class="empty-icon">👫</div><div class="empty-text">Nog geen duo-data</div></div>`;

  // Samengestelde score: winrate 35% · avg kaartpunten/boom 40% · avg roem/boom 15% · wins (absoluut) 10%
  // Alles genormaliseerd naar 0–1 op basis van het maximum in de huidige dataset
  const maxCard=Math.max(...allEntries.map(d=>d.games?(d.totalGamePoints-d.totalGameRoem)/d.games:0),1);
  const maxRoem=Math.max(...allEntries.map(d=>d.games?d.totalGameRoem/d.games:0),1);
  const maxWins=Math.max(...allEntries.map(d=>d.wins||0),1);
  const duoScore=d=>{
    const wr=d.games?d.wins/d.games:0;
    const card=d.games?((d.totalGamePoints-d.totalGameRoem)/d.games)/maxCard:0;
    const roem=d.games?(d.totalGameRoem/d.games)/maxRoem:0;
    const wins=(d.wins||0)/maxWins;
    return wr*0.35 + card*0.40 + roem*0.15 + wins*0.10;
  };

  const sorted=[...allEntries].sort((a,b)=>duoScore(b)-duoScore(a));

  // Sla duos op (gesorteerd op score) voor openPlayerDuos
  window._duoEntries=sorted;
  window._duoScore=duoScore;

  function duoRow(d, rank){
    const p1=getPlayer(d.p1),p2=getPlayer(d.p2);
    const wr=d.games?Math.round(d.wins/d.games*100):0;
    const avgCard=d.games?Math.round((d.totalGamePoints-d.totalGameRoem)/d.games):0;
    const avgRoem=d.games?Math.round(d.totalGameRoem/d.games):0;
    const score=Math.round(duoScore(d)*100);
    const av1=p1.photo?`<img src="${p1.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:`${p1.name[0]}`;
    const av2=p2.photo?`<img src="${p2.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:`${p2.name[0]}`;
    const medal=['🥇','🥈','🥉'][rank];
    const rankEl=rank!==undefined
      ?`<span style="font-size:${medal?'18':'12'}px;width:24px;text-align:center;color:rgba(245,240,232,.35);font-weight:700">${medal||rank+1}</span>`
      :'';
    return `<div style="padding:10px 0;border-bottom:1px solid rgba(245,240,232,.06)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">
        ${rankEl}
        <div style="display:flex">
          <div class="avatar" style="width:32px;height:32px;font-size:12px">${av1}</div>
          <div class="avatar" style="width:32px;height:32px;font-size:12px;margin-left:-6px">${av2}</div>
        </div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${p1.name} & ${p2.name}</div>
          <div style="font-size:11px;color:rgba(245,240,232,.4)">${d.games}× samen gespeeld</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:800;color:var(--gold);font-size:16px">${score}</div>
          <div style="font-size:9px;color:rgba(245,240,232,.35)">score</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;${rank!==undefined?'margin-left:34px':''}">
        <div style="background:rgba(245,240,232,.05);border-radius:6px;padding:5px;text-align:center">
          <div style="font-size:12px;font-weight:700;color:var(--win)">${d.wins}</div>
          <div style="font-size:9px;color:rgba(245,240,232,.4)">🏆 winst</div>
        </div>
        <div style="background:rgba(245,240,232,.05);border-radius:6px;padding:5px;text-align:center">
          <div style="font-size:12px;font-weight:700;color:${wr>=50?'var(--win)':'#e74c3c'}">${wr}%</div>
          <div style="font-size:9px;color:rgba(245,240,232,.4)">📈 winrate</div>
        </div>
        <div style="background:rgba(245,240,232,.05);border-radius:6px;padding:5px;text-align:center">
          <div style="font-size:12px;font-weight:700;color:var(--gold)">${avgCard}</div>
          <div style="font-size:9px;color:rgba(245,240,232,.4)">📊 kaart/boom</div>
        </div>
        <div style="background:rgba(245,240,232,.05);border-radius:6px;padding:5px;text-align:center">
          <div style="font-size:12px;font-weight:700;color:var(--gold)">${avgRoem}</div>
          <div style="font-size:9px;color:rgba(245,240,232,.4)">🌟 roem/boom</div>
        </div>
      </div>
    </div>`;
  }

  const top5=sorted.slice(0,5);
  const bottom5=[...sorted].reverse().slice(0,5).reverse();

  // Speler-chips: alle spelers die in minstens 1 duo zitten
  const inDuoIds=new Set(allEntries.flatMap(d=>[d.p1,d.p2]));
  const duoPlayers=players.filter(p=>inDuoIds.has(p.id)).sort((a,b)=>a.name.localeCompare(b.name));
  const playerChips=duoPlayers.map(p=>`
    <button onclick="openPlayerDuos(${p.id})" style="background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.25);color:rgba(245,240,232,.8);border-radius:20px;padding:5px 12px;font-size:12px;cursor:pointer;white-space:nowrap">${p.name}</button>
  `).join('');

  return `
    <div class="card">
      <div class="card-label" style="margin-bottom:10px">🔍 Duo's per speler</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${playerChips}</div>
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div class="card-label" style="margin-bottom:0">🏆 Top 5 beste duo's</div>
        <button onclick="openScoreInfo()" style="background:rgba(201,168,76,.15);border:1px solid rgba(201,168,76,.3);color:rgba(201,168,76,.8);border-radius:50%;width:20px;height:20px;font-size:11px;cursor:pointer;padding:0;line-height:1;flex-shrink:0">ℹ</button>
      </div>
      <div style="font-size:11px;color:rgba(245,240,232,.35);margin-bottom:8px">Samengestelde score op basis van 4 factoren</div>
      ${top5.map((d,i)=>duoRow(d,i)).join('<div style="height:1px;background:rgba(245,240,232,.06)"></div>')}
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div class="card-label" style="margin-bottom:0">📉 Top 5 slechtste duo's</div>
        <button onclick="openScoreInfo()" style="background:rgba(201,168,76,.15);border:1px solid rgba(201,168,76,.3);color:rgba(201,168,76,.8);border-radius:50%;width:20px;height:20px;font-size:11px;cursor:pointer;padding:0;line-height:1;flex-shrink:0">ℹ</button>
      </div>
      <div style="font-size:11px;color:rgba(245,240,232,.35);margin-bottom:8px">Samengestelde score op basis van 4 factoren</div>
      ${bottom5.map((d,i)=>duoRow(d,allEntries.length-bottom5.length+i)).join('<div style="height:1px;background:rgba(245,240,232,.06)"></div>')}
    </div>`;
}

function openScoreInfo(){
  document.getElementById('modal-specials-detail-content').innerHTML=`
    <div class="modal-title">ℹ Hoe werkt de score? <span class="modal-close" onclick="closeModal('modal-specials-detail')">✕</span></div>
    <div style="font-size:13px;color:rgba(245,240,232,.65);margin-bottom:14px;line-height:1.5">De score combineert 4 statistieken. Per onderdeel wordt jouw waarde vergeleken met de <strong style="color:rgba(245,240,232,.85)">hoogste in jouw groep</strong>. Wie het hoogst scoort op een onderdeel krijgt altijd 100% op dat punt — de rest wordt daar procentueel mee vergeleken.</div>

    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
      <div style="background:rgba(245,240,232,.06);border-radius:10px;padding:11px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
          <span style="font-size:13px;font-weight:700">📈 Winstpercentage</span>
          <span style="font-size:15px;font-weight:800;color:var(--gold)">35%</span>
        </div>
        <div style="font-size:11px;color:rgba(245,240,232,.4)">Gewonnen bomen ÷ gespeelde bomen</div>
      </div>
      <div style="background:rgba(245,240,232,.06);border-radius:10px;padding:11px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
          <span style="font-size:13px;font-weight:700">📊 Gem. kaartpunten/boom</span>
          <span style="font-size:15px;font-weight:800;color:var(--gold)">40%</span>
        </div>
        <div style="font-size:11px;color:rgba(245,240,232,.4)">Puur kaartpunten per boom (zonder roem)</div>
      </div>
      <div style="background:rgba(245,240,232,.06);border-radius:10px;padding:11px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
          <span style="font-size:13px;font-weight:700">🌟 Gem. roem/boom</span>
          <span style="font-size:15px;font-weight:800;color:var(--gold)">15%</span>
        </div>
        <div style="font-size:11px;color:rgba(245,240,232,.4)">Gemiddelde roempunten per boom</div>
      </div>
      <div style="background:rgba(245,240,232,.06);border-radius:10px;padding:11px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
          <span style="font-size:13px;font-weight:700">🏆 Totaal winsten</span>
          <span style="font-size:15px;font-weight:800;color:var(--gold)">10%</span>
        </div>
        <div style="font-size:11px;color:rgba(245,240,232,.4)">Absoluut aantal gewonnen bomen</div>
      </div>
    </div>

    <div style="background:rgba(201,168,76,.08);border:1px solid rgba(201,168,76,.2);border-radius:10px;padding:12px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:rgba(201,168,76,.9);margin-bottom:8px">Voorbeeld — alleen winstpercentage</div>
      <div style="font-size:12px;color:rgba(245,240,232,.6);line-height:1.7;margin-bottom:8px">
        Tim wint 8 van de 10 bomen → <strong style="color:rgba(245,240,232,.85)">80%</strong> (hoogste in de groep)<br>
        Jannou wint 6 van de 10 bomen → <strong style="color:rgba(245,240,232,.85)">60%</strong>
      </div>
      <div style="font-size:11px;color:rgba(245,240,232,.45);line-height:1.9">
        Tim: 80% ÷ 80% = <strong style="color:rgba(245,240,232,.7)">1.00</strong> × 35 = <span style="color:rgba(245,240,232,.8)">35 punten</span><br>
        Jannou: 60% ÷ 80% = <strong style="color:rgba(245,240,232,.7)">0.75</strong> × 35 = <span style="color:rgba(245,240,232,.8)">26 punten</span>
      </div>
      <div style="margin-top:6px;border-top:1px solid rgba(245,240,232,.1);padding-top:6px;font-size:11px;color:rgba(245,240,232,.4)">Hetzelfde principe geldt voor de andere 3 factoren. Alle punten bij elkaar opgeteld = eindscore (max 100).</div>
    </div>
    <div style="height:8px"></div>`;
  openModal('modal-specials-detail');
}

function openPlayerDuos(playerId){
  const p=getPlayer(playerId);if(!p) return;
  const scoreF=window._duoScore||(d=>d.games?d.totalGamePoints/d.games:0);
  // Already sorted by score in window._duoEntries; filter and keep that order
  const myDuos=(window._duoEntries||[]).filter(d=>d.p1===playerId||d.p2===playerId);

  const medals=['🥇','🥈','🥉'];
  const rows=myDuos.map((d,i)=>{
    const partner=getPlayer(d.p1===playerId?d.p2:d.p1);if(!partner) return '';
    const wr=d.games?Math.round(d.wins/d.games*100):0;
    const avgCard=d.games?Math.round((d.totalGamePoints-d.totalGameRoem)/d.games):0;
    const avgRoem=d.games?Math.round(d.totalGameRoem/d.games):0;
    const score=Math.round(scoreF(d)*100);
    const av=partner.photo?`<img src="${partner.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:`${partner.name[0]}`;
    const medal=medals[i];
    const rank=medal?`<span style="font-size:18px">${medal}</span>`:`<span style="font-size:12px;color:rgba(245,240,232,.35);font-weight:700">${i+1}</span>`;
    return `<div style="padding:10px 0;border-bottom:1px solid rgba(245,240,232,.07)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px">
        <span style="width:24px;text-align:center">${rank}</span>
        <div class="avatar" style="width:36px;height:36px;font-size:14px">${av}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${partner.name}</div>
          <div style="font-size:11px;color:rgba(245,240,232,.4)">${d.games}× samen gespeeld</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:800;color:var(--gold);font-size:16px">${score}</div>
          <div style="font-size:9px;color:rgba(245,240,232,.35)">score</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin-left:34px">
        <div style="background:rgba(245,240,232,.05);border-radius:6px;padding:5px;text-align:center">
          <div style="font-size:12px;font-weight:700;color:var(--win)">${d.wins}</div>
          <div style="font-size:9px;color:rgba(245,240,232,.4)">🏆 winst</div>
        </div>
        <div style="background:rgba(245,240,232,.05);border-radius:6px;padding:5px;text-align:center">
          <div style="font-size:12px;font-weight:700;color:${wr>=50?'var(--win)':'#e74c3c'}">${wr}%</div>
          <div style="font-size:9px;color:rgba(245,240,232,.4)">📈 winrate</div>
        </div>
        <div style="background:rgba(245,240,232,.05);border-radius:6px;padding:5px;text-align:center">
          <div style="font-size:12px;font-weight:700;color:var(--gold)">${avgCard}</div>
          <div style="font-size:9px;color:rgba(245,240,232,.4)">📊 kaart/boom</div>
        </div>
        <div style="background:rgba(245,240,232,.05);border-radius:6px;padding:5px;text-align:center">
          <div style="font-size:12px;font-weight:700;color:var(--gold)">${avgRoem}</div>
          <div style="font-size:9px;color:rgba(245,240,232,.4)">🌟 roem/boom</div>
        </div>
      </div>
    </div>`;
  }).filter(Boolean).join('');

  document.getElementById('modal-specials-detail-content').innerHTML=`
    <div class="modal-title">👫 Duo's van ${p.name} <span class="modal-close" onclick="closeModal('modal-specials-detail')">✕</span></div>
    <div style="font-size:11px;color:rgba(245,240,232,.35);margin-bottom:12px">Gesorteerd van beste naar slechtste duo</div>
    ${rows||`<div style="color:rgba(245,240,232,.4);padding:20px 0;text-align:center">Nog geen duo-data</div>`}
    <div style="height:8px"></div>`;
  openModal('modal-specials-detail');
}

// Bouw individuele head-to-head data: voor elk koppel (p1 vs p2) dat ooit tegenover elkaar stond
function buildH2H(){
  const h2h={};
  const ensure=(a,b)=>{
    const key=[a,b].sort().join('-');
    if(!h2h[key]) h2h[key]={p1:Math.min(a,b),p2:Math.max(a,b),games:0,p1Wins:0,p2Wins:0,draws:0};
    return h2h[key];
  };
  games.filter(g=>!g.active).forEach(g=>{
    const wijAll=[...g.wij,...(g.wijBench||[])];
    const zijAll=[...g.zij,...(g.zijBench||[])];
    const wijWon=(g.finalWij??g.scoreWij)>(g.finalZij??g.scoreZij);
    const draw=(g.finalWij??g.scoreWij)===(g.finalZij??g.scoreZij);
    wijAll.forEach(w=>zijAll.forEach(z=>{
      const d=ensure(w,z);
      d.games++;
      const wIsP1=w===d.p1; // p1 is altijd de kleinste ID
      if(draw) d.draws++;
      else if(wijWon){ if(wIsP1) d.p1Wins++; else d.p2Wins++; }
      else { if(wIsP1) d.p2Wins++; else d.p1Wins++; }
    }));
  });
  return h2h;
}

function renderTegStats(){
  const h2h=buildH2H();
  const allPids=[...new Set(Object.values(h2h).flatMap(d=>[d.p1,d.p2]))];
  const activePids=allPids.filter(id=>getPlayer(id));
  if(!activePids.length) return `<div class="empty"><div class="empty-icon">⚔️</div><div class="empty-text">Nog geen onderlinge duels</div></div>`;

  return activePids.map(pid=>{
    const p=getPlayer(pid);if(!p) return '';
    // Verzamel alle matchups voor deze speler
    const myMatchups=Object.values(h2h).filter(d=>d.p1===pid||d.p2===pid).map(d=>{
      const oppId=d.p1===pid?d.p2:d.p1;
      const myWins=d.p1===pid?d.p1Wins:d.p2Wins;
      const wr=d.games?Math.round(myWins/d.games*100):0;
      return {oppId,games:d.games,myWins,wr};
    }).filter(m=>m.games>0).sort((a,b)=>b.games-a.games);
    if(!myMatchups.length) return '';

    const best=myMatchups.reduce((a,b)=>b.wr>a.wr?b:a);
    const worst=myMatchups.reduce((a,b)=>b.wr<a.wr?b:a);
    const bestP=getPlayer(best.oppId);
    const worstP=getPlayer(worst.oppId);
    const avImg=p.photo
      ?`<img src="${p.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      :`${p.name[0].toUpperCase()}`;

    return `<div class="player-tile" onclick="openTegDetail(${pid})" style="padding:14px 16px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="avatar" style="width:48px;height:48px;font-size:18px;flex-shrink:0">${avImg}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:15px;margin-bottom:6px">${p.name}</div>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${bestP?`<div style="font-size:12px;display:flex;align-items:center;gap:6px">
              <span style="background:rgba(39,174,96,.15);color:var(--win);border-radius:6px;padding:2px 7px;font-weight:600;font-size:11px">${best.wr}%</span>
              <span style="color:rgba(245,240,232,.55)">vs ${bestP.name} — gunstigst</span>
            </div>`:''}
            ${worstP&&worst.oppId!==best.oppId?`<div style="font-size:12px;display:flex;align-items:center;gap:6px">
              <span style="background:rgba(231,76,60,.15);color:var(--loss);border-radius:6px;padding:2px 7px;font-weight:600;font-size:11px">${worst.wr}%</span>
              <span style="color:rgba(245,240,232,.55)">vs ${worstP.name} — lastigst</span>
            </div>`:''}
          </div>
        </div>
        <div style="color:rgba(245,240,232,.25);font-size:18px">›</div>
      </div>
    </div>`;
  }).filter(Boolean).join('');
}

function openTegDetail(pid){
  const p=getPlayer(pid);if(!p) return;
  const h2h=buildH2H();
  const myMatchups=Object.values(h2h).filter(d=>d.p1===pid||d.p2===pid).map(d=>{
    const oppId=d.p1===pid?d.p2:d.p1;
    const myWins=d.p1===pid?d.p1Wins:d.p2Wins;
    const oppWins=d.games-myWins-d.draws;
    const wr=d.games?Math.round(myWins/d.games*100):0;
    return {oppId,games:d.games,myWins,oppWins,draws:d.draws,wr};
  }).filter(m=>m.games>0).sort((a,b)=>b.games-a.games||b.wr-a.wr);

  const rows=myMatchups.map(m=>{
    const opp=getPlayer(m.oppId);if(!opp) return '';
    const avImg=opp.photo
      ?`<img src="${opp.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      :`${opp.name[0].toUpperCase()}`;
    const barColor=m.wr>=50?'var(--win)':'var(--loss)';
    return `<div style="padding:12px 0;border-bottom:1px solid rgba(245,240,232,.07)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <div class="avatar" style="width:36px;height:36px;font-size:14px;flex-shrink:0">${avImg}</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${opp.name}</div>
          <div style="font-size:11px;color:rgba(245,240,232,.4)">${m.games}× tegenover gestaan</div>
        </div>
        <div style="font-weight:700;font-size:18px;color:${barColor}">${m.wr}%</div>
      </div>
      <div style="background:rgba(255,255,255,.08);border-radius:6px;height:6px;margin-bottom:6px">
        <div style="background:${barColor};width:${m.wr}%;height:100%;border-radius:6px;transition:width .3s"></div>
      </div>
      <div style="display:flex;gap:12px;font-size:11px;color:rgba(245,240,232,.4)">
        <span style="color:var(--win)">${m.myWins}× gewonnen</span>
        <span style="color:var(--loss)">${m.oppWins}× verloren</span>
        ${m.draws?`<span>${m.draws}× gelijk</span>`:''}
      </div>
    </div>`;
  }).join('');

  document.getElementById('modal-teg-detail-content').innerHTML=`
    <div class="modal-title">${p.name} — Tegenstanders <span class="modal-close" onclick="closeModal('modal-teg-detail')">✕</span></div>
    ${rows||'<div style="color:rgba(245,240,232,.4);text-align:center;padding:20px">Nog geen data</div>'}
  `;
  openModal('modal-teg-detail');
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
  // ps = single player or array; getVal = fn(p)=>numeric for tie detection
  function row(icon,label,ps,val,extra=''){
    const arr=Array.isArray(ps)?ps:(ps?[ps]:[]);
    if(!arr.length||!arr[0]) return '';
    const avatars=arr.map(p=>av(p)).join('');
    const names=arr.map(p=>p.name).join(', ');
    return `<div class="stat-row">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="display:flex;gap:-6px">${arr.length>1?`<div style="display:flex">${arr.map((p,i)=>`<div style="margin-left:${i?-10:0}px">${av(p)}</div>`).join('')}</div>`:av(arr[0])}</div>
        <div>
          <div style="font-size:13px;font-weight:600">${icon} ${label}</div>
          <div style="font-size:11px;color:rgba(245,240,232,.4)">${names}${extra}</div>
        </div>
      </div>
      <div style="font-weight:700;color:var(--gold);text-align:right">${val}</div>
    </div>`;
  }
  // Returns all players tied for first in a sorted array, using getVal to compare
  function tied(sortedArr,getVal){
    if(!sortedArr.length) return [];
    const best=getVal(sortedArr[0]);
    return sortedArr.filter(p=>getVal(p)===best);
  }
  function tiedObj(sortedArr,getVal){
    // For arrays of {p,s} objects
    if(!sortedArr.length) return [];
    const best=getVal(sortedArr[0]);
    return sortedArr.filter(x=>getVal(x)===best);
  }

  // Grootste comeback: max achterstand op enig moment in gewonnen spel
  let biggestComeback={team:null,val:0};
  // Laagste eindscore (alleen voltooide bomen)
  let lowestScore={team:null,val:Infinity};
  // Vaakst overwinning verspeeld (voorstond halverwege maar verloor)
  const verspeeld={};
  // Alleen voltooide bomen voor records die boom-uitkomst vereisen
  games.filter(g=>!g.active&&g.completed&&g.rounds.length>=2).forEach(g=>{
    const fw=(typeof g.finalWij==='number')?g.finalWij:g.scoreWij;
    const fz=(typeof g.finalZij==='number')?g.finalZij:g.scoreZij;
    if(fw===fz) return;
    const wijWon=fw>fz;
    // Laagste eindscore — sla het hele verliezende team op
    const loser=wijWon?fz:fw;
    if(loser<lowestScore.val){
      lowestScore={team:wijWon?g.zij:g.wij, val:loser};
    }
    // Grootste comeback
    let wR=0,zR=0,maxDeficit=0;
    g.rounds.forEach(r=>{
      wR+=r.w+r.rw; zR+=r.z+r.rz;
      const deficit=wijWon?zR-wR:wR-zR;
      if(deficit>maxDeficit) maxDeficit=deficit;
    });
    if(maxDeficit>biggestComeback.val){
      biggestComeback={team:wijWon?g.wij:g.zij,val:maxDeficit};
    }
    // Overwinning verspeeld: alleen voltooide bomen met >=8 blaadjes
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

  // Langste en snelste boom (alleen voltooide spellen met start- en eindtijd)
  const timedGames=games.filter(g=>!g.active&&g.completed&&g.date&&g.endDate);
  let longestGame=null,shortestGame=null;
  timedGames.forEach(g=>{
    const dur=new Date(g.endDate)-new Date(g.date);
    if(!longestGame||dur>longestGame.dur) longestGame={g,dur};
    if(!shortestGame||dur<shortestGame.dur) shortestGame={g,dur};
  });

  const byWins=[...active].sort((a,b)=>b.wins-a.wins);
  const byHighScore=[...active].sort((a,b)=>b.highScore-a.highScore);
  const byGames=[...active].sort((a,b)=>b.games-a.games);
  const byWr=active.filter(p=>p.games>=2).sort((a,b)=>(b.wins/b.games)-(a.wins/a.games));
  const byNat=[...active].sort((a,b)=>(b.natAsMaker||0)-(a.natAsMaker||0));
  const byVerz=[...active].sort((a,b)=>(b.verzAsMaker||0)-(a.verzAsMaker||0));
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

  function gameRow(icon, label, entry){
    if(!entry) return '';
    const {g, dur}=entry;
    const d=new Date(g.date).toLocaleDateString('nl-NL',{day:'numeric',month:'short'});
    const fw=(typeof g.finalWij==='number')?g.finalWij:g.scoreWij;
    const fz=(typeof g.finalZij==='number')?g.finalZij:g.scoreZij;
    const wijNames=getGameTeamNames(g,'wij');
    const zijNames=getGameTeamNames(g,'zij');
    return `<div class="stat-row">
      <div>
        <div style="font-size:13px;font-weight:600">${icon} ${label}</div>
        <div style="font-size:11px;color:rgba(245,240,232,.4)">${d} · ${wijNames} vs ${zijNames}</div>
        <div style="font-size:11px;color:rgba(245,240,232,.35)">${fw} – ${fz} · ${g.rounds.length} blaadjes</div>
      </div>
      <div style="font-weight:700;color:var(--gold);text-align:right;white-space:nowrap">${formatDuration(dur)}</div>
    </div>`;
  }

  const boomRecordsHTML=(longestGame||shortestGame)?`
    <div class="card">
      <div class="card-label">⏱ Boom records</div>
      ${gameRow('🐌','Langste boom',longestGame)}
      ${gameRow('⚡','Snelste boom',shortestGame)}
    </div>`:'';

  return boomRecordsHTML+`
    <div class="card">
      <div class="card-label">🏅 Erelijst</div>
      ${row('🏆','Meeste overwinningen',tied(byWins,p=>p.wins),tied(byWins,p=>p.wins)[0]?.wins+'× gewonnen')}
      ${row('⭐','Hoogste score ooit',tied(byHighScore,p=>p.highScore),tied(byHighScore,p=>p.highScore)[0]?.highScore+' punten')}
      ${row('📈','Beste winrate',tied(byWr,p=>p.wins/p.games).slice(0,3),byWr[0]?Math.round(byWr[0].wins/byWr[0].games*100)+'%':'—',' (min. 2 bomen)')}
      ${row('🎮','Meest actief',tied(byGames,p=>p.games),tied(byGames,p=>p.games)[0]?.games+' bomen gespeeld')}
      ${(()=>{const t=tiedObj(byWinStreak,x=>x.s);return row('🔥','Langste winreeks ooit',t.map(x=>x.p),t[0]?.s+'× op rij');})()}
      ${row('💥','Meeste pits',tied(byPit,p=>p.pit||0),(byPit[0]?.pit||0)+'× pit')}
      ${row('🦅','Vaakst gekaapt',tied(byKaap,p=>p.roundsKaap||0),(byKaap[0]?.roundsKaap||0)+'× andermans beurt gepakt')}
      ${biggestComeback.team?row('📈','Grootste comeback',biggestComeback.team.map(getPlayer).filter(Boolean),'+'+biggestComeback.val+' punten achterstand omgebogen'):''}
    </div>
    <div class="card">
      <div class="card-label">😅 Twijfelachtige records</div>
      ${row('💧','Vaakst nat',tied(byNat,p=>p.natAsMaker||0),(byNat[0]?.natAsMaker||0)+'× nat')}
      ${row('🔵','Vaakst verzaakt',tied(byVerz,p=>p.verzAsMaker||0),(byVerz[0]?.verzAsMaker||0)+'× verzaakt')}
      ${row('💀','Meeste nederlagen',tied(byLosses,p=>p.losses),tied(byLosses,p=>p.losses)[0]?.losses+'× verloren')}
      ${(()=>{const t=tiedObj(byLossStreak,x=>x.s);return row('😰','Langste verliesreeks ooit',t.map(x=>x.p),t[0]?.s+'× op rij verloren');})()}
      ${byVerspeeld[0]?row('😬','Vaakst overwinning verspeeld',byVerspeeld.filter(p=>(verspeeld[p.id]||0)===(verspeeld[byVerspeeld[0].id]||0)),(verspeeld[byVerspeeld[0].id]||0)+'× voorgestaan maar toch verloren'):''}
      ${lowestScore.team?row('📉','Laagste eindscore',lowestScore.team.map(getPlayer).filter(Boolean),lowestScore.val+' punten'):''}
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
      const byPitDuo=[...duos].sort((a,b)=>(b.pit||0)-(a.pit||0));
      return `<div class="card">
        <div class="card-label">🤝 Duo records</div>
        ${drow('🏆','Beste duo',byWr[0]||byGames[0],byWr[0]?Math.round(byWr[0].wins/byWr[0].games*100)+'% winrate':(Math.round((byGames[0]?.wins||0)/(byGames[0]?.games||1)*100)+'% winrate'))}
        ${drow('🎮','Meest samen gespeeld',byGames[0],byGames[0]?.games+' bomen')}
        ${byNat[0]?.nat>0?drow('💧','Vaakst samen nat',byNat[0],byNat[0].nat+'× nat'):''}
        ${byPitDuo[0]?.pit>0?drow('💥','Vaakst samen pit',byPitDuo[0],byPitDuo[0].pit+'× pit'):''}
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
        const wn=getGameTeamNames(g,'wij');
        const zn=getGameTeamNames(g,'zij');
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
    const wn=getGameTeamNames(g,'wij');
    const zn=getGameTeamNames(g,'zij');
    const d=new Date(g.date).toLocaleDateString('nl-NL',{day:'numeric',month:'short'});
    const won=g.finalWij>g.finalZij,draw=g.finalWij===g.finalZij;
    const winnerName=won?wn:zn;
    return `<div class="game-tile" onclick="openGameDetail('${g.id}')">
      <div class="game-tile-header">
        <span class="game-date">${d} · ${g.rounds.length} blaadjes ${g.completed?'🌳':'🌿'}</span>
        ${draw?`<span class="tag tag-draw">Gelijk</span>`:won?`<span class="tag tag-win">${winnerName} gewonnen</span>`:`<span class="tag tag-loss">${winnerName} gewonnen</span>`}
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
  else if(name==='players') renderStats(); // players is merged into stats/spelers
  else if(name==='history') renderHistory();
  else if(name==='game') renderGame();
  else if(name==='stats') renderStats();
  else if(name==='toernooi') renderToernooi();
}

function _applyConvexData(data){
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
  const fromConvex = viewId ? (games.find(g=>String(g.id)===viewId&&g.active)||null) : null;
  if(fromConvex){
    current = fromConvex;
    _localGamePending = null;
  } else if(_localGamePending && viewId === _localGamePending && current){
    if(!games.find(g=>String(g.id)===_localGamePending)) games.push(current);
  } else if(!_localGamePending){
    current = fromConvex;
  }
  if(_localGamePending && !current) _localGamePending = null;
  _convexReady = true;
  _refreshActiveView();
  // Verberg laadscherm zodra data binnenkomt
  const loader=document.getElementById('app-loading');
  if(loader){loader.style.opacity='0';setTimeout(()=>loader.remove(),400);}
}

_client.onUpdate(_api.data.getData,{},(data)=>{
  if(!data) return;
  // Blokkeer overschrijven van lokale state terwijl een save in-flight is
  // (voorkomt "replay" effect waarbij Convex oude data terugstuurt)
  if(_savePending>0){
    _pendingConvexData=data; // Buffer — wordt toegepast zodra save klaar is
    return;
  }
  _applyConvexData(data);
});


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
  _dbg:()=>({games,players}),
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
  renderSpelersLeaderboard,
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
  clearRoem,
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
  openTrash,
  restoreGame,
  permanentDeleteGame,
  emptyTrash,
  editGameFromHistory,
  openGameDetail,
  renderStats,
  setStatsFilter,
  renderStatsContent,
  renderAlgemeenStats,
  getDuoKey,
  renderDuoStats,
  renderTegStats,
  openTegDetail,
  renderRecordsStats,
  renderHome,
  recalcPlayerStats,
  addBenchSlot,
  openSpecialsDetail,
  openScoreInfo,
  openPlayerDuos,
  toggleWisselCard,
  openWisselModal,
  confirmWissel,
  openVolgordeModal,
  swapVolgorde,
  openRemovePlayerModal,
  confirmRemovePlayer,
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
