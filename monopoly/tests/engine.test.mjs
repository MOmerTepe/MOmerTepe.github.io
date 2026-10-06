import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyAction,calculateRent,assetValue} from '../engine.js';
import {BOARD,GROUPS} from '../board.js';
import {DEFAULT_RULES,RULE_PRESETS,normalizeRules} from '../rules.js';
import {PLAYER_COLORS} from '../cosmetics.js';

const game = (count=2) => createGame(['Ada','Bora','Cem','Deniz','Ece','Feri'].slice(0,count).map((name,index) => ({id:`p${index}`,name})));
const dice = (...values) => {
  let index=0;
  return () => {
    assert.ok(index < values.length,'Unexpected random draw');
    return (values[index++]-0.5)/6;
  };
};
const act = (state,type,extra={},actor='p0',rng=()=>0.4) => applyAction(state,actor,{type,...extra},rng);
const owned = (state,indices,owner='p0') => { indices.forEach(i => state.properties[i].owner=owner); return state; };
const customGame = rules => createGame([{id:'p0',name:'Ada'},{id:'p1',name:'Bora'}],rules);

test('forty-space board and player identity validation',() => {
  assert.equal(BOARD.length,40);
  assert.equal(BOARD.filter(s => s.type==='property').length,22);
  assert.equal(Object.values(GROUPS).flatMap(g => g.spaces).length,22);
  assert.throws(() => createGame([{id:'a',name:'A'}]),/2–6/);
  assert.throws(() => createGame([{id:'a',name:'A'},{id:'a',name:'B'}]),/unique/);
  assert.equal(game(6).players.length,6);
});

test('actions are immutable, increment revisions and enforce turn ownership',() => {
  const before=game(), snapshot=structuredClone(before);
  assert.throws(() => act(before,'ROLL',{},'p1'),/not your turn/);
  const after=act(before,'ROLL',{},'p0',dice(1,2));
  assert.deepEqual(before,snapshot);
  assert.equal(after.revision,1);
  assert.equal(after.phase,'purchase');
  assert.equal(after.pending.property,3);
  assert.throws(() => act(before,'ROLL',{},'p0',()=>1),/Random source/);
  assert.deepEqual(before,snapshot);
});

test('buying, turn progression and salary across START',() => {
  let state=act(game(),'ROLL',{},'p0',dice(1,2));
  state=act(state,'BUY');
  assert.equal(state.players[0].cash,1440);
  assert.equal(state.properties[3].owner,'p0');
  assert.equal(state.phase,'end');
  state=act(state,'END_TURN');
  assert.equal(state.turn,1);
  assert.equal(state.phase,'roll');
  state.players[1].position=38;
  state=act(state,'ROLL',{},'p1',dice(1,2));
  assert.equal(state.players[1].position,1);
  assert.equal(state.players[1].cash,1700);
});

test('rent doubles with a set, changes with buildings and stops on a mortgage',() => {
  let state=owned(game(),[1,3],'p1');
  assert.equal(calculateRent(state,3),8);
  state=act(state,'ROLL',{},'p0',dice(1,2));
  assert.equal(state.players[0].cash,1492);
  assert.equal(state.players[1].cash,1508);
  state.properties[3].houses=2;
  assert.equal(calculateRent(state,3),60);
  state.properties[3].mortgaged=true;
  assert.equal(calculateRent(state,3),0);
});

test('station and utility rent depend on portfolio and actual dice',() => {
  const state=owned(game(),[5,15,25,35,12,28],'p1');
  assert.equal(calculateRent(state,5),200);
  state.properties[35].owner=null;
  assert.equal(calculateRent(state,5),100);
  assert.equal(calculateRent(state,12,7),70);
  state.properties[28].owner=null;
  assert.equal(calculateRent(state,12,7),28);
});

