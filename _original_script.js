
// ══════════════════════════════════════════
//  DATA & STORAGE
// ══════════════════════════════════════════
const S={
  load(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},
  save(k,v){localStorage.setItem(k,JSON.stringify(v))}
};

let players=S.load('kj_players',[]);
let games=S.load('kj_games',[]);
let current=S.load('kj_current',null);

function saveAll(){S.save('kj_players',players);S.save('kj_games',games);S.save('kj_current',current)}

// Recalculate per-player aggregated stats from all stored games.
function recalcPlayerStats(){
  // Reset aggregated fields for each player
  players.forEach(p=>{
    p.games=0;
    p.wins=0;
    p.losses=0;
    p.draws=0;
    p.rounds=0;
    p.totalScore=0;
    p.highScore=0;
    p.nat=0;
    p.verz=0;
    p.pit=0;
    p.natAsMaker=0;
    p.pitAsMaker=0;
    p.verzAsMaker=0;
  });
  // Aggregate stats from each stored game
  games.forEach(g=>{
    if(g.active) return; // skip active games
    // Determine final scores
    const finalWij = (typeof g.finalWij === 'number') ? g.finalWij : g.scoreWij;
    const finalZij = (typeof g.finalZij === 'number') ? g.finalZij : g.scoreZij;
    const wijWon = finalWij > finalZij;
    const draw    = finalWij === finalZij;
    // Helper: count special tags for a team in this game
    function countSp(tag){
      return g.rounds.filter(r => r.special && r.special.includes(tag)).length;
    }
    // Per-player updates
    [...g.wij,...g.zij].forEach(pid=>{
      const p=getPlayer(pid); if(!p) return;
      const isWij=g.wij.includes(pid);
      p.games++;
      p.rounds += g.rounds.length;
      if(draw) p.draws++;
      else if((isWij && wijWon) || (!isWij && !wijWon)) p.wins++;
      else p.losses++;
      const myScore = isWij ? finalWij : finalZij;
      p.totalScore += myScore;
      if(myScore > p.highScore) p.highScore = myScore;
      if(isWij){
        p.nat  += countSp('NAT WIJ');
        p.verz += countSp('VERZ WIJ');
        p.pit  += countSp('PIT WIJ');
      } else {
        p.nat  += countSp('NAT ZIJ');
        p.verz += countSp('VERZ ZIJ');
        p.pit  += countSp('PIT ZIJ');
      }
    });
    // Maker stats from rounds
    g.rounds.forEach(r=>{
      if(r.spelWij){
        const pp=getPlayer(+r.spelWij);
        if(pp){
          if(r.special && r.special.includes('NAT WIJ')) pp.natAsMaker++;
          if(r.special && r.special.includes('PIT WIJ')) pp.pitAsMaker++;
          if(r.special && r.special.includes('VERZ WIJ')) pp.verzAsMaker++;
        }
      }
      if(r.spelZij){
        const pp=getPlayer(+r.spelZij);
        if(pp){
          if(r.special && r.special.includes('NAT ZIJ')) pp.natAsMaker++;
          if(r.special && r.special.includes('PIT ZIJ')) pp.pitAsMaker++;
          if(r.special && r.special.includes('VERZ ZIJ')) pp.verzAsMaker++;
        }
      }
    });
  });
  // Persist recalculated stats
  saveAll();
}

// Auto-save on unload
window.addEventListener('beforeunload',()=>{if(current&&current.active) saveAll()});

// ══════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════
function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.getElementById('nav-'+name).classList.add('active');
  if(name==='home') renderHome();
  if(name==='players') renderPlayers();
  if(name==='history') renderHistory();
  if(name==='game') renderGame();
  if(name==='stats') renderStats();
}

// ══════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════
function showToast(msg,err=false){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className='show'+(err?' error':'');
  clearTimeout(t._tid);t._tid=setTimeout(()=>t.className='',2400);
}

// ══════════════════════════════════════════
//  MODALS
// ══════════════════════════════════════════
function openModal(id){document.getElementById(id).classList.add('open')}
function closeModal(id){document.getElementById(id).classList.remove('open')}
document.querySelectorAll('.modal-overlay').forEach(o=>{
  o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open')});
});
function doConfirm(title,msg,cb){
  document.getElementById('confirm-title').textContent=title;
  document.getElementById('confirm-msg').textContent=msg;
  document.getElementById('confirm-yes').onclick=()=>{closeModal('modal-confirm');cb()};
  openModal('modal-confirm');
}

