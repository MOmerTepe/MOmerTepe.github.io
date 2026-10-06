import { BOARD, GROUPS } from './board.js';
import { createGame, applyAction, calculateRent } from './engine.js';
import { RoomSession } from './network.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
let lang = read('omt-lang', navigator.language.startsWith('tr') ? 'tr' : 'en');
let theme = read('omt-theme','system');
let state = null, session = null, local = false, selected = 1, busy = false, screen = 'home', noticeTimer, displayedTradeId = null;
let draftName = read('omt-player-name',''), draftCode = new URLSearchParams(location.hash.slice(1)).get('room') || '', localCount = 2;
let localNames = ['', '', '', '', '', ''];
const colors = ['#a75542','#447b76','#7d6aa0','#947a31','#576f9d','#9b5980'];
const t = (en,tr) => lang === 'tr' ? tr : en;
const cash = (value) => '₺' + Number(value || 0).toLocaleString('en-US');
const game = () => state && state.kind !== 'lobby';
const current = () => game() ? state.players[state.turn] : null;
const actor = () => local ? (state?.debt?.playerId || state?.auction?.bidderId || current()?.id) : session?.playerId;
const me = () => state?.players.find(p => p.id === actor());
const player = id => state?.players.find(p => p.id === id);
const name = id => player(id)?.name || t('Bank','Banka');
const canTurn = () => game() && actor() === current()?.id && !current()?.bankrupt;
const activeId = () => state?.debt?.playerId || state?.auction?.bidderId || current()?.id;
const button = (label, action, cls='', disabled=false, extra='') => `<button class="button ${cls}" data-action="${action}" ${disabled || busy ? 'disabled' : ''} ${extra}>${label}</button>`;
const panel = (title, body, extra='') => `<section class="panel"><div class="panel-title"><h2>${title}</h2>${extra}</div>${body}</section>`;
const token = (p,active=false) => `<span class="token ${active ? 'current' : ''}" style="--token:${esc(p.color)}" title="${esc(p.name)}">${state?.players.indexOf(p)+1 || '·'}</span>`;
const copy = {home:['home','ana sayfa'],projects:['projects','projeler'],resume:['resume','özgeçmiş'],play:['play','oyna'],howTo:['how to play ↗','nasıl oynanır ↗'],table:['ISTANBUL / THE TABLE','İSTANBUL / OYUN MASASI'],boardHint:['Select a space to inspect its deed.','Tapuyu incelemek için bir kare seç.'],footer:['A property game, made for friends.','Arkadaşlar için bir emlak oyunu.']};
const rules = () => `<p>${t('Buy your way around Istanbul. Collect districts, build on complete color sets, and be the last player with money on the table.','İstanbul sokaklarında mülk al. Aynı renkteki semtleri topla, binalar inşa et ve masada kalan son oyuncu ol.')}</p><ol class="rules-list">
<li>${t('Everyone starts with ₺1,500. Roll two dice; collect ₺200 every time you pass Start. Doubles give another roll. Three doubles in one turn send you to jail.','Herkes ₺1.500 ile başlar. İki zar at; Başlangıç’tan her geçişte ₺200 al. Çift zar tekrar oynatır. Bir turda üç çift zar hapse gönderir.')}</li>
<li>${t('Buy an unowned property or send it to auction. Everyone can bid, including the player who declined it. Once you pass, you leave that auction.','Sahipsiz mülkü satın al veya açık artırmaya çıkar. Almayı reddeden oyuncu dahil herkes teklif verebilir. Pas geçen oyuncu o artırmaya geri dönemez.')}</li>
<li>${t('Pay rent to the owner when you land on their property. A complete color set doubles the base rent. Build evenly across a set: four houses, then a hotel.','Başkasının mülküne gelirsen kira ödersin. Tam renk grubu temel kirayı ikiye katlar. Gruba eşit şekilde inşa et: dört ev, ardından otel.')}</li>
<li>${t('Select a deed to build, sell buildings, mortgage, or lift a mortgage on your turn. Sell buildings before mortgaging a color set. Mortgaged properties earn no rent.','Sıra sendeyken tapuyu seçerek bina yap, bina sat, ipotek koy veya kaldır. Bir renk grubunu ipotek etmeden önce binalarını sat. İpotekli mülk kira kazandırmaz.')}</li>
<li>${t('Trade cash and properties with another player on your turn. They must accept the exact offer. Properties in a developed color set cannot be traded.','Sıra sendeyken diğer oyunculara para ve mülk takası öner. Karşı taraf teklifi kabul etmelidir. Binalı renk grubundaki mülkler takas edilemez.')}</li>
<li>${t('In jail, pay ₺50 before rolling or try for doubles. On the third failed attempt you must pay. If you owe more than you have, sell buildings or mortgage properties; otherwise declare bankruptcy.','Hapiste, zar atmadan ₺50 öde veya çift zar dene. Üçüncü başarısız denemede ödeme zorunludur. Borcunu ödeyemiyorsan bina sat, mülk ipotek et veya iflas et.')}</li>
</ol><p class="small-muted">${t('Tea Break pays nothing. The bank has 32 houses and 12 hotels. Money is fictional. This is an independent property-trading game.','Çay Molası ödeme yapmaz. Bankada 32 ev ve 12 otel vardır. Para hayalidir. Bu bağımsız bir emlak oyunudur.')}</p><p class="small-muted">${t('Online: 2–6 players. Share your room link only with friends. The host keeps the game open; refreshing or closing their tab ends the room. Guests can rejoin from the same browser tab. Connections use PeerJS’s shared signaling and relay services; some networks may block them. No account is needed.','Çevrimiçi: 2–6 oyuncu. Oda bağlantısını arkadaşlarınla paylaş. Oda sahibi sekmeyi açık tutmalı; yeniler veya kapatırsa oda sona erer. Misafirler aynı tarayıcı sekmesinden tekrar katılabilir. Bağlantılar PeerJS sinyalleşme ve aktarım hizmetlerini kullanır; bazı ağlar bunları engelleyebilir. Hesap gerekmez.')}</p>`;