test('declining buyer may participate in sequential auction and all bids must be affordable',() => {
  let state=act(game(3),'ROLL',{},'p0',dice(1,2));
  state=act(state,'AUCTION');
  assert.deepEqual(state.auction.activeBidders,['p0','p1','p2']);
  assert.throws(() => act(state,'BID',{amount:100},'p1'),/auction turn/);
  assert.throws(() => act(state,'BID',{amount:1600}),/exceeds/);
  state=act(state,'BID',{amount:10});
  state=act(state,'PASS',{},'p1');
  state=act(state,'BID',{amount:15},'p2');
  assert.equal(state.auction.bidderId,'p0');
  assert.throws(() => act(state,'BID',{amount:15}),/higher/);
  state=act(state,'BID',{amount:20});
  state=act(state,'PASS',{},'p2');
  assert.equal(state.auction,null);
  assert.equal(state.properties[3].owner,'p0');
  assert.equal(state.players[0].cash,1480);
  assert.equal(state.phase,'end');
});

test('all passes leave auctioned property with bank',() => {
  let state=act(act(game(),'ROLL',{},'p0',dice(1,2)),'AUCTION');
  state=act(state,'PASS');
  state=act(state,'PASS',{},'p1');
  assert.equal(state.properties[3].owner,null);
  assert.equal(state.phase,'end');
});

test('three consecutive doubles send player to detour and stop extra rolls',() => {
  let state=game();
  state=act(state,'ROLL',{},'p0',dice(2,2)); // Tax at 4
  assert.equal(state.phase,'roll');
  state=act(state,'ROLL',{},'p0',dice(3,3)); // Visiting 10
  assert.equal(state.phase,'roll');
  state=act(state,'ROLL',{},'p0',dice(1,1));
  assert.equal(state.players[0].position,10);
  assert.equal(state.players[0].inJail,true);
  assert.equal(state.phase,'end');
  assert.equal(state.extraRoll,false);
});

test('rolling doubles leaves detour but does not grant a second roll',() => {
  const before=game(); before.players[0].position=10; before.players[0].inJail=true;
  let state=act(before,'ROLL',{},'p0',dice(1,1));
  assert.equal(state.players[0].inJail,false);
  assert.equal(state.players[0].position,12);
  state=act(state,'BUY');
  assert.equal(state.phase,'end');
});

test('third failed detour attempt incurs debt then moves after liquidation',() => {
  let state=owned(game(),[39]);
  Object.assign(state.players[0],{position:10,inJail:true,jailTurns:2,cash:0});
  state=act(state,'ROLL',{},'p0',dice(1,2));
  assert.equal(state.phase,'debt');
  assert.equal(state.debt.amount,50);
  state=act(state,'MORTGAGE',{property:39});
  assert.equal(state.players[0].cash,150);
  assert.equal(state.players[0].inJail,false);
  assert.equal(state.players[0].position,13);
  assert.equal(state.phase,'purchase');
});

test('detour pass is consumed before bail money',() => {
  const before=game(); Object.assign(before.players[0],{inJail:true,position:10,jailCards:1});
  const state=act(before,'PAY_BAIL');
  assert.equal(state.players[0].jailCards,0);
  assert.equal(state.players[0].cash,1500);
  assert.equal(state.players[0].inJail,false);
  assert.equal(state.phase,'roll');
});

test('building and selling enforce color set, even development and bank inventory',() => {
  let state=owned(game(),[1]);
  assert.throws(() => act(state,'BUILD',{property:1}),/complete color group/);
  state.properties[3].owner='p0';
  state=act(state,'BUILD',{property:1});
  assert.equal(state.bank.houses,31);
  assert.throws(() => act(state,'BUILD',{property:1}),/evenly/);
  state=act(state,'BUILD',{property:3});
  state=act(state,'BUILD',{property:1});
  assert.throws(() => act(state,'SELL_BUILDING',{property:3}),/evenly/);
  assert.throws(() => act(state,'MORTGAGE',{property:3}),/every building/);
  state=act(state,'SELL_BUILDING',{property:1});
  assert.equal(state.properties[1].houses,1);
  assert.equal(state.players[0].cash,1375);
  assert.equal(state.bank.houses,30);
});