// ══════════════════════════════════════════
//  SOUND EFFECTS (Web Audio API)
// ══════════════════════════════════════════
function playWaterSound(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const master=ctx.createGain();
    master.gain.value=0.55;
    master.connect(ctx.destination);

    const duration=2.6;
    const buf=ctx.createBuffer(1,ctx.sampleRate*duration,ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++){
      const t=i/ctx.sampleRate;
      const fade=Math.exp(-t/0.9);
      d[i]=(Math.random()*2-1)*fade;
    }
    const src=ctx.createBufferSource();
    src.buffer=buf;

    const low=ctx.createBiquadFilter();
    low.type='lowpass';
    low.frequency.setValueAtTime(1400,ctx.currentTime);
    low.frequency.exponentialRampToValueAtTime(240,ctx.currentTime+duration);

    const band=ctx.createBiquadFilter();
    band.type='bandpass';
    band.frequency.value=420;
    band.Q.value=0.9;

    src.connect(low);
    low.connect(band);
    band.connect(master);
    src.start();

    [0,0.14,0.28,0.48,0.7,0.95].forEach((offset,i)=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type='sine';
      osc.frequency.setValueAtTime(180+i*25,ctx.currentTime+offset);
      osc.frequency.exponentialRampToValueAtTime(60,ctx.currentTime+offset+0.35);
      gain.gain.setValueAtTime(0.001,ctx.currentTime+offset);
      gain.gain.exponentialRampToValueAtTime(0.12,ctx.currentTime+offset+0.02);
      gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+offset+0.35);
      osc.connect(gain);
      gain.connect(master);
      osc.start(ctx.currentTime+offset);
      osc.stop(ctx.currentTime+offset+0.35);
    });
  }catch(e){}
}

function playDestructionSound(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const master=ctx.createGain();
    master.gain.value=0.55;
    master.connect(ctx.destination);

    [0,0.04,0.08].forEach((t,i)=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.frequency.setValueAtTime(180-(i*35),ctx.currentTime+t);
      osc.frequency.exponentialRampToValueAtTime(55,ctx.currentTime+t+0.45);
      osc.type='sawtooth';
      gain.gain.setValueAtTime(0.001,ctx.currentTime+t);
      gain.gain.exponentialRampToValueAtTime(0.28,ctx.currentTime+t+0.01);
      gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.45);
      osc.connect(gain);gain.connect(master);
      osc.start(ctx.currentTime+t);osc.stop(ctx.currentTime+t+0.45);
    });
  }catch(e){}

  try{
    const synth=window.speechSynthesis;
    if(!synth) return;
    synth.cancel();
    const utter=new SpeechSynthesisUtterance('DEEESTRUCCTIOOOON');
    utter.lang='nl-NL';
    utter.rate=0.7;
    utter.pitch=0.62;
    utter.volume=1;
    const voices=synth.getVoices?.()||[];
    const preferred=voices.find(v=>/nl|dutch/i.test((v.lang||'')+' '+(v.name||'')))||voices[0];
    if(preferred) utter.voice=preferred;
    synth.speak(utter);
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

function showPitFX(){
  playDestructionSound();
  const fx=document.getElementById('fx-overlay');
  fx.style.display='flex';
  fx.style.background='rgba(155,89,182,0.15)';
  fx.innerHTML=`
    <div class="pit-boom">💥</div>
    <div class="pit-text" style="margin-top:10px">DEEESTRUCCTIOOOON</div>
    <div style="font-size:13px;color:rgba(245,240,232,.6);margin-top:8px;animation:boom .8s .4s ease both">PIT gespeeld! 🟣</div>`;
  setTimeout(()=>{fx.style.display='none';fx.innerHTML='';fx.style.background='';},2400);
}

function showRookPauze(){
  openModal('modal-rook');
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
    return `<div class="player-tile" onclick="openProfile(${p.id})">
      <div class="avatar">${avImg}</div>
      <div class="player-info">
        <div class="player-name">${p.name}</div>
        <div class="player-stats-line">🏆 ${p.wins}× gewonnen &nbsp;💀 ${p.losses}× verloren &nbsp;💧 ${p.nat}× nat</div>
      </div>${badge}</div>`;
  }).join('');
}