function applyPreferences() {
  document.documentElement.lang = lang;
  document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
  document.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('active',b.dataset.lang === lang));
  document.querySelectorAll('[data-theme]').forEach(b => { b.classList.toggle('active',b.dataset.theme === theme); b.textContent = ({system:t('system','sistem'),light:t('light','açık'),dark:t('dark','koyu')})[b.dataset.theme]; });
  document.querySelectorAll('[data-copy]').forEach(el => el.textContent = t(...copy[el.dataset.copy]));
}
function notice(message) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').hidden = false; noticeTimer = setTimeout(() => $('notice').hidden = true,6500); }
function openModal(title,content) { displayedTradeId=null; $('modal-title').textContent=title; $('modal-content').innerHTML=content; if (!$('modal').open) $('modal').showModal(); }
function propertyState(index) { return state?.properties?.[index] || {owner:null,houses:0,mortgaged:false}; }
function buildBoard() {
  const icons = {go:'↗',jail:'▥',parking:'P',goToJail:'→',chance:'?',community:'◇',tax:'−',railroad:'↔',utility:'⌁'};
  for (const square of BOARD) {
    const i=square.index;
    let row,col;
    if(i<=10){row=11;col=11-i;} else if(i<=20){row=21-i;col=1;} else if(i<=30){row=1;col=i-19;} else{row=i-29;col=11;}
    const el=document.createElement('button');
    el.className='space'+(i%10===0?' corner':''); el.dataset.space=i;
    el.style.gridRow=row;el.style.gridColumn=col;el.style.setProperty('--group',square.color || 'var(--line)');
    el.setAttribute('aria-label',`${i}. ${square.name}${square.price ? ', '+cash(square.price) : ''}`);
    el.title=`${i}. ${square.name}`;
    const shortName=square.type==='chance'?'Chance':square.type==='jail'?'Jail / Visiting':square.name;
    el.innerHTML=`${icons[square.type] ? `<span class="space-icon" aria-hidden="true">${icons[square.type]}</span>` : `<span class="mobile-only" aria-hidden="true">${String(i).padStart(2,'0')}</span>`}<span class="space-name">${esc(shortName)}</span><span class="tokens"></span><span class="space-price">${square.price ? cash(square.price) : i===0 ? '+₺200' : ''}</span><span class="building-marks"></span>`;
    $('board').appendChild(el);
  }
}
function renderBoard() {
  for (const square of BOARD) {
    const el=document.querySelector(`[data-space="${square.index}"]`), prop=propertyState(square.index);
    el.classList.toggle('selected',selected===square.index); el.classList.toggle('owner',Boolean(prop.owner)); el.classList.toggle('mortgaged',prop.mortgaged);
    el.setAttribute('aria-pressed',String(selected===square.index)); el.style.setProperty('--owner',player(prop.owner)?.color || 'transparent');
    el.querySelector('.tokens').innerHTML = game() ? state.players.filter(p=>p.position===square.index&&!p.bankrupt).map(p=>token(p,p.id===current()?.id)).join('') : '';
    el.querySelector('.building-marks').textContent=prop.houses===5?'H':prop.houses ? '▪'.repeat(prop.houses):'';
  }
}
function landing() {
  if (screen==='local') return `<div class="center-content"><div class="brand-mark">${t('PASS & PLAY','AYNI EKRANDA')}</div><h2 class="turn-title">${t('Gather around.','Bir araya gelin.')}</h2><p class="turn-detail">${t('Take turns on this device.','Bu cihazda sırayla oynayın.')}</p><form id="local-form"><label class="field">${t('Players','Oyuncular')}<select id="local-count">${[2,3,4,5,6].map(n=>`<option ${n===localCount?'selected':''}>${n}</option>`).join('')}</select></label><div class="local-players">${Array.from({length:localCount},(_,i)=>`<label class="field">${t('Player','Oyuncu')} ${i+1}<input data-local-name="${i}" maxlength="24" value="${esc(localNames[i])}" placeholder="${t('Player','Oyuncu')} ${i+1}"></label>`).join('')}</div><div class="button-row">${button(t('Back','Geri'),'home') }<button class="button primary" type="submit">${t('Start game →','Oyuna başla →')}</button></div></form></div>`;
  return `<div class="center-content"><div class="brand-mark">EST. 2026 / 2–6 ${t('PLAYERS','OYUNCU')}</div><h2 class="game-title"><span>Istanbul</span><span>Exchange.</span></h2><p class="intro">${t('A city to share. A fortune to make.','Paylaşılacak bir şehir. Kurulacak bir servet.')}</p><form id="online-form" class="setup-form"><label class="field">${t('Your name','Adın')}<input id="player-name" autocomplete="nickname" maxlength="24" placeholder="${t('What should we call you?','Sana ne diyelim?')}" value="${esc(draftName)}" required></label>${screen==='join' ? `<label class="field">${t('Room code','Oda kodu')}<input id="room-code" maxlength="12" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX" value="${esc(draftCode)}" required></label><div class="button-row">${button(t('Back','Geri'),'home')}<button class="button primary" type="submit" ${busy?'disabled':''}>${busy?t('Connecting…','Bağlanıyor…'):t('Join room →','Odaya katıl →')}</button></div>` : `<button class="button primary wide" type="submit" ${busy?'disabled':''}>${busy?t('Creating room…','Oda açılıyor…'):t('Create a room →','Oda oluştur →')}</button><div class="button-row">${button(t('Join with a code','Kod ile katıl'),'join','wide')}</div>`}</form>${button(t('or play on this device','veya bu cihazda oyna'),'local','text-button local-link')}<p class="fine-print">${t('No accounts. Bring your friends.','Hesap gerekmez. Arkadaşlarını çağır.')}</p></div>`;
}
function diceHtml() {
  const pips={1:[5],2:[1,9],3:[1,5,9],4:[1,3,7,9],5:[1,3,5,7,9],6:[1,3,4,6,7,9]};
  return `<div class="dice" aria-label="${state.dice?.every(n=>n>0)?t('Dice','Zarlar')+': '+state.dice.join(', '):t('Ready to roll','Zar atmaya hazır')}">${(state.dice?.every(n=>n>0)?state.dice:[1,1]).map(n=>`<div class="die" aria-hidden="true">${pips[n].map(p=>`<span class="pip" style="grid-row:${Math.ceil(p/3)};grid-column:${(p-1)%3+1}"></span>`).join('')}</div>`).join('')}</div>`;
}
function renderCenter() {
  let html;
  if(!state) html=landing();
  else if(state.kind==='lobby') html=`<div class="center-content"><div class="brand-mark">${t('YOUR TABLE','OYUN MASAN')}</div><h2 class="game-title"><span>Istanbul</span><span>Exchange.</span></h2><div class="room-code-center">${esc(session.roomCode)}</div><p class="lobby-names">${state.players.map(p=>esc(p.name)).join(' · ')}</p><p class="turn-detail">${t('Share the room link with your friends.','Oda bağlantısını arkadaşlarınla paylaş.')}</p>${button(t('Copy invite link ↗','Davet bağlantısını kopyala ↗'),'copy','wide')}<div class="button-row">${session.isHost ? button(t('Start game →','Oyuna başla →'),'start','primary wide',state.players.filter(p=>p.connected).length<2) : `<p class="small-muted">${t('Waiting for the host to start.','Oda sahibinin başlatması bekleniyor.')}</p>`}</div><p class="fine-print">${t('The host keeps this tab open during play.','Oda sahibi oyun boyunca bu sekmeyi açık tutmalı.')}</p></div>`;
  else {
    const p=current(), mine=canTurn(), who=player(activeId()), myAction=actor()===activeId();
    let title=mine?t('Your move.','Sıra sende.'):t(`${p.name}’s move.`,`${p.name} oynuyor.`), detail='',controls='',dice=true;
    if(local) title=t(`${p.name}’s move.`,`${p.name} oynuyor.`);
    if(state.phase==='roll'){
      detail=p.inJail?t('In jail. Roll doubles to get out, or pay ₺50 before rolling.','Hapistesin. Çift zar at veya atmadan önce ₺50 öde.'):state.extraRoll?t('Doubles. Take another roll.','Çift zar. Bir kez daha at.'):t('The next district is a roll away.','Sıradaki semt bir zar uzağında.');
      controls=button(t('Roll dice →','Zar at →'),'ROLL','primary wide',!mine);
      if(p.inJail) controls+=`<div class="button-row">${button(p.jailCards?t('Use release card','Çıkış kartı kullan'):t('Pay ₺50 bail','₺50 kefalet öde'),'PAY_BAIL','',!mine)}</div>`;
    } else if(state.phase==='purchase'){
      const square=BOARD[state.pending.property]; title=square.name;detail=t(`Unowned. The asking price is ${cash(square.price)}.`,`Sahipsiz. Satış fiyatı ${cash(square.price)}.`);dice=false;
      controls=button(t(`Buy for ${cash(square.price)}`,`${cash(square.price)} öde ve al`),'BUY','primary wide',!mine||p.cash<square.price)+`<div class="button-row">${button(t('Send to auction','Açık artırmaya çıkar'),'AUCTION','wide',!mine)}</div>`;
    } else if(state.phase==='auction'){
      const a=state.auction;title=BOARD[a.property].name;dice=false;
      detail=t(`${name(a.bidderId)} to bid. Highest: ${cash(a.highestBid)}${a.highestBidder?' · '+name(a.highestBidder):''}.`,`${name(a.bidderId)} teklif veriyor. En yüksek: ${cash(a.highestBid)}${a.highestBidder?' · '+name(a.highestBidder):''}.`);
      controls=`<form id="bid-form"><label class="field">${t('Your bid','Teklifin')}<input id="bid-amount" type="number" inputmode="numeric" min="${a.highestBid+1}" max="${who?.cash||0}" value="${a.highestBid+10}" ${myAction?'':'disabled'} required></label><div class="button-row"><button class="button primary" ${!myAction||busy?'disabled':''}>${t('Place bid','Teklif ver')}</button>${button(t('Pass','Pas'),'PASS','',!myAction)}</div></form>`;
    } else if(state.phase==='debt'){
      title=t(`${name(state.debt.playerId)} owes ${cash(state.debt.amount)}.`,`${name(state.debt.playerId)}: ${cash(state.debt.amount)} borç.`);dice=false;
      detail=t('Raise cash by selling buildings or mortgaging your deeds. The debt clears automatically when you have enough.','Bina sat veya mülklerini ipotek et. Yeterli paran olduğunda borç otomatik ödenir.');
      controls=button(t('Declare bankruptcy','İflas et'),'bankrupt-confirm','danger wide',!myAction);
    } else if(state.phase==='finished'){
      title=t(`${name(state.winner)} wins.`,`${name(state.winner)} kazandı.`);detail=t('Istanbul has a new landlord. Well played.','İstanbul’un yeni bir sahibi var. İyi oyundu.');dice=false;controls=button(t('Back to the table','Masaya dön'),'leave','primary wide');
    } else {
      detail=t('Manage your deeds or propose a trade before passing the dice.','Zarları devretmeden önce mülklerini yönet veya takas öner.');
      controls=button(t('End turn →','Sırayı devret →'),'END_TURN','primary wide',!mine);
    }
    if(state.trade){title=t('A deal on the table.','Masada bir teklif var.');detail=t(`${name(state.trade.fromId)} has made an offer to ${name(state.trade.toId)}. Resolve it before continuing.`,`${name(state.trade.fromId)}, ${name(state.trade.toId)} için teklif verdi. Devam etmek için sonuçlandırın.`);controls=button(t('Review trade →','Takası incele →'),'review-trade','primary wide');dice=false;}
    html=`<div class="center-content"><div class="center-label">${state.phase==='finished'?'ISTANBUL EXCHANGE':t('ISTANBUL EXCHANGE / ','ISTANBUL EXCHANGE / ')+esc(local?t('LOCAL TABLE','YEREL OYUN'):session?.roomCode||'')}</div><h2 class="turn-title">${esc(title)}</h2>${dice?diceHtml():`<div class="center-rule"></div>`}<p class="turn-detail">${esc(detail)}</p><div class="setup-form">${controls}</div>${state.phase!=='finished'?`<p class="center-balance">${esc(who?.name || p.name)} · ${cash(who?.cash ?? p.cash)}</p>`:''}${local?`<p class="fine-print">${t('Pass this device to the player whose turn it is.','Cihazı sırası gelen oyuncuya ver.')}</p>`:''}</div>`;
  }
  $('board-center').innerHTML=html;
}
function renderRoom() {
  if(!state){
    $('room-panel').innerHTML=panel(t('The game','Oyun'),`<p>${t('Buy districts. Collect rent. Build your corner of the city.','Semtler al. Kira topla. Şehrin bir köşesini kur.')}</p><div class="data-row"><span>${t('At the table','Masada')}</span><strong>2–6 ${t('players','oyuncu')}</strong></div><div class="data-row"><span>${t('Starting cash','Başlangıç')}</span><strong>₺1,500</strong></div><div class="data-row"><span>${t('The objective','Hedef')}</span><strong>${t('Last one standing','Son kalan kazanır')}</strong></div>`);
    $('players-panel').innerHTML=panel(t('How to begin','Nasıl başlanır'),`<p>${t('Create a room and send the link to friends. Once everyone joins, the host starts the game.','Oda oluştur ve bağlantıyı arkadaşlarına gönder. Herkes katıldığında oda sahibi oyunu başlatır.')}</p><p class="small-muted">${t('Host stays online. No sign-up.','Oda sahibi çevrimiçi kalır. Kayıt gerekmez.')}</p>`);return;
  }
  $('room-panel').innerHTML=panel(local?t('Local table','Yerel oyun'):t('Private room','Özel oda'),`${local?`<p>${t('One device. Everyone at the table.','Tek cihaz. Herkes aynı masada.')}</p>`:`<div class="large-code">${esc(session.roomCode)}</div><p class="small-muted">${session.isHost?t('You are hosting. Keep this tab open.','Oda sahibisin. Sekmeyi açık tut.'):t('Connected to the host’s table.','Oda sahibinin masasına bağlısın.')}</p>${button(t('Copy invite link','Davet bağlantısını kopyala'),'copy','small wide')}`}<div class="button-row">${button(t('Leave table','Masadan ayrıl'),'leave-confirm','small')}</div>`);
  const roster=session?.players||[];
  $('players-panel').innerHTML=panel(t('Players','Oyuncular'),state.players.map(p=>{
    const connected=local||roster.find(r=>r.id===p.id)?.connected!==false;
    return `<div class="player-row ${game()&&activeId()===p.id?'active':''} ${p.bankrupt?'out':''}">${token(p)}<div><div class="player-name">${esc(p.name)}${!local&&p.id===session.playerId?' · '+t('you','sen'):''}</div><div class="player-meta">${p.bankrupt?t('BANKRUPT','İFLAS'):!connected?t('RECONNECTING','YENİDEN BAĞLANIYOR'):game()?(p.inJail?t('IN JAIL','HAPİSTE'):esc(BOARD[p.position]?.name)):t('AT THE TABLE','MASADA')}</div></div><span class="player-cash">${game()?cash(p.cash):'✓'}</span>${!game()&&session?.isHost&&!connected?button(t('Remove','Çıkar'),'kick','small',false,`data-player="${esc(p.id)}"`):''}</div>`;
  }).join(''),`<span class="small-muted">${state.players.filter(p=>!p.bankrupt).length}/6</span>`);
}
function renderProperty() {
  const square=BOARD[selected],prop=propertyState(selected);
  if(!square) return;
  let content=`${square.color?`<div class="deed-band" style="--group:${esc(square.color)}"></div>`:''}<div class="property-title">${esc(square.name)}</div>`;
  if(square.price){
    content+=`<div class="data-row"><span>${t('Deed value','Tapu değeri')}</span><strong>${cash(square.price)}</strong></div><div class="data-row"><span>${t('Owner','Sahibi')}</span><strong>${prop.owner?esc(name(prop.owner)):t('Unowned','Sahipsiz')}</strong></div>`;
    if(prop.mortgaged)content+=`<p class="small-muted">${t('MORTGAGED · No rent due','İPOTEKLİ · Kira alınmaz')}</p>`;
    if(square.rents)content+=`<table class="rent-table" aria-label="${t('Rent schedule','Kira tablosu')}"><tbody>${square.rents.map((r,i)=>`<tr><td>${square.type==='railroad'?t(`${i+1} station${i?'s':''}`,`${i+1} istasyon`):i===0?t('Base rent','Temel kira'):i===5?t('Hotel','Otel'):t(`${i} house${i>1?'s':''}`,`${i} ev`)}</td><td>${cash(r)}</td></tr>`).join('')}</tbody></table>`;
    else content+=`<p>${square.type==='utility'?t('One utility: 4× the dice. Both utilities: 10×.','Bir hizmet: zarın 4 katı. İkisi: 10 katı.'):t('Rent: ₺25 / ₺50 / ₺100 / ₺200 for 1 / 2 / 3 / 4 stations.','1 / 2 / 3 / 4 istasyon için kira: ₺25 / ₺50 / ₺100 / ₺200.')}</p>`;
    if(square.buildCost)content+=`<div class="data-row"><span>${t('Build cost','İnşaat')}</span><strong>${cash(square.buildCost)}</strong></div>`;
    content+=`<div class="data-row"><span>${prop.mortgaged?t('Lift mortgage','İpoteği kaldır'):t('Mortgage value','İpotek değeri')}</span><strong>${cash(prop.mortgaged?Math.ceil(square.price*55/100):Math.floor(square.price/2))}</strong></div>`;
    if(game()&&prop.owner)content+=`<div class="data-row"><span>${t('Current rent','Güncel kira')}</span><strong>${square.type==='utility'?t('By dice roll','Zara göre'):cash(calculateRent(state,selected))}</strong></div>`;
    if(game()&&prop.owner===actor()&&state.phase!=='finished'){
      const can=!state.trade&&((canTurn()&&['roll','end'].includes(state.phase))||(state.phase==='debt'&&state.debt.playerId===actor()));
      const group=GROUPS[square.group]?.spaces || [selected],complete=group.every(i=>propertyState(i).owner===actor()),groupBuilt=group.some(i=>propertyState(i).houses>0);
      const buildable=complete&&group.every(i=>!propertyState(i).mortgaged)&&prop.houses===Math.min(...group.map(i=>propertyState(i).houses))&&(me()?.cash>=square.buildCost)&&(prop.houses<4?state.bank.houses>0:state.bank.hotels>0);
      content+=`<div class="button-row">${square.buildCost?button(t('Build +','İnşa et +'),'BUILD','small',!can||!buildable||state.phase==='debt'||prop.houses>=5,`data-property="${selected}"`):''}${prop.houses?button(t('Sell building','Bina sat'),'SELL_BUILDING','small',!can||(prop.houses===5&&state.bank.houses<4),`data-property="${selected}"`):''}</div><div class="button-row">${button(prop.mortgaged?t('Lift mortgage','İpoteği kaldır'):t('Mortgage','İpotek et'),prop.mortgaged?'UNMORTGAGE':'MORTGAGE','small wide',!can||groupBuilt||(prop.mortgaged&&state.phase==='debt'),`data-property="${selected}"`)}</div>`;
      if(complete&&groupBuilt)content+=button(t('Sell all group buildings','Gruptaki tüm binaları sat'),'sell-group-confirm','small wide',!can,`data-property="${selected}"`);
      if(square.buildCost&&!complete)content+=`<p class="small-muted">${t('Own the complete color set to build.','İnşa etmek için renk grubunu tamamla.')}</p>`;
      if(square.buildCost)content+=`<p class="small-muted">${t(`Bank: ${state.bank.houses} houses · ${state.bank.hotels} hotels`,`Banka: ${state.bank.houses} ev · ${state.bank.hotels} otel`)}</p>`;
    }
  } else {
    const info={go:t('Collect ₺200 when you pass this square.','Bu kareden geçerken ₺200 al.'),jail:t('Just visiting? Nothing to pay. In jail? Roll doubles or pay ₺50.','Ziyaretçiysen ödeme yok. Hapisteysen çift zar at veya ₺50 öde.'),parking:t('Take a breather. No fees, no jackpot.','Bir nefes al. Ücret veya ödül yok.'),goToJail:t('Go directly to jail without collecting a salary.','Başlangıç parası almadan doğrudan hapse git.'),chance:t('Draw a city event. Your fortune may turn.','Bir şehir olayı çek. Talihin değişebilir.'),community:t('A little news from the neighborhood.','Mahalleden küçük bir haber.'),tax:t(`Pay ${cash(square.amount)} to the bank.`, `Bankaya ${cash(square.amount)} öde.`)};
    content+=`<p>${info[square.type]||t('Land here to resolve a city event.','Bir şehir olayını çözmek için buraya gel.')}</p>`;
  }
  $('property-panel').innerHTML=panel(t('Deed inspector','Tapu detayı'),content,`<span class="small-muted">${String(selected).padStart(2,'0')} / 39</span>`);
}
function renderPortfolio() {
  if(!game()){ $('portfolio-panel').innerHTML=''; $('activity-panel').innerHTML=''; return; }
  const p=me(),owned=BOARD.filter(s=>propertyState(s.index).owner===p?.id);
  let body=p?`<div class="portfolio-list">${owned.map(s=>`<button class="property-chip" style="--group:${esc(s.color||'var(--muted)')}" data-inspect="${s.index}">${esc(s.name)}${propertyState(s.index).mortgaged?' · M':''}</button>`).join('')||`<p>${t('Your first deed is still out there.','İlk tapun seni bekliyor.')}</p>`}</div>${button(t('Propose a trade ↗','Takas öner ↗'),'trade','small wide',!canTurn()||!['roll','end','debt'].includes(state.phase)||!!state.trade)}`:'';
  if(state.trade){const trade=state.trade; body+=`<div class="trade-offer"><p>${esc(name(trade.fromId))} → ${esc(name(trade.toId))}</p>${button(t('Review trade','Takası incele'),'review-trade','small wide')}</div>`;}
  $('portfolio-panel').innerHTML=panel(t('Your portfolio','Mülklerin'),body,`<span class="small-muted">${owned.length} ${t('deeds','tapu')}</span>`);
  $('activity-panel').innerHTML=panel(t('Table log','Oyun günlüğü'),`<ol class="activity-list">${[...state.log].reverse().slice(0,20).map(e=>`<li>${esc(e.text)}</li>`).join('')}</ol>`);
}
function render() { if(displayedTradeId && state?.trade?.id!==displayedTradeId){$('modal').close();displayedTradeId=null;}applyPreferences();renderBoard();renderCenter();renderRoom();renderProperty();renderPortfolio();if(local)$('connection').textContent=t('● Local table · pass & play','● Yerel oyun · aynı cihaz');else if(!state&&!busy)$('connection').textContent=t('2–6 players · online or local','2–6 oyuncu · çevrimiçi veya yerel'); }
async function act(action, actorOverride) {
  if(busy)return false;
  busy=true;
  try {
    if(action.type==='ROLL') { $('board-center').classList.add('rolling'); await new Promise(r=>setTimeout(r,420)); }
    if(local) state=applyAction(state,actorOverride||actor(),action,secureRandom);
    else await session.dispatch(action);
    if(['ROLL','BUY','AUCTION'].includes(action.type))selected=state.pending?.property ?? state.auction?.property ?? current()?.position ?? selected;
    return true;
  } catch(error) {notice(error.message);return false;}
  finally{busy=false;$('board-center').classList.remove('rolling');render();}
}
function secureRandom(){const b=new Uint32Array(1);crypto.getRandomValues(b);return b[0]/4294967296;}
async function connect() {
  if(busy)return;
  draftName=$('player-name').value.trim();if(!draftName){$('player-name').focus();return;}
  draftCode=$('room-code')?.value||draftCode;save('omt-player-name',draftName);busy=true;render();
  const next=new RoomSession({
    onState(nextState){state=nextState;render();},
    onStatus(status){
      $('connection').textContent=status.message;
      if(status.kind==='disconnected'&&!status.roomCode){state=null;session=null;busy=false;screen='home';history.replaceState(null,'',location.pathname);$('modal').close();render();notice(status.message);}
      else if(state){renderRoom();}
    },
    onError(message){notice(message);}
  });
  session=next;local=false;
  try{if(screen==='join')await next.join(draftCode,draftName);else await next.host(draftName);history.replaceState(null,'',`${location.pathname}#room=${encodeURIComponent(next.roomCode)}`);}
  catch(error){next.leave();session=null;state=null;notice(error.message);}
  finally{busy=false;render();}
}
async function copyInvite(){
  const url=`${location.origin}${location.pathname}#room=${encodeURIComponent(session.roomCode)}`;
  try{await navigator.clipboard.writeText(url);notice(t('Invite link copied. Send it to your friends.','Davet bağlantısı kopyalandı. Arkadaşlarına gönder.'));}
  catch{openModal(t('Invite friends','Arkadaşlarını davet et'),`<label class="field">${t('Copy this link','Bu bağlantıyı kopyala')}<input readonly value="${esc(url)}"></label>`);}
}
function leave(){session?.leave();session=null;state=null;local=false;busy=false;screen='home';history.replaceState(null,'',location.pathname);$('modal').close();render();}
function showTrade(){
  const p=me(),others=state.players.filter(x=>!x.bankrupt&&x.id!==p.id);
  openModal(t('Propose a trade','Takas öner'),`<form id="trade-form"><label class="field">${t('Trade with','Takas yapılacak oyuncu')}<select id="trade-target">${others.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label><div class="trade-columns"><div><h3>${t('You give','Vereceğin')}</h3><label class="field">${t('Cash','Para')}<input id="give-cash" type="number" min="0" max="${p.cash}" value="0" required></label><div id="give-deeds">${tradeChecks(p.id,'give')}</div></div><div><h3>${t('You receive','Alacağın')}</h3><label class="field">${t('Cash','Para')}<input id="receive-cash" type="number" min="0" value="0" required></label><div id="receive-deeds">${tradeChecks(others[0].id,'receive')}</div></div></div><p class="small-muted">${t('The other player must approve your offer. Sell all buildings in a color set before trading its deeds.','Diğer oyuncu teklifini onaylamalı. Bir gruptaki tapuyu takas etmeden önce grubun tüm binalarını sat.')}</p><button class="button primary wide">${t('Send offer →','Teklifi gönder →')}</button></form>`);
}
function tradeChecks(id,kind){return BOARD.filter(s=>propertyState(s.index).owner===id).map(s=>`<label class="trade-check"><input type="checkbox" name="${kind}" value="${s.index}"> ${esc(s.name)}${propertyState(s.index).mortgaged?' (M)':''}</label>`).join('')||`<p class="small-muted">${t('No deeds yet.','Henüz tapu yok.')}</p>`;}
function reviewTrade(){
  const o=state.trade;if(!o)return;
  const assets=(amount,props)=>`${cash(amount)}${props.length?' + '+props.map(i=>esc(BOARD[i].name)).join(', '):''}`;
  const canAccept=local||actor()===o.toId,canCancel=local||actor()===o.fromId;
  const identity=`data-trade="${esc(o.id)}"`;
  openModal(t('Trade offer','Takas teklifi'),`<p><strong>${esc(name(o.fromId))}</strong> → <strong>${esc(name(o.toId))}</strong></p><div class="trade-summary">${esc(name(o.fromId))} ${t('gives','verir')}:<br>${assets(o.giveCash,o.giveProperties)}</div><div class="trade-summary">${esc(name(o.toId))} ${t('gives','verir')}:<br>${assets(o.receiveCash,o.receiveProperties)}</div>${local?`<p>${t('Pass the device to','Cihazı şu oyuncuya ver')}: <strong>${esc(name(o.toId))}</strong></p>`:''}<div class="button-row">${canAccept?button(t('Accept trade','Takası kabul et'),'ACCEPT_TRADE','primary',false,identity)+button(t('Decline','Reddet'),'REJECT_TRADE','',false,identity):''}${canCancel?button(t('Withdraw','Geri çek'),'CANCEL_TRADE','',false,identity):''}</div>`);
  displayedTradeId=o.id;
}
document.addEventListener('click',async e=>{
  const pref=e.target.closest('[data-theme],[data-lang]');if(pref){if(pref.dataset.theme){theme=pref.dataset.theme;save('omt-theme',theme);}else{lang=pref.dataset.lang;save('omt-lang',lang);}render();return;}
  const space=e.target.closest('[data-space],[data-inspect]');if(space){selected=Number(space.dataset.space??space.dataset.inspect);renderBoard();renderProperty();return;}
  const b=e.target.closest('[data-action]');if(!b||b.disabled)return;e.preventDefault();const a=b.dataset.action;
  if(['home','join','local'].includes(a)){screen=a;renderCenter();return;}
  if(a==='copy'){await copyInvite();return;}
  if(a==='start'){try{await session.startGame();}catch(err){notice(err.message);}return;}
  if(a==='kick'){try{session.kick(b.dataset.player);}catch(err){notice(err.message);}return;}
  if(a==='leave-confirm'){openModal(t('Leave the table?','Masadan ayrıl?'),`<p>${session?.isHost?t('You are the host. Leaving will end this room for everyone.','Oda sahibisin. Ayrılınca oda herkes için kapanır.'):t('Your current game will close on this device.','Bu cihazdaki oyundan ayrılacaksın.')}</p>${button(t('Leave table','Masadan ayrıl'),'leave','danger wide')}`);return;}
  if(a==='leave'){leave();return;}
  if(a==='bankrupt-confirm'){openModal(t('Declare bankruptcy?','İflas et?'),`<p>${t('You will leave this game and your assets will settle your debt. Sell buildings or mortgage deeds first if you want to keep playing.','Bu oyundan elenirsin; varlıkların borcuna karşılık kullanılır. Devam etmek için önce bina satabilir veya ipotek yapabilirsin.')}</p>${button(t('Declare bankruptcy','İflas et'),'BANKRUPT','danger wide')}`);return;}
  if(a==='trade'){showTrade();return;}if(a==='review-trade'){reviewTrade();return;}
  if(a==='sell-group-confirm'){const i=Number(b.dataset.property),group=GROUPS[BOARD[i].group].spaces,total=group.reduce((sum,x)=>sum+propertyState(x).houses*BOARD[x].buildCost/2,0);openModal(t('Sell every building in this group?','Bu gruptaki tüm binalar satılsın mı?'),`<p>${group.map(x=>esc(BOARD[x].name)).join(', ')}.</p><p>${t(`The bank pays you ${cash(total)}. You keep the deeds; their rents return to the undeveloped rate.`,`Banka sana ${cash(total)} öder. Tapular sende kalır; kiralar binasız tutara döner.`)}</p>${button(t(`Sell buildings for ${cash(total)}`,`Binaları ${cash(total)} karşılığı sat`),'SELL_GROUP','wide',false,`data-property="${i}"`)}`);return;}
  const action={type:a};if(b.dataset.property)action.property=Number(b.dataset.property);if(b.dataset.trade)action.tradeId=b.dataset.trade;
  const override=local&&['ACCEPT_TRADE','REJECT_TRADE'].includes(a)?state.trade.toId:undefined;
  if(await act(action,override))if(['ACCEPT_TRADE','REJECT_TRADE','CANCEL_TRADE','BANKRUPT','SELL_GROUP'].includes(a))$('modal').close();
});
document.addEventListener('submit',async e=>{
  e.preventDefault();
  if(e.target.id==='online-form'){await connect();}
  if(e.target.id==='local-form'){local=true;session=null;state=createGame(Array.from({length:localCount},(_,i)=>({id:`local-${i}`,name:localNames[i].trim()||t(`Player ${i+1}`,`Oyuncu ${i+1}`),color:colors[i]})));render();}
  if(e.target.id==='bid-form')await act({type:'BID',amount:Number($('bid-amount').value)});
  if(e.target.id==='trade-form'){const action={type:'OFFER_TRADE',targetId:$('trade-target').value,giveCash:Number($('give-cash').value),receiveCash:Number($('receive-cash').value),giveProperties:[...e.target.querySelectorAll('[name="give"]:checked')].map(x=>Number(x.value)),receiveProperties:[...e.target.querySelectorAll('[name="receive"]:checked')].map(x=>Number(x.value))};if(await act(action))$('modal').close();}
});
document.addEventListener('input',e=>{if(e.target.id==='player-name')draftName=e.target.value;if(e.target.id==='room-code')draftCode=e.target.value;if(e.target.dataset.localName!==undefined)localNames[Number(e.target.dataset.localName)]=e.target.value;});
document.addEventListener('change',e=>{if(e.target.id==='local-count'){localCount=Number(e.target.value);renderCenter();}if(e.target.id==='trade-target')$('receive-deeds').innerHTML=tradeChecks(e.target.value,'receive');});
$('rules-button').addEventListener('click',()=>openModal(t('How to play','Nasıl oynanır'),rules()));
$('close-modal').addEventListener('click',()=>$('modal').close());
$('modal').addEventListener('click',e=>{if(e.target===$('modal')){const r=$('modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('modal').close();}});
window.addEventListener('beforeunload',e=>{if(game()&&state.phase!=='finished'){e.preventDefault();e.returnValue='';}});
if(draftCode)screen='join';buildBoard();render();