test('hotel upgrade and downgrade conserve physical building supply',() => {
  let state=owned(game(),[1,3]);
  state.properties[1].houses=4; state.properties[3].houses=4; state.bank.houses=24;
  state=act(state,'BUILD',{property:1});
  assert.equal(state.properties[1].houses,5);
  assert.equal(state.bank.houses,28);
  assert.equal(state.bank.hotels,11);
  state=act(state,'SELL_BUILDING',{property:1});
  assert.equal(state.properties[1].houses,4);
  assert.equal(state.bank.houses,24);
  assert.equal(state.bank.hotels,12);
  state.bank.hotels=0;
  assert.throws(() => act(state,'BUILD',{property:1}),/no hotels/);
});

test('selling a complete developed group resolves hotel shortage without forced bankruptcy',() => {
  let state=owned(game(),[1,3]);
  state.properties[1].houses=5; state.properties[3].houses=5;
  state.bank.hotels=10;
  // The other player has used all 32 houses; none are available for hotel downgrades.
  for (const index of [6,8,9,11,13,14,37,39]) {
    state.properties[index].owner='p1'; state.properties[index].houses=4;
  }
  state.bank.houses=0;
  state.players[0].cash=0;
  state=act(state,'ROLL',{},'p0',dice(1,3)); // ₺200 City Tax
  assert.equal(state.phase,'debt');
  assert.throws(() => act(state,'SELL_BUILDING',{property:1}),/four houses/);
  state=act(state,'SELL_GROUP',{property:1});
  assert.equal(state.players[0].cash,50); // ₺250 proceeds less the ₺200 debt
  assert.equal(state.phase,'end');
  assert.equal(state.debt,null);
  assert.equal(state.properties[1].houses,0);
  assert.equal(state.properties[3].houses,0);
  assert.equal(state.bank.hotels,12);
  assert.equal(state.bank.houses,0);
  assert.throws(() => act(state,'SELL_GROUP',{property:1}),/no buildings/);
});

test('complete-group liquidation accounts for mixed hotels and houses exactly once',() => {
  let state=owned(game(),[1,3]);
  state.properties[1].houses=5; state.properties[3].houses=4;
  state.bank.hotels=11; state.bank.houses=28;
  assert.throws(() => act(state,'SELL_GROUP',{property:1},'p1'),/not your turn/);
  state=act(state,'SELL_GROUP',{property:3});
  assert.equal(state.players[0].cash,1725);
  assert.equal(state.bank.hotels,12);
  assert.equal(state.bank.houses,32);
  assert.equal(state.properties[1].houses,0);
  assert.equal(state.properties[3].houses,0);
});

test('mortgage redemption is exact, including floating point sensitive prices',() => {
  let state=owned(game(),[19]);
  state=act(state,'MORTGAGE',{property:19});
  assert.equal(state.players[0].cash,1600);
  assert.equal(calculateRent(state,19),0);
  state=act(state,'UNMORTGAGE',{property:19});
  assert.equal(state.players[0].cash,1490); // ₺100 principal + ₺10 interest
  assert.equal(state.properties[19].mortgaged,false);
});

test('debt blocks normal play and settles atomically after mortgage',() => {
  let state=owned(game(),[39]);
  owned(state,[1,3],'p1');
  state.players[0].cash=3;
  state=act(state,'ROLL',{},'p0',dice(1,2));
  assert.equal(state.phase,'debt');
  assert.equal(state.debt.amount,8);
  assert.equal(state.players[1].cash,1500); // No double payment or partial ledger
  assert.throws(() => act(state,'END_TURN'),/debt|buildings/);
  state=act(state,'MORTGAGE',{property:39});
  assert.equal(state.phase,'end');
  assert.equal(state.debt,null);
  assert.equal(state.players[0].cash,195);
  assert.equal(state.players[1].cash,1508);
});