function openProfile(id){
  const p=getPlayer(id);if(!p) return;
  const wr=p.games?Math.round(p.wins/p.games*100):0;
  const avg=p.rounds?Math.round(p.totalScore/p.rounds):0;
  const since=new Date(p.created).toLocaleDateString('nl-NL',{day:'numeric',month:'long',year:'numeric'});
  const kaapPct=p.roundsPlayed?Math.round(p.roundsKaap/p.roundsPlayed*100):0;
  const spelPct= p.rounds>0 && current? Math.round(p.roundsPlayed/p.rounds*100):0;
  const pg=games.filter(g=>g.wij.includes(p.id)||g.zij.includes(p.id)).slice(-5).reverse();
  const avImg=p.photo?`<img src="${p.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:`${p.name[0].toUpperCase()}`;
  const recentHTML=pg.length?pg.map(g=>{
    const isWij=g.wij.includes(p.id);
    const my=isWij?g.finalWij:g.finalZij,opp=isWij?g.finalZij:g.finalWij;
    const tag=my===opp?`<span class="tag tag-draw">Gelijk</span>`:my>opp?`<span class="tag tag-win">Gewonnen</span>`:`<span class="tag tag-loss">Verloren</span>`;
    const d=new Date(g.date).toLocaleDateString('nl-NL',{day:'numeric',month:'short'});
    return `<div class="stat-row"><div><div style="font-size:13px;font-weight:600">${my} – ${opp}</div><div style="font-size:11px;color:rgba(245,240,232,.4)">${d} · ${g.rounds.length} rondes</div></div>${tag}</div>`;
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
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(245,240,232,.5);margin-bottom:3px"><span>Winstpercentage</span><span>${wr}%</span></div>
      <div class="bar-wrap"><div class="bar-fill" style="width:${wr}%"></div></div>
    </div>

    <div class="stat-grid" style="margin-bottom:10px">
      <div class="stat-box"><div class="stat-value" style="color:#e74c3c">${p.nat}</div><div class="stat-label">💧 Keer nat</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#3498db">${p.verz}</div><div class="stat-label">🔵 Keer verzaakt</div></div>
      <div class="stat-box"><div class="stat-value" style="color:#9b59b6">${p.pit}</div><div class="stat-label">💥 Keer pit</div></div>
      <div class="stat-box"><div class="stat-value">${p.highScore}</div><div class="stat-label">⭐ Hoogste score</div></div>
    </div>
    <div class="stat-grid" style="margin-bottom:10px">
      <div class="stat-box"><div class="stat-value">${avg}</div><div class="stat-label">📊 Gem./ronde</div></div>
      <div class="stat-box"><div class="stat-value">${p.rounds}</div><div class="stat-label">🔄 Rondes</div></div>
      <div class="stat-box"><div class="stat-value">${p.roundsPlayed||0}</div><div class="stat-label">🎴 Keer gespeld</div></div>
      <div class="stat-box"><div class="stat-value">${kaapPct}%</div><div class="stat-label">🦅 Kaapt mee</div></div>
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
    const p=getPlayer(id);if(!p) return;
    p.photo=e.target.result;saveAll();
    const av=document.getElementById('profile-av-'+id);
    if(av) av.innerHTML=`<img src="${p.photo}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    renderPlayers();showToast('📷 Foto opgeslagen!');
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
  const starter=+document.getElementById('sel-starter').value;
  const ids=[w1,z1,w2,z2];
  if(players.length>=4 && new Set(ids).size<ids.length) return showToast('Elke speler mag maar 1x meedoen',true);
  if(!ids.map(String).includes(String(starter))) return showToast('Kies een starter die in dit potje zit',true);
  current={id:Date.now(),date:new Date().toISOString(),
    wij:[w1,w2],zij:[z1,z2],seatOrder:[w1,z1,w2,z2],starter,
    scoreWij:0,scoreZij:0,roemWij:0,roemZij:0,
    rounds:[],active:true};
  saveAll();closeModal('modal-new-game');switchView('game');showToast('Boom gestart! 🌳 Veel plezier');
}

