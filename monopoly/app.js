import { BOARD, GROUPS } from './board.js?v=20261006-4';
import { createGame, applyAction, calculateRent } from './engine.js?v=20261006-4';
import { RoomSession } from './network.js?v=20261006-4';
import { DEFAULT_RULES, RULE_PRESETS, normalizeRules } from './rules.js?v=20261006-4';
import { TOKEN_OPTIONS, PLAYER_COLORS, sanitizeProfile } from './cosmetics.js?v=20261006-4';
import { pawnIcon, buildingIcons, GameEffects } from './graphics.js?v=20261006-4';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
let lang = read('omt-lang', navigator.language.startsWith('tr') ? 'tr' : 'en');
let theme = read('omt-theme','system');
let state = null, session = null, local = false, selected = 1, busy = false, screen = 'home', noticeTimer, displayedTradeId = null;
let draftName = read('omt-player-name',''), draftCode = new URLSearchParams(location.hash.slice(1)).get('room') || '', localCount = 2;
let localNames = ['', '', '', '', '', ''];
const colors = PLAYER_COLORS;
let profile=sanitizeProfile({token:read('omt-pawn','ferry'),color:read('omt-pawn-color',colors[0])});
let localProfiles=TOKEN_OPTIONS.map((p,i)=>({token:p.id,color:colors[i]}));
let pendingRules={...DEFAULT_RULES},view=read('omt-board-view','3d'),palette=read('omt-board-palette','stone');
let sound=read('omt-game-sound','off')==='on',reduceMotion=read('omt-game-motion','system')==='reduced';
let scene=null,scenePromise=null,sceneFailed=false,animationBusy=false,motionTimer=null,profileTarget=null;
const systemMotion=matchMedia('(prefers-reduced-motion: reduce)'),systemTheme=matchMedia('(prefers-color-scheme: dark)');
const motionOff=()=>reduceMotion||systemMotion.matches;
const effects=new GameEffects({sound,reducedMotion:motionOff()});
const activeRules=()=>state?.settings || pendingRules;
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
const button = (label, action, cls='', disabled=false, extra='') => `<button type="button" class="button ${cls}" data-action="${action}" ${disabled || ((busy||animationBusy)&&/^[A-Z_]+$/.test(action)) ? 'disabled' : ''} ${extra}>${label}</button>`;
const panel = (title, body, extra='') => `<section class="panel"><div class="panel-title"><h2>${title}</h2>${extra}</div>${body}</section>`;
const token = (p,active=false) => `<span class="token sculpted-token ${active ? 'current' : ''}" data-player="${esc(p.id)}" style="--token:${esc(p.color)}" title="${esc(p.name)}">${pawnIcon(p.token)}<small>${state?.players.indexOf(p)+1 || '·'}</small></span>`;
const copy = {home:['home','ana sayfa'],projects:['projects','projeler'],resume:['resume','özgeçmiş'],play:['play','oyna'],howTo:['how to play ↗','nasıl oynanır ↗'],table:['ISTANBUL / THE TABLE','İSTANBUL / OYUN MASASI'],boardHint:['Select a space to inspect its deed.','Tapuyu incelemek için bir kare seç.'],footer:['A property game, made for friends.','Arkadaşlar için bir emlak oyunu.']};
const rules = () => {
  const r=activeRules();
  return `<p>${t('Buy your way around Istanbul. Collect districts, build on complete color sets, and be the last player who has not gone bankrupt.','İstanbul sokaklarında mülk al. Aynı renkteki semtleri topla, binalar inşa et ve iflas etmeden kalan son oyuncu ol.')}</p><p class="small-muted">${t(`This table uses ${ruleName()} rules. The amounts below match this table.`,`Bu masada ${ruleName()} kuralları geçerli. Aşağıdaki tutarlar bu masaya aittir.`)}</p><ol class="rules-list">
<li>${t(`Everyone starts with ${cash(r.startingCash)}. Roll two dice; collect ${cash(r.salary)} when passing START.`,`Herkes ${cash(r.startingCash)} ile başlar. İki zar at; Başlangıç’tan geçerken ${cash(r.salary)} al.`)} ${r.doubleSalaryOnGo?t(`Landing exactly on START pays ${cash(r.salary*2)} instead, including START cards.`,`Tam Başlangıç’a gelince ${cash(r.salary*2)} alırsın; Başlangıç’a götüren kartlar da buna dahildir.`):t('Landing exactly on START pays the same salary, including START cards.','Tam Başlangıç’a gelince aynı geliri alırsın; Başlangıç’a götüren kartlar da buna dahildir.')} ${t('Doubles give another roll. Three doubles in one turn send you to Detour.','Çift zar tekrar oynatır. Bir turda üç çift zar seni Sapak’a gönderir.')}</li>
<li>${r.auctions?t('Buy an unowned property or send it to auction. Everyone can bid, including the player who declined it. Once you pass, you leave that auction.','Sahipsiz mülkü satın al veya açık artırmaya çıkar. Almayı reddeden oyuncu dahil herkes teklif verebilir. Pas geçen oyuncu o artırmaya geri dönemez.'):t('Buy an unowned property or skip the purchase. Auctions are off, so a declined property stays with the bank.','Sahipsiz mülkü satın al veya satın almadan geç. Açık artırma kapalı; reddedilen mülk bankada kalır.')}</li>
<li>${t(`Pay rent to the owner when you land on their property. This table applies ${r.rentMultiplier}× rent to districts, stations, and utilities, rounded up to a whole lira.`,`Başkasının mülküne gelirsen kira ödersin. Bu masada semt, istasyon ve hizmet kiralarına ${r.rentMultiplier}× çarpan uygulanır; sonuç tam liraya yukarı yuvarlanır.`)} ${t('A complete color set doubles undeveloped rent before rounding and allows building: four houses, then a hotel.','Tam renk grubu, binasız kirayı yuvarlamadan önce ikiye katlar ve inşaata izin verir: dört ev, ardından otel.')} ${r.evenBuilding?t('Build and sell evenly across the color set.','Renk grubunda binaları eşit şekilde inşa et ve sat.'):t('You may build and sell in any order across the color set.','Renk grubundaki binaları istediğin sırayla inşa edebilir ve satabilirsin.')}</li>
<li>${t('Select a deed to build, sell buildings, mortgage, or lift a mortgage on your turn. Own a complete unmortgaged color set before building. Sell all its buildings before mortgaging a deed. Mortgaged properties earn no rent.','Sıra sendeyken tapuyu seçerek bina yap, bina sat, ipotek koy veya kaldır. İnşaat için renk grubunun tamamına sahip ol ve tüm ipotekleri kaldır. Bir tapuyu ipotek etmeden önce grubun tüm binalarını sat. İpotekli mülk kira kazandırmaz.')}</li>
<li>${t('Trade cash and properties with another player on your turn. They must accept the exact offer. Properties in a developed color set cannot be traded.','Sıra sendeyken diğer oyunculara para ve mülk takası öner. Karşı taraf aynı teklifi kabul etmelidir. Binalı renk grubundaki mülkler takas edilemez.')}</li>
<li>${r.bail===0?t('In Detour, leave for free before rolling or try for doubles. Your third failed attempt releases you for free and you move by that roll.','Sapak’tayken zar atmadan ücretsiz çık veya çift zar dene. Üçüncü başarısız denemede ücretsiz çıkar, attığın zar kadar ilerlersin.'):t(`In Detour, pay ${cash(r.bail)} before rolling, use a release card, or try for doubles. On the third failed attempt, pay ${cash(r.bail)} before moving by that roll.`,`Sapak’tayken zar atmadan ${cash(r.bail)} öde, çıkış kartı kullan veya çift zar dene. Üçüncü başarısız denemede ${cash(r.bail)} ödeyip attığın zar kadar ilerlersin.`)} ${t('If you owe more than you have, sell buildings, mortgage properties, or negotiate a trade to settle the debt; you can also declare bankruptcy.','Borcunu ödeyemiyorsan bina sat, mülk ipotek et veya takas yap; iflas da edebilirsin.')}</li>
</ol><p>${r.freeParkingPot?t('Paid board taxes feed the Tea Break pot. Landing on Tea Break collects and clears it. Card fees, repairs, and bail do not enter the pot; an unpaid tax enters only when paid.','Ödenen tahta vergileri Çay Molası kasasına gider. Çay Molası’na gelen kasayı alır ve kasa sıfırlanır. Kart ücretleri, onarım ve kefalet kasaya girmez; borç kalan vergi yalnızca ödendiğinde eklenir.'):t('Tea Break has no fee and pays nothing.','Çay Molası’nda ücret veya ödeme yoktur.')}</p><p class="small-muted">${t('The building supply is always limited to 32 houses and 12 hotels. If no houses are available to downgrade a hotel, you can still sell all buildings in its color group. All money is fictional.','Bina sayısı her zaman 32 ev ve 12 otelle sınırlıdır. Bir oteli evlere dönüştürmek için bankada yeterli ev yoksa renk grubundaki tüm binaları yine de satabilirsin. Para hayalidir.')}</p><p class="small-muted">${t('Online: 2–6 players. Share your room link only with friends. The host keeps the game open; refreshing or closing their tab ends the room. Guests can rejoin from the same browser tab. Connections use PeerJS’s shared signaling and relay services; some networks may block them. No account is needed.','Çevrimiçi: 2–6 oyuncu. Oda bağlantısını arkadaşlarınla paylaş. Oda sahibi sekmeyi açık tutmalı; yeniler veya kapatırsa oda sona erer. Misafirler aynı tarayıcı sekmesinden tekrar katılabilir. Bağlantılar PeerJS sinyalleşme ve aktarım hizmetlerini kullanır; bazı ağlar bunları engelleyebilir. Hesap gerekmez.')}</p>`;
};

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
    el.querySelectorAll('.token').forEach(p=>p.classList.toggle('token-travelling',!!document.querySelector(`.moving-pawn[data-player="${CSS.escape(p.dataset.player)}"]`)));
    el.querySelector('.building-marks').innerHTML=buildingIcons(prop.houses);
    if(square.type==='go')el.querySelector('.space-price').textContent='+'+cash(activeRules().salary);
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
      detail=p.inJail?t(`In jail. Roll doubles to get out, or pay ${cash(state.settings.bail)} before rolling.`,`Hapistesin. Çift zar at veya atmadan önce ${cash(state.settings.bail)} öde.`):state.extraRoll?t('Doubles. Take another roll.','Çift zar. Bir kez daha at.'):t('The next district is a roll away.','Sıradaki semt bir zar uzağında.');
      controls=button(t('Roll dice →','Zar at →'),'ROLL','primary wide',!mine);
      if(p.inJail) controls+=`<div class="button-row">${button(p.jailCards?t('Use release card','Çıkış kartı kullan'):t(`Pay ${cash(state.settings.bail)} bail`,`${cash(state.settings.bail)} kefalet öde`),'PAY_BAIL','',!mine)}</div>`;
    } else if(state.phase==='purchase'){
      const square=BOARD[state.pending.property]; title=square.name;detail=t(`Unowned. The asking price is ${cash(square.price)}.`,`Sahipsiz. Satış fiyatı ${cash(square.price)}.`);dice=false;
      controls=button(t(`Buy for ${cash(square.price)}`,`${cash(square.price)} öde ve al`),'BUY','primary wide',!mine||p.cash<square.price)+`<div class="button-row">${button(state.settings.auctions?t('Send to auction','Açık artırmaya çıkar'):t('Skip purchase','Satın almadan geç'),'AUCTION','wide',!mine)}</div>`;
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
  $('board-center').classList.toggle('rolling',animationBusy&&state?.lastAction?.type==='ROLL');
  if(!state&&screen!=='local'){
    const chooser=document.createElement('button');chooser.type='button';chooser.className='pawn-summary';chooser.dataset.action='customize';chooser.innerHTML=`<span style="color:${profile.color}">${pawnIcon(profile.token)}</span><span>${t('Your piece','Oyun taşın')}<strong>${tokenLabel(profile.token)}</strong></span><span class="small-muted">${t('change ↗','değiştir ↗')}</span>`;
    const firstButton=$('online-form').querySelector('button');$('online-form').insertBefore(chooser,firstButton.closest('.button-row')||firstButton);
  }
  if(!state&&screen==='local'){
    document.querySelectorAll('[data-local-name]').forEach((input,i)=>{const chooser=document.createElement('button');chooser.type='button';chooser.className='local-pawn-choice';chooser.dataset.action='customize';chooser.dataset.profileIndex=i;chooser.setAttribute('aria-label',t(`Customize player ${i+1}`,`Oyuncu ${i+1} özelleştir`));chooser.innerHTML=`<span style="color:${localProfiles[i].color}">${pawnIcon(localProfiles[i].token)}</span>`;input.parentElement.append(chooser);});
    $('local-form').insertAdjacentHTML('beforeend',button(t('House rules ↗','Ev kuralları ↗'),'house-rules','text-button wide'));
  }
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
    return `<div data-player-row="${esc(p.id)}" class="player-row ${game()&&activeId()===p.id?'active':''} ${p.bankrupt?'out':''}">${token(p)}<div><div class="player-name">${esc(p.name)}${!local&&p.id===session.playerId?' · '+t('you','sen'):''}</div><div class="player-meta">${p.bankrupt?t('BANKRUPT','İFLAS'):!connected?t('RECONNECTING','YENİDEN BAĞLANIYOR'):game()?(p.inJail?t('IN JAIL','HAPİSTE'):esc(BOARD[p.position]?.name)):tokenLabel(p.token)}</div></div><span class="player-cash">${game()?cash(p.cash):'✓'}</span>${!game()&&session?.isHost&&!connected?button(t('Remove','Çıkar'),'kick','small',false,`data-player="${esc(p.id)}"`):''}</div>`;
  }).join(''),`<span class="small-muted">${state.players.filter(p=>!p.bankrupt).length}/6</span>`);
}
function renderProperty() {
  const square=BOARD[selected],prop=propertyState(selected),r=activeRules();
  if(!square) return;
  let content=`${square.color?`<div class="deed-band" style="--group:${esc(square.color)}"></div>`:''}<div class="property-title">${esc(square.name)}</div>`;
  if(square.price){
    content+=`<div class="data-row"><span>${t('Deed value','Tapu değeri')}</span><strong>${cash(square.price)}</strong></div><div class="data-row"><span>${t('Owner','Sahibi')}</span><strong>${prop.owner?esc(name(prop.owner)):t('Unowned','Sahipsiz')}</strong></div>`;
    if(prop.mortgaged)content+=`<p class="small-muted">${t('MORTGAGED · No rent due','İPOTEKLİ · Kira alınmaz')}</p>`;
    if(square.rents){
      const rentRow=(label,amount)=>`<tr><td>${label}</td><td>${cash(Math.ceil(amount*r.rentMultiplier))}</td></tr>`;
      content+=`<table class="rent-table" aria-label="${t('Rent schedule with this table’s rules','Bu masanın kurallarına göre kira tablosu')}"><tbody>${square.rents.map((amount,i)=>rentRow(square.type==='railroad'?t(`${i+1} station${i?'s':''}`,`${i+1} istasyon`):i===0?t('Base rent','Temel kira'):i===5?t('Hotel','Otel'):t(`${i} house${i>1?'s':''}`,`${i} ev`),amount)+(i===0&&square.type==='property'?rentRow(t('Complete set, no buildings','Tam grup, binasız'),amount*2):'')).join('')}</tbody></table>`;
    } else if(square.type==='utility') content+=`<p>${t(`One utility: ${4*r.rentMultiplier}× the dice total. Both utilities: ${10*r.rentMultiplier}× the dice total.`,`Bir hizmet: zar toplamının ${4*r.rentMultiplier} katı. İki hizmet: zar toplamının ${10*r.rentMultiplier} katı.`)}</p>`;
    content+=`<p class="small-muted">${t(`These rents include this table’s ${r.rentMultiplier}× multiplier, rounded up to a whole lira.`,`Bu kiralara masanın ${r.rentMultiplier}× çarpanı dahildir; tutarlar tam liraya yukarı yuvarlanır.`)}${square.type==='railroad'?' '+t('A next-station card doubles rent before rounding.','Sonraki istasyon kartı kirayı yuvarlamadan önce ikiye katlar.'):''}</p>`;
    if(square.buildCost)content+=`<div class="data-row"><span>${t('Build cost','İnşaat')}</span><strong>${cash(square.buildCost)}</strong></div>`;
    content+=`<div class="data-row"><span>${prop.mortgaged?t('Lift mortgage','İpoteği kaldır'):t('Mortgage value','İpotek değeri')}</span><strong>${cash(prop.mortgaged?Math.ceil(square.price*55/100):Math.floor(square.price/2))}</strong></div>`;
    if(game()&&prop.owner)content+=`<div class="data-row"><span>${t('Current rent','Güncel kira')}</span><strong>${prop.mortgaged?cash(0):square.type==='utility'?t('By dice roll','Zara göre'):cash(calculateRent(state,selected))}</strong></div>`;
    if(game()&&prop.owner===actor()&&state.phase!=='finished'){
      const can=!state.trade&&((canTurn()&&['roll','end'].includes(state.phase))||(state.phase==='debt'&&state.debt.playerId===actor()));
      const group=GROUPS[square.group]?.spaces || [selected],complete=group.every(i=>propertyState(i).owner===actor()),groupBuilt=group.some(i=>propertyState(i).houses>0);
      const buildable=complete&&group.every(i=>!propertyState(i).mortgaged)&&(!state.settings.evenBuilding||prop.houses===Math.min(...group.map(i=>propertyState(i).houses)))&&(me()?.cash>=square.buildCost)&&(prop.houses<4?state.bank.houses>0:state.bank.hotels>0);
      const sellable=(!r.evenBuilding||prop.houses===Math.max(...group.map(i=>propertyState(i).houses)))&&(prop.houses!==5||state.bank.houses>=4);
      content+=`<div class="button-row">${square.buildCost?button(t('Build +','İnşa et +'),'BUILD','small',!can||!buildable||state.phase==='debt'||prop.houses>=5,`data-property="${selected}"`):''}${prop.houses?button(t('Sell building','Bina sat'),'SELL_BUILDING','small',!can||!sellable,`data-property="${selected}"`):''}</div><div class="button-row">${button(prop.mortgaged?t('Lift mortgage','İpoteği kaldır'):t('Mortgage','İpotek et'),prop.mortgaged?'UNMORTGAGE':'MORTGAGE','small wide',!can||groupBuilt||(prop.mortgaged&&(state.phase==='debt'||me()?.cash<Math.ceil(Math.floor(square.price/2)*11/10))),`data-property="${selected}"`)}</div>`;
      if(complete&&groupBuilt)content+=button(t('Sell all group buildings','Gruptaki tüm binaları sat'),'sell-group-confirm','small wide',!can,`data-property="${selected}"`);
      if(square.buildCost&&!complete)content+=`<p class="small-muted">${t('Own the complete color set to build.','İnşa etmek için renk grubunu tamamla.')}</p>`;
      if(square.buildCost&&complete)content+=`<p class="small-muted">${r.evenBuilding?t('Build and sell evenly across this color set.','Bu renk grubunda binaları eşit şekilde inşa et ve sat.'):t('You can build and sell in any order across this color set.','Bu renk grubunda istediğin sırayla bina inşa edebilir ve satabilirsin.')}</p>`;
      if(square.buildCost)content+=`<p class="small-muted">${t(`Bank: ${state.bank.houses} houses · ${state.bank.hotels} hotels`,`Banka: ${state.bank.houses} ev · ${state.bank.hotels} otel`)}</p>`;
    }
  } else {
    const info={
      go:t(`Collect ${cash(r.salary)} when passing START. Landing exactly here pays ${cash(r.salary*(r.doubleSalaryOnGo?2:1))}, including START cards.`,`Başlangıç’tan geçerken ${cash(r.salary)} al. Tam buraya gelince ${cash(r.salary*(r.doubleSalaryOnGo?2:1))} alırsın; Başlangıç’a götüren kartlar da buna dahildir.`),
      jail:t('Just visiting? Nothing to pay.','Ziyaretçiysen ödeme yok.')+' '+(r.bail===0?t('In jail, you may leave for free before rolling.','Hapisteysen zar atmadan ücretsiz çıkabilirsin.'):t(`In jail, roll doubles, use a release card, or pay ${cash(r.bail)} before rolling.`,`Hapisteysen çift zar at, çıkış kartı kullan veya zar atmadan ${cash(r.bail)} öde.`)),
      parking:r.freeParkingPot?t(`Collect the Tea Break pot: ${cash(state?.freeParkingPot||0)}. Paid board taxes fill the pot; it resets after collection.`,`Çay Molası kasasını al: ${cash(state?.freeParkingPot||0)}. Ödenen tahta vergileri kasayı doldurur; alındığında kasa sıfırlanır.`):t('Take a breather. No fees, no jackpot.','Bir nefes al. Ücret veya ödül yok.'),
      goToJail:t('Go directly to jail. The move from this square to jail pays no START salary.','Doğrudan hapse git. Bu kareden hapse giderken Başlangıç geliri alınmaz.'),
      chance:t('Draw a city event. Your fortune may turn.','Bir şehir olayı çek. Talihin değişebilir.'),
      community:t('A little news from the neighborhood.','Mahalleden küçük bir haber.'),
      tax:r.freeParkingPot?t(`Pay ${cash(square.amount)} into the Tea Break pot. If you owe a debt, the tax enters the pot only when paid.`,`Çay Molası kasasına ${cash(square.amount)} öde. Borç oluşursa vergi yalnızca ödendiğinde kasaya eklenir.`):t(`Pay ${cash(square.amount)} to the bank.`,`Bankaya ${cash(square.amount)} öde.`),
    };
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
function tokenLabel(id){const option=TOKEN_OPTIONS.find(x=>x.id===id)||TOKEN_OPTIONS[0];return lang==='tr'?option.labelTr:option.label;}
function ruleName(){const r=activeRules(),key=Object.keys(RULE_PRESETS).find(k=>Object.keys(DEFAULT_RULES).every(x=>r[x]===RULE_PRESETS[k][x]));return({classic:t('Classic','Klasik'),quick:t('Fast fortunes','Hızlı servet'),generous:t('Generous city','Cömert şehir')})[key]||t('Custom','Özel');}
function renderExtras(){
  $('room-panel').querySelectorAll('.room-extras,.rule-mini').forEach(el=>el.remove());
  const viewButton=(id,label)=>`<button type="button" class="view-button ${view===id?'active':''}" data-view="${id}" aria-pressed="${view===id}" ${id==='3d'&&sceneFailed?'disabled':''}>${label}</button>`;
  $('board-tools').innerHTML=`<div class="view-switch" aria-label="${t('Board view','Tahta görünümü')}">${viewButton('3d',t('3D table','3D masa'))}${viewButton('2d',t('2D board','2D tahta'))}</div><div class="board-tool-actions">${button(t('House rules','Ev kuralları'),'house-rules','tool-button')}${button(t('Appearance + sound','Görünüm + ses'),'appearance','tool-button')}</div>`;
  $('scene-caption').hidden=view!=='3d';$('scene-caption').innerHTML=`<span>${t('Drag to orbit · scroll to zoom · select a deed','Döndürmek için sürükle · yakınlaştır · tapu seç')}</span><div class="camera-buttons"><button type="button" data-camera="left" aria-label="${t('Rotate left','Sola döndür')}">↶</button><button type="button" data-camera="right" aria-label="${t('Rotate right','Sağa döndür')}">↷</button><button type="button" data-camera="in" aria-label="${t('Zoom in','Yakınlaştır')}">+</button><button type="button" data-camera="out" aria-label="${t('Zoom out','Uzaklaştır')}">−</button><button type="button" data-camera="reset" aria-label="${t('Reset camera','Kamerayı sıfırla')}">⌖</button></div>`;
  const r=activeRules();
  $('event-ribbon').innerHTML=`<div><span class="eyebrow">${game()?t('AT THE TABLE','MASADA'):t('THE HOUSE RULES','EV KURALLARI')}</span><p>${game()?esc(state.lastCard?.text || state.log.at(-1)?.text):`${esc(ruleName())} · ${cash(r.startingCash)} ${t('to start','başlangıç')} · ${cash(r.salary)} ${t('per lap','her tur')}`}</p></div>${r.freeParkingPot?`<div class="pot-counter">${pawnIcon('tea')}<span>${t('Tea Break pot','Çay Molası kasası')}<strong>${cash(state?.freeParkingPot||0)}</strong></span></div>`:''}`;
  if(state){
    $('room-panel').insertAdjacentHTML('beforeend',`<div class="room-extras"><button class="text-button" data-action="house-rules">${esc(ruleName())} · ${t('view rules ↗','kuralları gör ↗')}</button>${state.kind==='lobby'?button(`${pawnIcon(profile.token)} ${t('Customize your piece','Taşını özelleştir')}`,'customize','small wide'):''}<div class="reaction-buttons" aria-label="${t('Table reactions','Masa tepkileri')}">${Object.entries({wave:['👋',t('Hello','Merhaba')],gg:['✦',t('Well played','İyi oyundu')],wow:['!',t('Wow','Vay')],lucky:['☘',t('Lucky','Şanslı')]}).map(([key,[symbol,label]])=>`<button type="button" data-reaction="${key}" aria-label="${label}" title="${label}">${symbol}</button>`).join('')}</div></div>`);
  } else {
    const rows=$('room-panel').querySelectorAll('.data-row strong');if(rows[1])rows[1].textContent=cash(r.startingCash);
    $('room-panel').insertAdjacentHTML('beforeend',`<div class="rule-mini">${button(`${esc(ruleName())} · ${t('edit rules ↗','kuralları düzenle ↗')}`,'house-rules','small wide')}</div>`);
  }
  document.body.dataset.view=view;document.body.dataset.palette=palette;document.body.classList.toggle('reduce-motion',motionOff());
}
async function ensureScene(){
  if(scene||sceneFailed)return;
  if(!scenePromise)scenePromise=(async()=>{
    try{const {BoardScene}=await import('./scene.js?v=20261006-4');scene=new BoardScene($('scene-view'),{onSelect(index){selected=index;renderBoard();renderProperty();updateScene(false);},onError(){fallbackScene();},onReady(){ $('scene-loading').hidden=true; }});$('scene-loading').hidden=true;updateScene(false);}
    catch(error){console.warn('3D view unavailable',error);fallbackScene();}
  })();
  return scenePromise;
}
function fallbackScene(){sceneFailed=true;view='2d';$('scene-loading').hidden=true;applyView();notice(t('3D is unavailable in this browser. The 2D board is ready to play.','Bu tarayıcıda 3D kullanılamıyor. 2D tahta oynamaya hazır.'));}
function updateScene(animate=true){if(view==='3d'&&scene)scene.update(state,{selected,theme:theme==='system'?(systemTheme.matches?'dark':'light'):theme,palette,reducedMotion:motionOff(),animate});}
function applyView(){
  const is3d=view==='3d';document.body.dataset.view=view;$('board').hidden=is3d;$('scene-view').hidden=!is3d;$('scene-loading').hidden=!is3d||!!scene||sceneFailed;
  (is3d?$('play-panel'):$('board')).append($('board-center'));effects.stop();renderExtras();
  if(is3d){ensureScene();scene?.resize();updateScene(false);}
}
function installState(nextState){
  const previous=state;state=nextState;
  if($('modal').open&&$('rules-form')&&state?.kind==='lobby'&&!session?.isHost)showHouseRules();
  if(game()&&state.lastAction&&state.revision!==previous?.revision){
    if(['ROLL','BUY','AUCTION'].includes(state.lastAction.type))selected=state.pending?.property??state.auction?.property??state.players.find(p=>p.id===state.lastAction.playerId)?.position??selected;
    const duration=motionOff()?0:(state.lastAction.type==='ROLL'?650:0)+(state.lastMove?.path.length||0)*70;
    clearTimeout(motionTimer);animationBusy=duration>0;
    if(duration)motionTimer=setTimeout(()=>{animationBusy=false;renderCenter();renderProperty();},duration+50);
  }
  render();effects.transition(previous,state,{view,tokenMarkup:token});
}
function render() { if(displayedTradeId && state?.trade?.id!==displayedTradeId){$('modal').close();displayedTradeId=null;}applyPreferences();renderBoard();renderCenter();renderRoom();renderProperty();renderPortfolio();renderExtras();updateScene();if(local)$('connection').textContent=t('● Local table · pass & play','● Yerel oyun · aynı cihaz');else if(!state&&!busy)$('connection').textContent=t('2–6 players · online or local','2–6 oyuncu · çevrimiçi veya yerel'); }
async function act(action, actorOverride) {
  if(busy||animationBusy)return false;
  busy=true;
  try {
    if(local) installState(applyAction(state,actorOverride||actor(),action,secureRandom));
    else await session.dispatch(action);
    return true;
  } catch(error) {notice(error.message);return false;}
  finally{busy=false;renderCenter();renderProperty();}
}
function secureRandom(){const b=new Uint32Array(1);crypto.getRandomValues(b);return b[0]/4294967296;}
async function connect() {
  if(busy)return;
  draftName=$('player-name').value.trim();if(!draftName){$('player-name').focus();return;}
  draftCode=$('room-code')?.value||draftCode;save('omt-player-name',draftName);busy=true;render();
  const next=new RoomSession({
    onState(nextState){installState(nextState);},
    onReaction(event){showReaction(event);},
    onStatus(status){
      $('connection').textContent=status.message;
      if(status.kind==='disconnected'&&!status.roomCode){state=null;session=null;busy=false;screen='home';history.replaceState(null,'',location.pathname);$('modal').close();render();notice(status.message);}
      else if(state){renderRoom();renderExtras();}
    },
    onError(message){notice(message);}
  });
  session=next;local=false;
  try{if(screen==='join')await next.join(draftCode,draftName,profile);else{await next.host(draftName,profile);await next.setRules(pendingRules);}history.replaceState(null,'',`${location.pathname}#room=${encodeURIComponent(next.roomCode)}`);}
  catch(error){next.leave();session=null;state=null;notice(error.message);}
  finally{busy=false;render();}
}
async function copyInvite(){
  const url=`${location.origin}${location.pathname}#room=${encodeURIComponent(session.roomCode)}`;
  try{await navigator.clipboard.writeText(url);notice(t('Invite link copied. Send it to your friends.','Davet bağlantısı kopyalandı. Arkadaşlarına gönder.'));}
  catch{openModal(t('Invite friends','Arkadaşlarını davet et'),`<label class="field">${t('Copy this link','Bu bağlantıyı kopyala')}<input readonly value="${esc(url)}"></label>`);}
}
function leave(){session?.leave();session=null;state=null;local=false;busy=false;animationBusy=false;clearTimeout(motionTimer);effects.stop();screen='home';history.replaceState(null,'',location.pathname);$('modal').close();render();}
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
function rulesSummary(r=activeRules()){
  return `<div class="rules-summary">${[
    [t('Starting cash','Başlangıç parası'),cash(r.startingCash)],
    [t('Salary / lap','Tur başına gelir'),cash(r.salary)],
    [t('Jail bail','Kefalet'),cash(r.bail)],
    [t('Rent multiplier','Kira çarpanı'),r.rentMultiplier+'×'],
    [t('Auctions','Açık artırma'),r.auctions?t('On','Açık'):t('Off','Kapalı')],
    [t('Tea Break tax pot','Çay Molası vergi kasası'),r.freeParkingPot?t('On','Açık'):t('Off','Kapalı')],
    [t('Double salary on START','Başlangıç’ta çift gelir'),r.doubleSalaryOnGo?t('On','Açık'):t('Off','Kapalı')],
    [t('Build evenly','Eşit bina inşası'),r.evenBuilding?t('Required','Zorunlu'):t('Optional','İsteğe bağlı')],
  ].map(([label,value])=>`<div class="data-row"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`;
}
function showHouseRules(){
  const r=activeRules(),editable=!state||(state.kind==='lobby'&&session?.isHost);
  const select=(key,label,values,format=cash)=>`<label class="field">${label}<select name="${key}" ${editable?'':'disabled'}>${values.map(v=>`<option value="${v}" ${r[key]===v?'selected':''}>${format(v)}</option>`).join('')}</select></label>`;
  const check=(key,label,description)=>`<label class="rule-check"><input type="checkbox" name="${key}" ${r[key]?'checked':''} ${editable?'':'disabled'}><span><strong>${label}</strong><small>${description}</small></span></label>`;
  openModal(t('House rules','Ev kuralları'),`<p class="modal-intro">${editable?t('Set the rules before the first roll. Everyone in the room plays by the same rules.','İlk zardan önce kuralları belirle. Odadaki herkes aynı kurallarla oynar.'):t('These rules are locked for this game.','Bu oyun için kurallar sabittir.')}</p><form id="rules-form"><div class="preset-grid">${Object.entries({classic:[t('Classic','Klasik'),t('The familiar balance.','Alışıldık denge.')],quick:[t('Fast fortunes','Hızlı servet'),t('Less cash, higher rent.','Az para, yüksek kira.')],generous:[t('Generous city','Cömert şehir'),t('Bigger starts and bonuses.','Bol para ve ödüller.')]}).map(([key,[label,description]])=>`<button type="button" data-preset="${key}" class="preset-card" ${editable?'':'disabled'}><strong>${label}</strong><small>${description}</small></button>`).join('')}</div><div class="rules-fields">${select('startingCash',t('Starting cash','Başlangıç parası'),[500,1000,1500,2000,2500,3000,5000])}${select('salary',t('Salary when passing START','Başlangıç’tan geçiş geliri'),[0,100,200,300,400,500])}${select('bail',t('Jail bail','Kefalet'),[0,25,50,100,200])}${select('rentMultiplier',t('Rent multiplier','Kira çarpanı'),[.5,1,1.5,2],v=>v+'×')}</div>${check('auctions',t('Auction declined properties','Reddedilen mülkü artırmaya çıkar'),t('Switch off to leave them with the bank.','Kapalıysa mülk bankada kalır.'))}${check('freeParkingPot',t('Tea Break tax pot','Çay Molası vergi kasası'),t('Paid city taxes go into a pot. Landing on Tea Break collects it.','Ödenen şehir vergileri kasaya gider. Çay Molası’na gelen kasayı alır.'))}${check('doubleSalaryOnGo',t('Double salary on START','Başlangıç’ta çift gelir'),t('Landing exactly on START doubles that salary payment.','Tam Başlangıç’a gelince o geçişteki gelir ikiye katlanır.'))}${check('evenBuilding',t('Build evenly across a color set','Renk grubunda eşit inşa et'),t('Switch off to develop one district ahead of its neighbors.','Kapalıysa bir semtte diğerlerinden önce gelişebilirsin.'))}<p class="small-muted">${t('The bank always has 32 houses and 12 hotels. All money is fictional.','Bankada her zaman 32 ev ve 12 otel bulunur. Para hayalidir.')}</p>${editable?`<button type="submit" class="button primary wide">${t('Save house rules','Ev kurallarını kaydet')}</button>`:''}</form>`);
}
function fillRulesForm(value){for(const [key,v]of Object.entries(value)){const el=$('rules-form').elements.namedItem(key);if(el.type==='checkbox')el.checked=v;else el.value=String(v);}}
function showCustomization(index=null){
  profileTarget=index;
  const p=index!==null?localProfiles[index]:(state?.kind==='lobby'?session.players.find(x=>x.id===session.playerId):profile)||profile;
  openModal(t('Make your move','Taşını seç'),`<p class="modal-intro">${t('Choose a piece and a color. This is how your friends will see you at the table.','Bir taş ve renk seç. Arkadaşların masada seni böyle görecek.')}</p><form id="profile-form"><div class="pawn-picker">${TOKEN_OPTIONS.map(o=>`<label class="pawn-option"><input type="radio" name="pawn" value="${o.id}" ${p.token===o.id?'checked':''}><span>${pawnIcon(o.id)}<strong>${lang==='tr'?o.labelTr:o.label}</strong></span></label>`).join('')}</div><fieldset class="color-picker"><legend>${t('Your color','Rengin')}</legend>${colors.map((c,i)=>`<label class="color-option" style="--choice:${c}"><input type="radio" name="color" value="${c}" ${p.color===c?'checked':''} aria-label="${t('Color','Renk')} ${i+1}"><span></span></label>`).join('')}</fieldset><div class="customization-preview" style="color:${p.color}">${pawnIcon(p.token)}<span>${t('Your next fortune starts here.','Bir sonraki servetin burada başlar.')}</span></div><button class="button primary wide" type="submit">${t('Use this piece','Bu taşı kullan')}</button></form>`);
}
function showAppearance(){
  openModal(t('Your table','Senin masan'),`<p class="modal-intro">${t('These choices change your view only. Your friends keep theirs.','Bu seçimler yalnızca senin görünümünü değiştirir.')}</p><form id="appearance-form"><label class="field">${t('Tabletop palette','Masa paleti')}<select name="palette"><option value="stone" ${palette==='stone'?'selected':''}>${t('Carved stone','Oyma taş')}</option><option value="bosphorus" ${palette==='bosphorus'?'selected':''}>${t('Bosphorus blue','Boğaz mavisi')}</option><option value="terracotta" ${palette==='terracotta'?'selected':''}>${t('Terracotta','Toprak')}</option></select></label><label class="rule-check"><input type="checkbox" name="sound" ${sound?'checked':''}><span><strong>${t('Table sounds','Masa sesleri')}</strong><small>${t('Soft dice, purchase, and building sounds.','Hafif zar, satın alma ve inşa sesleri.')}</small></span></label><label class="rule-check"><input type="checkbox" name="reduced" ${reduceMotion?'checked':''}><span><strong>${t('Reduce motion','Hareketi azalt')}</strong><small>${t('Skip dice and piece animations. Your system preference is also respected.','Zar ve taş animasyonlarını atla. Sistem tercihin de dikkate alınır.')}</small></span></label><button type="submit" class="button primary wide">${t('Save preferences','Tercihleri kaydet')}</button></form>`);
}
function showReaction(event){
  const map={wave:['👋',t('Hello!','Merhaba!')],gg:['✦',t('Well played','İyi oyundu')],wow:['!',t('Wow!','Vay!')],lucky:['☘',t('Lucky!','Şanslı!')]};const reaction=map[event.reaction];if(!reaction)return;
  const el=document.createElement('div');el.className='reaction-bubble';el.innerHTML=`<strong>${reaction[0]}</strong><span>${esc(name(event.playerId))}<small>${reaction[1]}</small></span>`;$('reaction-layer').append(el);setTimeout(()=>el.remove(),2600);
}
document.addEventListener('click',async e=>{
  effects.unlock();
  const viewChoice=e.target.closest('button[data-view]');if(viewChoice){view=viewChoice.dataset.view;save('omt-board-view',view);applyView();return;}
  const camera=e.target.closest('[data-camera]');if(camera){const c=camera.dataset.camera;if(c==='reset')scene?.resetCamera();else if(c==='left'||c==='right')scene?.rotate(c==='left'?-.35:.35);else scene?.zoom(c==='in'?1:-1);return;}
  const preset=e.target.closest('[data-preset]');if(preset){fillRulesForm(RULE_PRESETS[preset.dataset.preset]);document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('selected',b===preset));return;}
  const reaction=e.target.closest('[data-reaction]');if(reaction){try{if(local)showReaction({playerId:actor(),reaction:reaction.dataset.reaction});else await session.react(reaction.dataset.reaction);}catch(err){notice(err.message);}return;}
  const pref=e.target.closest('[data-theme],[data-lang]');if(pref){if(pref.dataset.theme){theme=pref.dataset.theme;save('omt-theme',theme);}else{lang=pref.dataset.lang;save('omt-lang',lang);}render();return;}
  const space=e.target.closest('[data-space],[data-inspect]');if(space){selected=Number(space.dataset.space??space.dataset.inspect);renderBoard();renderProperty();updateScene(false);return;}
  const b=e.target.closest('[data-action]');if(!b||b.disabled)return;e.preventDefault();const a=b.dataset.action;
  if(['home','join','local'].includes(a)){if(busy)return;screen=a;renderCenter();return;}
  if(animationBusy&&['review-trade','sell-group-confirm','bankrupt-confirm','trade'].includes(a))return;
  if(a==='house-rules'){showHouseRules();return;}if(a==='appearance'){showAppearance();return;}if(a==='customize'){showCustomization(b.dataset.profileIndex===undefined?null:Number(b.dataset.profileIndex));return;}
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
  if(e.target.id==='rules-form'){try{const form=e.target,value=Object.fromEntries(Object.keys(DEFAULT_RULES).map(k=>{const el=form.elements.namedItem(k);return[k,el.type==='checkbox'?el.checked:Number(el.value)];}));const normalized=normalizeRules(value);if(state?.kind==='lobby')await session.setRules(normalized);else pendingRules=normalized;$('modal').close();render();notice(t('House rules saved.','Ev kuralları kaydedildi.'));}catch(err){notice(err.message);}return;}
  if(e.target.id==='profile-form'){try{const form=e.target,value=sanitizeProfile({token:form.elements.namedItem('pawn').value,color:form.elements.namedItem('color').value});if(profileTarget!==null)localProfiles[profileTarget]=value;else{profile=value;save('omt-pawn',profile.token);save('omt-pawn-color',profile.color);if(state?.kind==='lobby')await session.updateProfile({token:value.token,color:value.color});}$('modal').close();render();}catch(err){notice(err.message);}return;}
  if(e.target.id==='appearance-form'){palette=e.target.elements.namedItem('palette').value;sound=e.target.elements.namedItem('sound').checked;reduceMotion=e.target.elements.namedItem('reduced').checked;save('omt-board-palette',palette);save('omt-game-sound',sound?'on':'off');save('omt-game-motion',reduceMotion?'reduced':'system');effects.configure({sound,reducedMotion:motionOff()});effects.unlock();effects.play('BUILD');if(motionOff()){clearTimeout(motionTimer);animationBusy=false;effects.stop();}$('modal').close();render();return;}
  if(e.target.id==='online-form'){await connect();}
  if(e.target.id==='local-form'){local=true;session=null;installState(createGame(Array.from({length:localCount},(_,i)=>({...localProfiles[i],id:`local-${i}`,name:localNames[i].trim()||t(`Player ${i+1}`,`Oyuncu ${i+1}`)})),pendingRules));}
  if(e.target.id==='bid-form')await act({type:'BID',amount:Number($('bid-amount').value)});
  if(e.target.id==='trade-form'){const action={type:'OFFER_TRADE',targetId:$('trade-target').value,giveCash:Number($('give-cash').value),receiveCash:Number($('receive-cash').value),giveProperties:[...e.target.querySelectorAll('[name="give"]:checked')].map(x=>Number(x.value)),receiveProperties:[...e.target.querySelectorAll('[name="receive"]:checked')].map(x=>Number(x.value))};if(await act(action))$('modal').close();}
});
document.addEventListener('input',e=>{if(e.target.id==='player-name')draftName=e.target.value;if(e.target.id==='room-code')draftCode=e.target.value;if(e.target.dataset.localName!==undefined)localNames[Number(e.target.dataset.localName)]=e.target.value;});
document.addEventListener('change',e=>{if(e.target.id==='local-count'){localCount=Number(e.target.value);renderCenter();}if(e.target.id==='trade-target')$('receive-deeds').innerHTML=tradeChecks(e.target.value,'receive');if(e.target.closest('#profile-form')){const form=$('profile-form'),preview=form.querySelector('.customization-preview');preview.style.color=form.elements.namedItem('color').value;preview.querySelector('svg').outerHTML=pawnIcon(form.elements.namedItem('pawn').value);}});
$('rules-button').addEventListener('click',()=>openModal(t('How to play','Nasıl oynanır'),rules()));
$('close-modal').addEventListener('click',()=>$('modal').close());
$('modal').addEventListener('click',e=>{if(e.target===$('modal')){const r=$('modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('modal').close();}});
window.addEventListener('beforeunload',e=>{if(game()&&state.phase!=='finished'){e.preventDefault();e.returnValue='';}});
systemTheme.addEventListener('change',()=>updateScene(false));systemMotion.addEventListener('change',()=>{effects.configure({reducedMotion:motionOff()});render();});
if(!['3d','2d'].includes(view))view='3d';if(!['stone','bosphorus','terracotta'].includes(palette))palette='stone';
if(draftCode)screen='join';buildBoard();render();applyView();