test('trades require ownership, cash and explicit counterparty acceptance',() => {
  let state=owned(game(),[1]); owned(state,[39],'p1');
  assert.throws(() => act(state,'OFFER_TRADE',{targetId:'p1',giveProperties:[39]}),/owner/);
  assert.throws(() => act(state,'OFFER_TRADE',{targetId:'p1',giveCash:2000}),/cash/);
  state=act(state,'OFFER_TRADE',{targetId:'p1',giveProperties:[1],receiveProperties:[39],giveCash:200});
  assert.throws(() => act(state,'ACCEPT_TRADE'),/no trade offer/);
  assert.throws(() => act(state,'ROLL'),/trade first/);
  state=act(state,'ACCEPT_TRADE',{tradeId:state.trade.id},'p1');
  assert.equal(state.properties[1].owner,'p1');
  assert.equal(state.properties[39].owner,'p0');
  assert.equal(state.players[0].cash,1300);
  assert.equal(state.players[1].cash,1700);
  assert.equal(state.trade,null);
});

test('built color groups cannot be split by trade',() => {
  let state=owned(game(),[1,3]); state.properties[3].houses=1;
  assert.throws(() => act(state,'OFFER_TRADE',{targetId:'p1',giveProperties:[1]}),/every building/);
});

test('trade responses are bound to the exact reviewed offer',() => {
  let state=act(game(),'OFFER_TRADE',{targetId:'p1',giveCash:50});
  const firstOffer=state.trade.id;
  assert.throws(() => act(state,'ACCEPT_TRADE',{},'p1'),/offer has changed/);
  state=act(state,'CANCEL_TRADE',{tradeId:firstOffer});
  state=act(state,'OFFER_TRADE',{targetId:'p1',receiveCash:1000});
  assert.notEqual(state.trade.id,firstOffer);
  assert.throws(() => act(state,'ACCEPT_TRADE',{tradeId:firstOffer},'p1'),/offer has changed/);
  assert.throws(() => act(state,'REJECT_TRADE',{tradeId:firstOffer},'p1'),/offer has changed/);
  assert.throws(() => act(state,'CANCEL_TRADE',{tradeId:firstOffer}),/offer has changed/);
  state=act(state,'REJECT_TRADE',{tradeId:state.trade.id},'p1');
  assert.equal(state.trade,null);
});

test('a debtor can negotiate a trade and pay creditor with its proceeds',() => {
  let state=owned(game(),[39]); owned(state,[1,3],'p1'); state.players[0].cash=0;
  state=act(state,'ROLL',{},'p0',dice(1,2));
  state=act(state,'OFFER_TRADE',{targetId:'p1',giveProperties:[39],receiveCash:300});
  state=act(state,'ACCEPT_TRADE',{tradeId:state.trade.id},'p1');
  assert.equal(state.properties[39].owner,'p1');
  assert.equal(state.players[0].cash,292);
  assert.equal(state.players[1].cash,1208);
  assert.equal(state.phase,'end');
});

test('bankruptcy transfers remaining assets and declares the last player winner',() => {
  let state=owned(game(),[39]); owned(state,[1,3],'p1'); state.players[0].cash=1;
  state=act(state,'ROLL',{},'p0',dice(1,2));
  state=act(state,'BANKRUPT');
  assert.equal(state.players[0].bankrupt,true);
  assert.equal(state.properties[39].owner,'p1');
  assert.equal(state.players[1].cash,1501);
  assert.equal(state.phase,'finished');
  assert.equal(state.winner,'p1');
  assert.throws(() => act(state,'ROLL'),/finished/);
});

test('bank debt bankruptcy frees properties and skips eliminated seats',() => {
  let state=owned(game(3),[39]); state.players[0].cash=1;
  state=act(state,'ROLL',{},'p0',dice(1,3));
  state=act(state,'BANKRUPT');
  assert.equal(state.properties[39].owner,null);
  assert.equal(state.turn,1);
  assert.equal(state.phase,'roll');
});