function resumeLastGame(){
  if(!current||!current.active){showToast('Geen actief spel gevonden',true);return}
  switchView('game');
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
    document.getElementById('header-round-info').textContent='';
    return;
  }
  if(empty) empty.style.display='none';
  if(active) active.style.display='block';

  const g=current;
  if(refreshGameAutoSpecials(g)) recalcGameTotals(g), saveAll();
  const wn=g.wij.map(id=>getPlayer(id)?.name||'?').join(' & ');
  const zn=g.zij.map(id=>getPlayer(id)?.name||'?').join(' & ');
  const rnd=Math.min(g.rounds.length+1,16);

  document.getElementById('wij-label').textContent=wn;
  document.getElementById('zij-label').textContent=zn;
  document.getElementById('wij-pts-label').textContent=wn+' (punten)';
  document.getElementById('zij-pts-label').textContent=zn+' (punten)';
  document.getElementById('score-wij').textContent=g.scoreWij;
  document.getElementById('score-zij').textContent=g.scoreZij;
  document.getElementById('roem-wij').textContent=g.roemWij;
  document.getElementById('roem-zij').textContent=g.roemZij;
  document.getElementById('round-num').textContent=rnd;
  document.getElementById('ronde-progress').textContent=`ronde ${Math.min(g.rounds.length+1,16)}/16`;
  document.getElementById('header-round-info').textContent=g.rounds.length<16?`🌳 ${Math.min(g.rounds.length+1,16)}/16`:'🌳 Vol';

  const uitId=getUitbeurt(g.rounds.length);
  const uitPlayer=getPlayer(uitId);
  if(uitPlayer){
    document.getElementById('uitbeurt-bar').style.display='flex';
    document.getElementById('uitbeurt-name').textContent=uitPlayer.name;
    document.getElementById('uitbeurt-ronde').textContent=`Ronde ${rnd}`;
  }

  const allOpts=getSeatOrder(g).map(id=>`<option value="${id}">${getPlayer(id)?.name||'?'}</option>`).join('');
  const spelSelect=document.getElementById('sel-speler');
  spelSelect.innerHTML=`<option value="">— Kies wie speelt —</option>`+allOpts;
  spelSelect.value=String(uitId||'');

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
    return {w:0,z:162+rw+rz,roemWij:0,roemZij:rz};
  }
  if(special.includes('NAT ZIJ')){
    return {w:162+rw+rz,z:0,roemWij:rw,roemZij:0};
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
function applySpecial(type,team){
  const other=team==='wij'?'zij':'wij';
  ['input-wij','input-zij','input-roem-wij','input-roem-zij'].forEach(id=>document.getElementById(id).value='');
  if(type==='nat'){
    document.getElementById('input-'+team).value=0;
    document.getElementById('input-'+other).value=162;
    document.getElementById('input-wij').dataset.special='NAT '+(team==='wij'?'WIJ':'ZIJ');
    document.getElementById('input-wij').dataset.natTeam=team;
    showToast('💧 NAT '+(team==='wij'?'Wij':'Zij')+' — voer roem in indien gemaakt');
    // Auto-submit after short delay with fx
    setTimeout(()=>{ showNatFX(); setTimeout(()=>submitRound(),600); },200);
  } else if(type==='verz'){
    document.getElementById('input-'+team).value=0;
    document.getElementById('input-'+other).value=162;
    document.getElementById('input-roem-'+other).value=100;
    document.getElementById('input-wij').dataset.special='VERZ '+(team==='wij'?'WIJ':'ZIJ');
    showToast('🔵 VERZ '+(team==='wij'?'Wij':'Zij')+' — 100 roem straf');
    setTimeout(()=>submitRound(),400);
  } else if(type==='pit'){
    document.getElementById('input-'+team).value=162;
    document.getElementById('input-'+other).value=0;
    document.getElementById('input-roem-'+team).value=100;
    document.getElementById('input-wij').dataset.special='PIT '+(team==='wij'?'WIJ':'ZIJ');
    setTimeout(()=>{ showPitFX(); setTimeout(()=>submitRound(),800); },200);
  }
}

// ══════════════════════════════════════════
//  SUBMIT ROUND
// ══════════════════════════════════════════
function submitRound(){
  const g=current;if(!g) return;
  if(g.rounds.length>=16){showToast('Maximaal 16 rondes bereikt',true);return}

  const w=parseInt(document.getElementById('input-wij').value);
  const z=parseInt(document.getElementById('input-zij').value);
  const rw=parseInt(document.getElementById('input-roem-wij').value)||0;
  const rz=parseInt(document.getElementById('input-roem-zij').value)||0;
  if(isNaN(w)||isNaN(z)) return showToast('Voer punten in voor beide teams',true);
  if(w+z!==162) return showToast('Punten van Wij en Zij moeten samen 162 zijn',true);

  const special=document.getElementById('input-wij').dataset.special||'';
  delete document.getElementById('input-wij').dataset.special;
  delete document.getElementById('input-wij').dataset.natTeam;

  const spelId=document.getElementById('sel-speler').value||null;
  if(!spelId) return showToast('Selecteer eerst wie speelt',true);
  const spelTeam=getTeamForPlayer(g,spelId);
  const spelWij=spelTeam==='wij'?spelId:null;
  const spelZij=spelTeam==='zij'?spelId:null;

  // Determine who made it and if nat auto-detected
  const uitId=getUitbeurt(g.rounds.length);
  const rondeData={w,z,rw,rz,special:'',spelId,spelWij,spelZij,uitId};
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
    showToast('🌳 Boom vol! 16 rondes gespeeld');
    setTimeout(()=>confirmEndGame(),700);
  } else {
    showToast('✓ Ronde '+(g.rounds.length)+' verwerkt');
    renderGame();
  }
}