test('eliminated players cannot act, receive trades, or receive retained-property rent',() => {
  let state=owned(game(3),[39]);
  state.players[0].cash=1;
  state=act(state,'ROLL',{},'p0',dice(1,3));
  state=act(state,'BANKRUPT');
  assert.equal(state.properties[39].owner,null);
  assert.throws(() => act(state,'OFFER_TRADE',{targetId:'p0',giveCash:100},'p1'),/active player/);
  assert.throws(() => act(state,'ROLL',{},'p0'),/active player/);
  state.players[1].position=36;
  state=act(state,'ROLL',{},'p1',dice(1,2));
  assert.equal(state.phase,'purchase');
  assert.equal(state.pending.property,39);
  assert.equal(state.players[0].cash,0);
});

test('opportunity cards can move to START and award salary exactly once',() => {
  const values=[(3-.5)/6,(4-.5)/6,0];
  const state=act(game(),'ROLL',{},'p0',()=>values.shift());
  assert.equal(state.players[0].position,0);
  assert.equal(state.players[0].cash,1700);
  assert.equal(state.lastCard.type,'chance');
});

test('liquidation value excludes mortgaged principal and values improvements at half cost',() => {
  const state=owned(game(),[1,3]);
  state.properties[1].houses=2; state.properties[3].mortgaged=true;
  assert.equal(assetValue(state,'p0'),1580);
});

test('a deterministic four-player game preserves invariants over 1,200 actions',() => {
  let seed=0x517ac;
  const rng=() => { seed=(Math.imul(1664525,seed)+1013904223)>>>0; return seed/4294967296; };
  let state=game(4), actions=0;
  while (state.phase !== 'finished' && actions < 1200) {
    const player=state.players[state.turn];
    let action, actor=player.id;
    if (state.phase==='roll') action={type:'ROLL'};
    else if (state.phase==='purchase') action={type:player.cash >= BOARD[state.pending.property].price+80 ? 'BUY' : 'AUCTION'};
    else if (state.phase==='auction') {
      actor=state.auction.bidderId;
      const bidder=state.players.find(p => p.id===actor);
      action=state.auction.highestBid===0 && bidder.cash>200 ? {type:'BID',amount:Math.min(100,BOARD[state.auction.property].price)} : {type:'PASS'};
    } else if (state.phase==='debt') {
      const mortgage=Object.entries(state.properties).find(([,asset]) => asset.owner===actor && !asset.mortgaged);
      action=mortgage ? {type:'MORTGAGE',property:Number(mortgage[0])} : {type:'BANKRUPT'};
    } else action={type:'END_TURN'};
    state=applyAction(state,actor,action,rng); actions++;
    for (const p of state.players) assert.ok(Number.isSafeInteger(p.cash) && p.cash >= 0,`${p.name} cash invariant`);
    for (const asset of Object.values(state.properties)) if (asset.owner) assert.ok(state.players.some(p => p.id===asset.owner && !p.bankrupt),'Owner must remain active');
    assert.equal(state.bank.houses+Object.values(state.properties).reduce((n,a) => n+(a.houses===5?0:a.houses),0),32);
    assert.equal(state.bank.hotels+Object.values(state.properties).filter(a => a.houses===5).length,12);
  }
  assert.ok(actions===1200 || state.phase==='finished');
  if (state.phase==='finished') {
    assert.equal(state.players.filter(p => !p.bankrupt).length,1);
    assert.equal(state.winner,state.players.find(p => !p.bankrupt).id);
  }
});

test('custom rules reject invalid values instead of silently coercing a room configuration',() => {
  assert.deepEqual(normalizeRules(),DEFAULT_RULES);
  assert.notEqual(normalizeRules(),DEFAULT_RULES);
  for (const invalid of [null,[],true,'classic']) assert.throws(() => normalizeRules(invalid),/valid rules/);
  for (const [key,value] of [
    ['startingCash',-1],['startingCash',1501],['startingCash','1500'],
    ['salary',Infinity],['salary',NaN],['salary',1.5],
    ['bail',-50],['bail',51],['rentMultiplier',0],['rentMultiplier',2.5],
    ['auctions',1],['freeParkingPot','true'],['doubleSalaryOnGo',null],['evenBuilding',undefined],
  ]) assert.throws(() => normalizeRules({[key]:value}),new RegExp(`Invalid ${key}`));
  assert.throws(() => normalizeRules({startingCash:1500,cheat:true}),/Unknown rule/);
  assert.throws(() => createGame([{id:'p0',name:'Ada'},{id:'p1',name:'Bora'}],{salary:99}),/Invalid salary/);
});

test('all presets have independent starting cash and persist their complete rules',() => {
  for (const preset of Object.values(RULE_PRESETS)) {
    const state=customGame(preset);
    assert.deepEqual(state.settings,preset);
    assert.ok(state.players.every(player => player.cash===preset.startingCash));
    assert.equal(state.freeParkingPot,0);
    assert.equal(state.lastMove,null);
    assert.equal(state.lastAction,null);
    state.settings.salary=0;
    assert.notEqual(preset.salary,0);
  }
  assert.deepEqual(customGame({startingCash:5000}).settings,{...DEFAULT_RULES,startingCash:5000});
});

test('safe pawn cosmetics survive creating a game and unsupported values fall back',() => {
  const state=createGame([
    {id:'p0',name:'Ada',token:'cat',color:PLAYER_COLORS[3]},
    {id:'p1',name:'Bora',token:'<svg onload=alert(1)>',color:'url(evil)'},
  ]);
  assert.equal(state.players[0].token,'cat');
  assert.equal(state.players[0].color,PLAYER_COLORS[3]);
  assert.equal(state.players[1].token,'cat');
  assert.equal(state.players[1].color,PLAYER_COLORS[1]);
});

test('salary rule applies on passing START, including a zero salary',() => {
  for (const salary of [0,100,200,300,400,500]) {
    let state=customGame({salary,doubleSalaryOnGo:true});
    state.players[0].position=38;
    state=act(state,'ROLL',{},'p0',dice(1,2));
    assert.equal(state.players[0].cash,1500+salary);
    assert.equal(state.players[0].position,1);
  }
});

test('exact START awards the configured salary once, optionally doubled',() => {
  for (const doubleSalaryOnGo of [false,true]) {
    let state=customGame({salary:300,doubleSalaryOnGo});
    state.players[0].position=37;
    state=act(state,'ROLL',{},'p0',dice(1,2));
    assert.equal(state.players[0].cash,1500+(doubleSalaryOnGo ? 600 : 300));
    assert.equal(state.phase,'end');
    assert.deepEqual(state.lastMove.path,[38,39,0]);
  }
});

test('START cards apply the exact-landing bonus once and describe the actual configured award',() => {
  for (const [roll,card] of [[[3,4],0],[[1,1],0.8]]) {
    let state=customGame({salary:400,doubleSalaryOnGo:true});
    const values=[...roll.map(value => (value-.5)/6),card];
    state=act(state,'ROLL',{},'p0',()=>values.shift());
    assert.equal(state.players[0].cash,2300);
    assert.equal(state.players[0].position,0);
    assert.match(state.lastCard.text,/₺800/);
    assert.equal(state.lastMove.path.at(-1),0);
  }
});

test('rent multiplier rounds up once for properties, stations, utilities, and card multipliers',() => {
  const state=owned(customGame({rentMultiplier:0.5}),[37,5,12],'p1');
  assert.equal(calculateRent(state,37),18);
  assert.equal(calculateRent(state,5),13);
  assert.equal(calculateRent(state,12,7),14);
  assert.equal(calculateRent(state,5,7,2),25);
  state.settings.rentMultiplier=1.5;
  assert.equal(calculateRent(state,37),53);
  assert.equal(calculateRent(state,5),38);
  assert.equal(calculateRent(state,12,7),42);
  state.properties[37].mortgaged=true;
  assert.equal(calculateRent(state,37),0);
});

test('landing rent combines house rules with the next-station card before rounding',() => {
  let state=owned(customGame({rentMultiplier:0.5}),[15],'p1');
  const values=[(3-.5)/6,(4-.5)/6,0.8];
  state=act(state,'ROLL',{},'p0',()=>values.shift());
  assert.equal(state.players[0].position,15);
  assert.equal(state.players[0].cash,1475);
  assert.equal(state.players[1].cash,1525);
});