function undoLastRound(){
  const g=current;if(!g||!g.rounds.length) return showToast('Geen ronde om ongedaan te maken',true);
  const l=g.rounds.pop();
  recalcGameTotals(g);
  const p=getPlayer(+(l.spelId||0));
  if(p){
    p.roundsPlayed=Math.max(0,(p.roundsPlayed||0)-1);
    if(String(l.spelId)!==String(l.uitId)) p.roundsKaap=Math.max(0,(p.roundsKaap||0)-1);
  }
  saveAll();renderGame();showToast('↩ Ronde ongedaan gemaakt');
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
    tb.innerHTML=`<tr><td colspan="9" style="color:rgba(245,240,232,.3);padding:14px">Nog geen rondes</td></tr>`;
    tf.innerHTML='';return;
  }
  let cw=0,cz=0;
  tb.innerHTML=g.rounds.map((r,i)=>{
    cw+=r.w; cz+=r.z; // running pts only (no roem in running total shown in table)
    const sp=r.special?`<span style="font-size:9px;color:rgba(245,240,232,.4)">${r.special.replace(' WIJ','').replace(' ZIJ','').replace(' (auto)','')}</span>`:'—';
    const rondeSpelerId=r.spelId||r.spelWij||r.spelZij;
    const spelNaam=rondeSpelerId?getPlayer(+rondeSpelerId)?.name?.split(' ')[0]:'—';
    return `<tr class="round-row" draggable="true"
      ondragstart="dragStart(${i})" ondragover="dragOver(event,${i})" ondrop="dropRound(${i})" ondragend="dragEnd()"
      id="rnd-row-${i}">
      <td style="color:rgba(245,240,232,.2);font-size:14px">⠿</td>
      <td style="color:rgba(245,240,232,.4)">${i+1}</td>
      <td style="font-size:10px;color:rgba(245,240,232,.5);max-width:48px;overflow:hidden">${spelNaam}</td>
      <td><b>${r.w}</b></td>
      <td style="color:rgba(201,168,76,.7);font-size:10px">${r.rw||'—'}</td>
      <td><b>${r.z}</b></td>
      <td style="color:rgba(201,168,76,.7);font-size:10px">${r.rz||'—'}</td>
      <td>${sp}</td>
      <td><button onclick="editRound(${i})" style="background:none;border:none;color:rgba(201,168,76,.6);cursor:pointer;font-size:13px;padding:2px 4px">✏️</button></td>
    </tr>`;
  }).join('');

  // Totaal row in tfoot
  tf.innerHTML=`<tr class="totaal-row">
    <td colspan="3" style="text-align:left;font-size:10px;letter-spacing:.5px">TOTAAL</td>
    <td>${g.scoreWij}</td>
    <td style="color:rgba(201,168,76,.7);font-size:10px">${g.roemWij}</td>
    <td>${g.scoreZij}</td>
    <td style="color:rgba(201,168,76,.7);font-size:10px">${g.roemZij}</td>
    <td colspan="2"></td>
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
  openModal('modal-edit-round');
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
  r.w=newW;r.z=newZ;r.rw=newRW;r.rz=newRZ;
  refreshRoundAutoSpecial(g,r);
  recalcGameTotals(g);
  saveAll();
  closeModal('modal-edit-round');
  renderGame();
  showToast('✓ Ronde '+(i+1)+' aangepast');
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
  const wn=g.wij.map(id=>getPlayer(id)?.name||'?').join(' & ');
  const zn=g.zij.map(id=>getPlayer(id)?.name||'?').join(' & ');
  const rondes=g.rounds.length;
  const boom=rondes>=16?'✅ Volledige boom (16 rondes)':'⚠️ Vroeg gestopt ('+rondes+'/16 rondes)';
  const saveBtn=document.getElementById('end-game-save-btn');
  if(saveBtn) saveBtn.textContent=rondes>=16?'✓ Opslaan en nieuwe boom starten':'✓ Opslaan & afsluiten';
  document.getElementById('end-game-summary').innerHTML=`
    <div style="text-align:center">
      <div style="font-size:12px;color:rgba(245,240,232,.4);margin-bottom:8px">${boom}</div>
      <div style="font-size:13px;color:rgba(245,240,232,.6)">${wn}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin:8px 0">
        <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:900;color:var(--gold)">${g.scoreWij}</div>
        <div style="color:rgba(245,240,232,.3)">–</div>
        <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:900;color:var(--gold)">${g.scoreZij}</div>
      </div>
      <div style="font-size:13px;color:rgba(245,240,232,.6)">${zn}</div>
    </div>`;
  openModal('modal-end-game');
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
  const startFresh=g.rounds.length>=16;
  games.push(g);
  current=null;
  // Recalculate player stats after saving the completed game
  recalcPlayerStats();
  saveAll();
  closeModal('modal-end-game');
  showToast('🏁 Boom opgeslagen!');
  switchView('home');
  if(startFresh) setTimeout(()=>openNewGameModal(),250);
}

// ══════════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════════
function renderHistory(){
  const el=document.getElementById('history-list');
  if(!games.length){el.innerHTML=`<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Nog geen spellen</div><div class="empty-sub">Start je eerste boom!</div></div>`;return}
  el.innerHTML=[...games].reverse().map(g=>{
    const wn=g.wij.map(id=>getPlayer(id)?.name||'?').join(' & ');
    const zn=g.zij.map(id=>getPlayer(id)?.name||'?').join(' & ');
    const d=new Date(g.date).toLocaleDateString('nl-NL',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    const won=g.finalWij>g.finalZij,draw=g.finalWij===g.finalZij;
    const boomTag=g.completed?'🌳':'🌿';
    return `<div class="game-tile">
      <div class="game-tile-header">
        <span class="game-date">${d} · ${g.rounds.length} rondes ${boomTag}</span>
        ${draw?`<span class="tag tag-draw">Gelijk</span>`:won?`<span class="tag tag-win">Wij won</span>`:`<span class="tag tag-loss">Zij won</span>`}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div onclick="openGameDetail('${g.id}')" style="flex:1;cursor:pointer">
          <div style="font-size:12px;color:rgba(245,240,232,.5);margin-bottom:2px">${wn} vs ${zn}</div>
          <div class="game-score-big">${g.finalWij} – ${g.finalZij}</div>
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
  // Restore as current game for editing
  doConfirm('Spel hervatten','Dit spel wordt hervat zodat je het kunt aanpassen. Het huidige actieve spel gaat verloren.',()=>{
    games=games.filter(x=>String(x.id)!==String(id));
    g.active=true;
    delete g.finalWij;
    delete g.finalZij;
    delete g.endDate;
    recalcGameTotals(g);
    current=g;
    // Recalculate player stats after removing this game for editing
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
  const d=new Date(g.date).toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  let cw=0,cz=0;
  const rows=g.rounds.map((r,i)=>{
    const rndPtsW=r.w, rndPtsZ=r.z;
    cw+=r.w+r.rw;cz+=r.z+r.rz;
    const sp=r.special||'';
    const rondeSpelerId=r.spelId||r.spelWij||r.spelZij;
    const spelNaam=rondeSpelerId?getPlayer(+rondeSpelerId)?.name||'?':'—';
    return `<tr>
      <td style="color:rgba(245,240,232,.4)">${i+1}</td>
      <td style="font-size:10px;color:rgba(245,240,232,.4)">${spelNaam}</td>
      <td><b>${rndPtsW}</b></td>
      <td style="color:rgba(201,168,76,.7);font-size:10px">${r.rw||'—'}</td>
      <td><b>${rndPtsZ}</b></td>
      <td style="color:rgba(201,168,76,.7);font-size:10px">${r.rz||'—'}</td>
      <td style="font-size:9px;color:rgba(245,240,232,.4)">${sp.replace(' WIJ','').replace(' ZIJ','')}</td>
    </tr>`;
  }).join('');
  document.getElementById('modal-game-detail-content').innerHTML=`
    <div class="modal-title">Spel details <span class="modal-close" onclick="closeModal('modal-game-detail')">✕</span></div>
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:11px;color:rgba(245,240,232,.4);margin-bottom:6px">${d}</div>
      <div style="font-size:12px;color:rgba(245,240,232,.6)">${wn}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin:6px 0">
        <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:900;color:var(--gold)">${g.finalWij}</div>
        <div style="color:rgba(245,240,232,.25)">–</div>
        <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:900;color:var(--gold)">${g.finalZij}</div>
      </div>
      <div style="font-size:12px;color:rgba(245,240,232,.6)">${zn}</div>
      <div style="font-size:11px;color:rgba(245,240,232,.35);margin-top:6px">${g.rounds.length} rondes · Roem: ${g.roemWij||0} – ${g.roemZij||0} · ${g.completed?'🌳 Volledige boom':'🌿 Onvolledig'}</div>
    </div>
    <div class="card-label" style="margin-bottom:8px">Ronde voor ronde</div>
    <div style="overflow-x:auto">
      <table class="round-table">
        <thead><tr><th>#</th><th>Speler</th><th>Pnt W</th><th>R W</th><th>Pnt Z</th><th>R Z</th><th>Bijz.</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="totaal-row"><td colspan="2">TOTAAL</td><td>${g.finalWij}</td><td style="color:rgba(201,168,76,.7);font-size:10px">${g.roemWij}</td><td>${g.finalZij}</td><td style="color:rgba(201,168,76,.7);font-size:10px">${g.roemZij}</td><td></td></tr></tfoot>
      </table>
    </div>`;
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
        <div class="stat-box"><div class="stat-value">${Math.round(totRondes/(totGames||1))}</div><div class="stat-label">Gem. rondes</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-label">Speciale situaties (totaal)</div>
      <div class="stat-grid">
        <div class="stat-box"><div class="stat-value" style="color:#e74c3c">${allNat}</div><div class="stat-label">💧 Nat</div></div>
        <div class="stat-box"><div class="stat-value" style="color:#3498db">${allVerz}</div><div class="stat-label">🔵 Verzaakt</div></div>
        <div class="stat-box"><div class="stat-value" style="color:#9b59b6">${allPit}</div><div class="stat-label">💥 Pit</div></div>
        <div class="stat-box"><div class="stat-value">${totRondes?Math.round((allNat+allVerz+allPit)/totRondes*100):0}%</div><div class="stat-label">Bijz. per ronde</div></div>
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
        natByP1:0,natByP2:0,pitByP1:0,pitByP2:0,verzByP1:0,verzByP2:0,completedBomen:0};
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
          if(r.spelWij&&isWij){const m=+r.spelWij;if(m===team[0]) d.natByP1++; else if(m===team[1]) d.natByP2++;}
          if(r.spelZij&&!isWij){const m=+r.spelZij;if(m===team[0]) d.natByP1++; else if(m===team[1]) d.natByP2++;}
        }
        if(sp.includes('VERZ '+teamTag)) d.verz++;
        if(sp.includes('PIT '+teamTag)){
          d.pit++;
          if(r.spelWij&&isWij){const m=+r.spelWij;if(m===team[0]) d.pitByP1++; else if(m===team[1]) d.pitByP2++;}
          if(r.spelZij&&!isWij){const m=+r.spelZij;if(m===team[0]) d.pitByP1++; else if(m===team[1]) d.pitByP2++;}
        }
      });
    });
  });

  const entries=Object.values(duos).sort((a,b)=>b.games-a.games);
  if(!entries.length) return `<div class="empty"><div class="empty-icon">👫</div><div class="empty-text">Nog geen duo-data</div></div>`;

  if(duoStatsFilter!=='all' && !entries.find(d=>d.key===duoStatsFilter)) duoStatsFilter='all';
  const options=['<option value="all">Alle duo\'s</option>'].concat(entries.map(d=>{
    const p1=getPlayer(d.p1), p2=getPlayer(d.p2);
    return `<option value="${d.key}">${p1?.name||'?'} & ${p2?.name||'?'}</option>`;
  })).join('');
  const filtered=duoStatsFilter==='all'?entries:entries.filter(d=>d.key===duoStatsFilter);

  const cards=filtered.map(d=>{
    const p1=getPlayer(d.p1),p2=getPlayer(d.p2);
    if(!p1||!p2) return '';
    const wr=d.games?Math.round(d.wins/d.games*100):0;
    const natPct=d.games?Math.round(d.nat/d.games*100):0;
    const pitPct=d.games?Math.round(d.pit/d.games*100):0;
    const verzPct=d.games?Math.round(d.verz/d.games*100):0;
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
          <div class="stat-value" style="color:#e74c3c">${d.nat}</div><div class="stat-label">💧 Keer nat (${natPct}%)</div>
          ${d.nat>0?`<div style="font-size:10px;color:rgba(245,240,232,.4);margin-top:4px">${p1.name}: ${d.natByP1}× · ${p2.name}: ${d.natByP2}×</div>`:''}
        </div>
        <div class="stat-box">
          <div class="stat-value" style="color:#9b59b6">${d.pit}</div><div class="stat-label">💥 Pit (${pitPct}%)</div>
          ${d.pit>0?`<div style="font-size:10px;color:rgba(245,240,232,.4);margin-top:4px">${p1.name}: ${d.pitByP1}× · ${p2.name}: ${d.pitByP2}×</div>`:''}
        </div>
        <div class="stat-box"><div class="stat-value" style="color:#3498db">${d.verz}</div><div class="stat-label">🔵 Verzaakt (${verzPct}%)</div></div>
      </div>
    </div>`;
  }).join('');

  return `<div class="card" style="margin-bottom:10px">
    <div class="card-label">Filter duo's</div>
    <select onchange="duoStatsFilter=this.value;renderStatsContent()" style="margin-bottom:0">${options.replace(`value="${duoStatsFilter}"`,`value="${duoStatsFilter}" selected`)}</select>
  </div>${cards}`;
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
  const sorted=players.filter(p=>p.games>0).sort((a,b)=>b.wins-a.wins);
  if(!sorted.length) return `<div class="empty"><div class="empty-icon">🏆</div><div class="empty-text">Nog geen records</div></div>`;
  const mostNat=players.sort((a,b)=>b.nat-a.nat)[0];
  const mostPit=players.sort((a,b)=>(b.pit||0)-(a.pit||0))[0];
  const mostWins=players.sort((a,b)=>b.wins-a.wins)[0];
  const highScore=players.sort((a,b)=>b.highScore-a.highScore)[0];
  const bestWr=players.filter(p=>p.games>=2).sort((a,b)=>(b.wins/b.games)-(a.wins/a.games))[0];
  const records=[
    {icon:'🏆',label:'Meeste overwinningen',name:mostWins?.name,val:mostWins?.wins+'× gewonnen'},
    {icon:'⭐',label:'Hoogste score ooit',name:highScore?.name,val:highScore?.highScore+' punten'},
    {icon:'📈',label:'Beste winrate (min. 2 bomen)',name:bestWr?.name,val:bestWr?Math.round(bestWr.wins/bestWr.games*100)+'%':'—'},
    {icon:'💧',label:'Vaakst nat',name:mostNat?.name,val:mostNat?.nat+'× nat'},
    {icon:'💥',label:'Meeste pits',name:mostPit?.name,val:(mostPit?.pit||0)+'× pit'},
  ];
  return `<div class="card"><div class="card-label">🏅 Records</div>`+
    records.map(r=>`<div class="stat-row"><div><div style="font-size:13px;font-weight:600">${r.icon} ${r.label}</div><div style="font-size:11px;color:rgba(245,240,232,.4)">${r.name||'—'}</div></div><div style="font-weight:700;color:var(--gold)">${r.val||'—'}</div></div>`).join('')+
    `</div>`;
}

// ══════════════════════════════════════════
//  HOME
// ══════════════════════════════════════════
function renderHome(){
  const el=document.getElementById('recent-games-list');
  const recent=[...games].reverse().slice(0,5);
  if(!recent.length){el.innerHTML=`<div class="empty"><div class="empty-icon">🃏</div><div class="empty-text">Nog geen spellen gespeeld</div><div class="empty-sub">Druk op "Nieuw spel starten" om te beginnen</div></div>`;return}
  el.innerHTML=recent.map(g=>{
    const wn=g.wij.map(id=>getPlayer(id)?.name||'?').join(' & ');
    const zn=g.zij.map(id=>getPlayer(id)?.name||'?').join(' & ');
    const d=new Date(g.date).toLocaleDateString('nl-NL',{day:'numeric',month:'short'});
    const won=g.finalWij>g.finalZij,draw=g.finalWij===g.finalZij;
    return `<div class="game-tile" onclick="openGameDetail('${g.id}')">
      <div class="game-tile-header">
        <span class="game-date">${d} · ${g.rounds.length} rondes ${g.completed?'🌳':'🌿'}</span>
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
//  INIT
// ══════════════════════════════════════════
renderHome();