test('disabling auctions lets a declined purchase remain with the bank and preserves extra rolls',() => {
  let state=act(customGame({auctions:false}),'ROLL',{},'p0',dice(1,2));
  state=act(state,'AUCTION');
  assert.equal(state.phase,'end');
  assert.equal(state.auction,null);
  assert.equal(state.pending,null);
  assert.equal(state.properties[3].owner,null);
  assert.equal(state.players[0].cash,1500);
  assert.throws(() => act(state,'BID',{amount:10}),/no auction/);
  state=customGame({auctions:false}); state.players[0].position=39;
  state=act(state,'ROLL',{},'p0',dice(1,1));
  state=act(state,'AUCTION');
  assert.equal(state.phase,'roll');
});

test('Tea Break collects only paid board taxes, empties once, and is disabled by default',() => {
  let state=act(customGame({freeParkingPot:true}),'ROLL',{},'p0',dice(1,3));
  assert.equal(state.freeParkingPot,200);
  assert.equal(state.players[0].cash,1300);
  state=act(state,'END_TURN');
  state.players[1].position=17;
  state=act(state,'ROLL',{},'p1',dice(1,2));
  assert.equal(state.players[1].cash,1700);
  assert.equal(state.freeParkingPot,0);
  state=act(state,'END_TURN',{},'p1');
  state.players[0].position=17;
  state=act(state,'ROLL',{},'p0',dice(1,2));
  assert.equal(state.players[0].cash,1300);
  state=act(game(),'ROLL',{},'p0',dice(1,3));
  assert.equal(state.freeParkingPot,0);
});

test('an unpaid tax enters the pot only after debt settlement and only once',() => {
  let state=owned(customGame({freeParkingPot:true}),[39]);
  state.players[0].cash=0;
  state=act(state,'ROLL',{},'p0',dice(1,3));
  assert.equal(state.phase,'debt');
  assert.equal(state.freeParkingPot,0);
  state=act(state,'MORTGAGE',{property:39});
  assert.equal(state.freeParkingPot,200);
  assert.equal(state.debt,null);
  assert.equal(state.players[0].cash,0);
  state=act(state,'END_TURN');
  assert.equal(state.freeParkingPot,200);
});

test('bankruptcy adds only the actual remaining tax payment to the Tea Break pot',() => {
  let state=customGame({freeParkingPot:true});
  state.players[0].cash=40;
  state=act(state,'ROLL',{},'p0',dice(1,3));
  state=act(state,'BANKRUPT');
  assert.equal(state.freeParkingPot,40);
  assert.equal(state.players[0].cash,0);
});

test('card fees and detour bail do not feed the board-tax pot',() => {
  let state=customGame({freeParkingPot:true});
  const values=[(3-.5)/6,(4-.5)/6,0.9];
  state=act(state,'ROLL',{},'p0',()=>values.shift());
  assert.equal(state.players[0].cash,1450);
  assert.equal(state.freeParkingPot,0);
  state=customGame({freeParkingPot:true});
  Object.assign(state.players[0],{position:10,inJail:true});
  state=act(state,'PAY_BAIL');
  assert.equal(state.freeParkingPot,0);
});

test('all configured detour exit costs apply, including free exits and delayed debt',() => {
  for (const bail of [0,25,50,100,200]) {
    let state=customGame({bail});
    Object.assign(state.players[0],{position:10,inJail:true});
    state=act(state,'PAY_BAIL');
    assert.equal(state.players[0].cash,1500-bail);
    assert.equal(state.players[0].inJail,false);
  }
  let state=owned(customGame({bail:100}),[39]);
  Object.assign(state.players[0],{position:10,inJail:true,cash:0});
  state=act(state,'PAY_BAIL');
  assert.equal(state.debt.amount,100);
  state=act(state,'MORTGAGE',{property:39});
  assert.equal(state.players[0].cash,100);
  assert.equal(state.players[0].inJail,false);
  assert.equal(state.phase,'roll');
});

test('zero-cost third detour attempt releases and moves immediately without a debt',() => {
  let state=customGame({bail:0});
  Object.assign(state.players[0],{position:10,inJail:true,jailTurns:2,cash:0});
  state=act(state,'ROLL',{},'p0',dice(1,2));
  assert.equal(state.players[0].position,13);
  assert.equal(state.players[0].inJail,false);
  assert.equal(state.players[0].cash,0);
  assert.equal(state.debt,null);
  assert.equal(state.phase,'purchase');
});

test('free building order lifts evenness while keeping ownership, mortgage and supply requirements',() => {
  let state=owned(customGame({evenBuilding:false}),[1,3]);
  for (let i=0;i<5;i++) state=act(state,'BUILD',{property:1});
  assert.equal(state.properties[1].houses,5);
  assert.equal(state.properties[3].houses,0);
  assert.equal(state.bank.houses,32);
  assert.equal(state.bank.hotels,11);
  state=act(state,'BUILD',{property:3});
  state=act(state,'SELL_BUILDING',{property:3});
  assert.equal(state.properties[3].houses,0);
  state.bank.houses=0;
  assert.throws(() => act(state,'BUILD',{property:3}),/no houses/);
  assert.throws(() => act(state,'SELL_BUILDING',{property:1}),/four houses/);
  assert.throws(() => act(state,'MORTGAGE',{property:3}),/every building/);
  state=owned(customGame({evenBuilding:false}),[1]);
  assert.throws(() => act(state,'BUILD',{property:1}),/complete color group/);
  state.properties[3].owner='p0'; state.properties[3].mortgaged=true;
  assert.throws(() => act(state,'BUILD',{property:1}),/Unmortgage/);
});

test('movement and action events are deterministic, include card routes, and clear on the next action',() => {
  let state=act(game(),'ROLL',{},'p0',dice(1,2));
  assert.deepEqual(state.lastMove,{id:1,playerId:'p0',from:0,path:[1,2,3],teleports:[]});
  assert.deepEqual(state.lastAction,{id:1,type:'ROLL',playerId:'p0'});
  state=act(state,'BUY');
  assert.equal(state.lastMove,null);
  assert.deepEqual(state.lastAction,{id:2,type:'BUY',playerId:'p0',property:3});
  state=game();
  state.players[0].position=29;
  const values=[(3-.5)/6,(4-.5)/6,0.7,0.8]; // 36 chance -> back 3 -> 33 fund -> START.
  state=act(state,'ROLL',{},'p0',()=>values.shift());
  assert.deepEqual(state.lastMove.path,[30,31,32,33,34,35,36,35,34,33,34,35,36,37,38,39,0]);
  assert.equal(state.lastMove.from,29);
  assert.equal(state.lastMove.id,state.revision);
});

test('jail jumps are explicit teleports after the walked route',() => {
  let state=game(); state.players[0].position=27;
  state=act(state,'ROLL',{},'p0',dice(1,2));
  assert.deepEqual(state.lastMove.path,[28,29,30,10]);
  assert.deepEqual(state.lastMove.teleports,[{at:3,from:30,to:10}]);
  state=game(); state.doubles=2; state.players[0].position=8;
  state=act(state,'ROLL',{},'p0',dice(1,1));
  assert.deepEqual(state.lastMove.path,[10]);
  assert.deepEqual(state.lastMove.teleports,[{at:0,from:8,to:10}]);
});

test('old default game snapshots gain new settings and animation fields on their next action',() => {
  const before=game();
  before.settings={salary:200,bail:50};
  delete before.freeParkingPot; delete before.lastMove; delete before.lastAction;
  const state=act(before,'ROLL',{},'p0',dice(1,2));
  assert.deepEqual(state.settings,DEFAULT_RULES);
  assert.equal(state.freeParkingPot,0);
  assert.equal(state.lastMove.id,1);
});
