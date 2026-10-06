import { BOARD, GROUPS, OWNABLE_TYPES } from './board.js?v=20261006-4';
import { DEFAULT_RULES, normalizeRules } from './rules.js?v=20261006-4';
import { PLAYER_COLORS, TOKEN_OPTIONS, sanitizeProfile } from './cosmetics.js?v=20261006-4';

const check = (condition,message) => { if (!condition) throw new Error(message); };
const byId = (state,id) => state.players.find(player => player.id === id);
const current = state => state.players[state.turn];
const active = state => state.players.filter(player => !player.bankrupt);
const cashAmount = value => Number.isSafeInteger(value) && value >= 0;
const ownable = index => Number.isInteger(index) && BOARD[index] && OWNABLE_TYPES.includes(BOARD[index].type);
const groupSpaces = index => GROUPS[BOARD[index]?.group]?.spaces || [index];
const ownsSet = (state,index,id) => groupSpaces(index).every(i => state.properties[i].owner === id);
const nextPhase = state => state.extraRoll ? 'roll' : 'end';
function log(state,text) {
  state.log.push({id:++state.logSequence,text});
  if (state.log.length > 100) state.log.shift();
}
function rollDie(rng) {
  const value = rng();
  check(typeof value === 'number' && value >= 0 && value < 1,'Random source must return a number between 0 and 1.');
  return Math.floor(value * 6) + 1;
}
function randomCard(rng,length) {
  const value = rng();
  check(typeof value === 'number' && value >= 0 && value < 1,'Invalid random source.');
  return Math.floor(value * length);
}

export function createGame(players,options={}) {
  check(Array.isArray(players) && players.length >= 2 && players.length <= 6,'A game needs 2–6 players.');
  const settings = normalizeRules(options);
  const ids = new Set();
  const roster = players.map((player,index) => {
    check(player && typeof player.id === 'string' && player.id.length > 0 && !ids.has(player.id),'Every player needs a unique id.');
    check(typeof player.name === 'string' && player.name.trim().length > 0,'Every player needs a name.');
    ids.add(player.id);
    const profile = sanitizeProfile(player,{color:PLAYER_COLORS[index % PLAYER_COLORS.length],token:TOKEN_OPTIONS[index % TOKEN_OPTIONS.length].id});
    return {id:player.id,...profile,position:0,cash:settings.startingCash,inJail:false,jailTurns:0,jailCards:0,bankrupt:false};
  });
  const state = {
    version:1,players:roster,turn:0,phase:'roll',dice:[0,0],doubles:0,extraRoll:false,
    properties:Object.fromEntries(BOARD.filter(space => OWNABLE_TYPES.includes(space.type)).map(space => [space.index,{owner:null,houses:0,mortgaged:false}])),
    bank:{houses:32,hotels:12},pending:null,auction:null,debt:null,trade:null,
    log:[],logSequence:0,revision:0,winner:null,lastCard:null,lastMove:null,lastAction:null,settings,freeParkingPot:0,
  };
  log(state,`${roster.map(p => p.name).join(', ')} joined Istanbul Exchange. ${roster[0].name} goes first.`);
  return state;
}

export function calculateRent(state,index,diceTotal=state.dice.reduce((sum,die) => sum + die,0),cardMultiplier=1) {
  if (!ownable(index)) return 0;
  const asset = state.properties[index];
  if (!asset || !asset.owner || asset.mortgaged) return 0;
  const space = BOARD[index];
  const multiplier = (state.settings?.rentMultiplier ?? DEFAULT_RULES.rentMultiplier) * cardMultiplier;
  if (space.type === 'railroad') {
    const count = BOARD.filter(s => s.type === 'railroad' && state.properties[s.index].owner === asset.owner).length;
    return Math.ceil(space.rents[count-1] * multiplier);
  }
  if (space.type === 'utility') {
    const count = BOARD.filter(s => s.type === 'utility' && state.properties[s.index].owner === asset.owner).length;
    return Math.ceil(diceTotal * (count === 2 ? 10 : 4) * multiplier);
  }
  return Math.ceil(space.rents[asset.houses] * (asset.houses === 0 && ownsSet(state,index,asset.owner) ? 2 : 1) * multiplier);
}

// Cash plus what the bank pays for liquidating unencumbered assets and buildings.
export function assetValue(state,playerId) {
  const player = byId(state,playerId);
  if (!player) return 0;
  return player.cash + Object.entries(state.properties).reduce((sum,[index,asset]) => {
    if (asset.owner !== playerId) return sum;
    const space = BOARD[index];
    return sum + (asset.mortgaged ? 0 : Math.floor(space.price/2)) + asset.houses * (space.buildCost || 0)/2;
  },0);
}

function charge(state,payer,amount,creditorId,reason,returnPhase=nextPhase(state),effect=null) {
  if (amount === 0) return true;
  if (payer.cash >= amount) {
    payer.cash -= amount;
    if (creditorId) byId(state,creditorId).cash += amount;
    else if (effect?.parkingContribution) state.freeParkingPot += amount;
    log(state,`${payer.name} paid ₺${amount} ${creditorId ? `to ${byId(state,creditorId).name}` : 'to the bank'} (${reason}).`);
    return true;
  }
  state.debt = {playerId:payer.id,creditorId,amount,reason,returnPhase,effect};
  state.phase = 'debt';
  state.trade = null;
  log(state,`${payer.name} owes ₺${amount} for ${reason}. Sell buildings or mortgage properties to pay.`);
  return false;
}

function sendToJail(state,player) {
  const from = player.position;
  if (!state.lastMove) state.lastMove = {id:state.revision+1,playerId:player.id,from,path:[],teleports:[]};
  state.lastMove.teleports.push({at:state.lastMove.path.length,from,to:10});
  state.lastMove.path.push(10);
  player.position = 10;
  player.inJail = true;
  player.jailTurns = 0;
  state.extraRoll = false;
  state.doubles = 0;
  state.phase = 'end';
  log(state,`${player.name} must take a detour. Roll doubles or pay ₺${state.settings.bail} to leave.`);
}

function move(state,player,steps,rng,{collectSalary=true,rentMultiplier=1}={}) {
  const oldPosition = player.position;
  const total = oldPosition + steps;
  if (!state.lastMove) state.lastMove = {id:state.revision+1,playerId:player.id,from:oldPosition,path:[],teleports:[]};
  for (let step=1;step<=Math.abs(steps);step++) state.lastMove.path.push(((oldPosition + Math.sign(steps)*step) % 40 + 40) % 40);
  player.position = ((total % 40) + 40) % 40;
  if (collectSalary && steps > 0 && total >= 40) {
    const salary = state.settings.salary * (state.settings.doubleSalaryOnGo && player.position === 0 ? 2 : 1);
    player.cash += salary;
    log(state,`${player.name} ${player.position === 0 ? 'landed on' : 'passed'} START and collected ₺${salary}.`);
  }
  land(state,player,rng,rentMultiplier);
}

function moveTo(state,player,destination,rng,options={}) {
  move(state,player,(destination-player.position+40)%40,rng,options);
}

function drawCard(state,player,type,rng) {
  const startReward = state.settings.salary * (state.settings.doubleSalaryOnGo ? 2 : 1);
  const opportunities = [
    {text:`The city is yours. Advance to START and collect ₺${startReward}.`,action:() => moveTo(state,player,0,rng)},
    {text:'A waterfront deal awaits. Advance to Bosphorus Palace.',action:() => moveTo(state,player,39,rng)},
    {text:'A meeting in Beşiktaş. Advance to Beşiktaş.',action:() => moveTo(state,player,16,rng)},
    {text:'Your design commission pays ₺150.',money:150},
    {text:'Repair your portfolio: ₺25 per house and ₺100 per hotel.',repair:[25,100]},
    {text:'Street closure. Take a detour immediately.',jail:true},
    {text:'A quiet route. Keep one free detour pass.',pass:true},
    {text:'A wrong turn. Go back three spaces.',action:() => move(state,player,-3,rng,{collectSalary:false})},
    {text:'A ferry connection. Advance to the next station and pay double rent if owned.',action:() => {
      const destination = [5,15,25,35].find(index => index > player.position) ?? 5;
      moveTo(state,player,destination,rng,{rentMultiplier:2});
    }},
    {text:'A late permit costs ₺50.',money:-50},
  ];
  const community = [
    {text:'A city grant arrives. Collect ₺200.',money:200},
    {text:'Your neighbourhood festival earns ₺100.',money:100},
    {text:'A small tax refund. Collect ₺50.',money:50},
    {text:'A restoration bill arrives. Pay ₺100.',money:-100},
    {text:'Support the local library. Pay ₺50.',money:-50},
    {text:'A community dividend. Collect ₺25.',money:25},
    {text:'Street closure. Take a detour immediately.',jail:true},
    {text:'A quiet route. Keep one free detour pass.',pass:true},
    {text:`Return to START and collect ₺${startReward}.`,action:() => moveTo(state,player,0,rng)},
    {text:'Neighbourhood repairs: ₺40 per house and ₺115 per hotel.',repair:[40,115]},
  ];
  const deck = type === 'chance' ? opportunities : community;
  const card = deck[randomCard(rng,deck.length)];
  state.lastCard = {type,text:card.text,playerId:player.id};
  log(state,`${player.name}: ${card.text}`);
  if (card.action) return card.action();
  if (card.jail) return sendToJail(state,player);
  if (card.pass) player.jailCards += 1;
  if (card.money > 0) player.cash += card.money;
  if (card.money < 0) charge(state,player,-card.money,null,'city card');
  if (card.repair) {
    const amount = Object.values(state.properties).filter(a => a.owner === player.id).reduce((sum,a) => sum + (a.houses === 5 ? card.repair[1] : a.houses*card.repair[0]),0);
    charge(state,player,amount,null,'building repairs');
  }
}

function land(state,player,rng,rentMultiplier=1) {
  const space = BOARD[player.position];
  state.phase = nextPhase(state);
  log(state,`${player.name} arrived at ${space.name}.`);
  if (ownable(space.index)) {
    const asset = state.properties[space.index];
    if (!asset.owner) {
      state.pending = {property:space.index,returnPhase:state.phase};
      state.phase = 'purchase';
    } else if (asset.owner !== player.id && !asset.mortgaged) {
      charge(state,player,calculateRent(state,space.index,undefined,rentMultiplier),asset.owner,`rent at ${space.name}`);
    }
  } else if (space.type === 'tax') charge(state,player,space.amount,null,space.name,nextPhase(state),{parkingContribution:state.settings.freeParkingPot});
  else if (space.type === 'parking' && state.settings.freeParkingPot && state.freeParkingPot > 0) {
    const pot = state.freeParkingPot;
    player.cash += pot;
    state.freeParkingPot = 0;
    log(state,`${player.name} collected the ₺${pot} Tea Break pot.`);
  }
  else if (space.type === 'goToJail') sendToJail(state,player);
  else if (space.type === 'chance' || space.type === 'community') drawCard(state,player,space.type,rng);
}

function settleDebt(state,rng) {
  if (!state.debt) return;
  const debt = state.debt;
  const player = byId(state,debt.playerId);
  if (player.cash < debt.amount) return;
  state.debt = null;
  state.phase = debt.returnPhase;
  charge(state,player,debt.amount,debt.creditorId,debt.reason,debt.returnPhase,debt.effect);
  if (debt.effect?.release) { player.inJail = false; player.jailTurns = 0; }
  if (debt.effect?.move) move(state,player,debt.effect.move,rng);
}

function finishAuction(state) {
  const auction = state.auction;
  if (auction.highestBidder) {
    const winner = byId(state,auction.highestBidder);
    winner.cash -= auction.highestBid;
    state.properties[auction.property].owner = winner.id;
    log(state,`${winner.name} won ${BOARD[auction.property].name} at auction for ₺${auction.highestBid}.`);
  } else log(state,`No bids for ${BOARD[auction.property].name}; it stays with the bank.`);
  state.phase = auction.returnPhase;
  state.auction = null;
}

function advanceAuction(state,previousBidder) {
  const auction = state.auction;
  const candidates = auction.activeBidders.filter(id => id !== auction.highestBidder);
  if (!candidates.length) return finishAuction(state);
  const start = state.players.findIndex(p => p.id === previousBidder);
  for (let offset=1;offset<=state.players.length;offset++) {
    const candidate = state.players[(start+offset)%state.players.length].id;
    if (candidates.includes(candidate)) { auction.bidderId=candidate; return; }
  }
}

function nextTurn(state) {
  state.pending = null;
  state.trade = null;
  state.doubles = 0;
  state.extraRoll = false;
  state.dice = [0,0];
  for (let i=0;i<state.players.length;i++) {
    state.turn = (state.turn+1)%state.players.length;
    if (!current(state).bankrupt) break;
  }
  state.phase = 'roll';
  log(state,`${current(state).name}'s turn.`);
}

function validateTrade(state,trade) {
  const from = byId(state,trade.fromId), to = byId(state,trade.toId);
  check(from && to && !from.bankrupt && !to.bankrupt && from !== to,'Choose another active player.');
  check(cashAmount(trade.giveCash) && cashAmount(trade.receiveCash),'Trade cash must be a whole nonnegative amount.');
  check(from.cash >= trade.giveCash && to.cash >= trade.receiveCash,'A player no longer has enough cash for this trade.');
  const all = [...trade.giveProperties,...trade.receiveProperties];
  check(new Set(all).size === all.length,'A property can appear only once in a trade.');
  for (const [indices,owner] of [[trade.giveProperties,from.id],[trade.receiveProperties,to.id]]) {
    check(Array.isArray(indices) && indices.length <= 28,'Invalid property list.');
    for (const index of indices) {
      check(ownable(index) && state.properties[index].owner === owner,'Only the property owner can trade it.');
      check(groupSpaces(index).every(i => state.properties[i].houses === 0),'Sell every building in a color group before trading a property from it.');
    }
  }
  check(all.length || trade.giveCash || trade.receiveCash,'A trade must include cash or property.');
}

function manageProperty(state,player,action) {
  const index = action.property;
  check(ownable(index),'Choose a valid property.');
  const asset = state.properties[index], space = BOARD[index];
  check(asset.owner === player.id,'You do not own this property.');
  const group = groupSpaces(index);
  if (action.type === 'BUILD') {
    check(state.phase !== 'debt','Pay the debt before building.');
    check(space.type === 'property','You can only build on a district.');
    check(ownsSet(state,index,player.id),'Own the complete color group before building.');
    check(group.every(i => !state.properties[i].mortgaged),'Unmortgage the complete group before building.');
    check(asset.houses < 5,'This district already has a hotel.');
    check(!state.settings.evenBuilding || asset.houses === Math.min(...group.map(i => state.properties[i].houses)),'Build evenly across the color group.');
    check(player.cash >= space.buildCost,'Not enough cash to build.');
    if (asset.houses === 4) {
      check(state.bank.hotels > 0,'The bank has no hotels left.');
      state.bank.hotels--; state.bank.houses += 4;
    } else { check(state.bank.houses > 0,'The bank has no houses left.'); state.bank.houses--; }
    asset.houses++; player.cash -= space.buildCost;
    log(state,`${player.name} built ${asset.houses === 5 ? 'a hotel' : 'a house'} at ${space.name}.`);
  } else if (action.type === 'SELL_BUILDING') {
    check(asset.houses > 0,'This property has no buildings to sell.');
    check(!state.settings.evenBuilding || asset.houses === Math.max(...group.map(i => state.properties[i].houses)),'Sell buildings evenly across the color group.');
    if (asset.houses === 5) {
      check(state.bank.houses >= 4,'The bank needs four houses to exchange for this hotel.');
      state.bank.hotels++; state.bank.houses -= 4;
    } else state.bank.houses++;
    asset.houses--; player.cash += space.buildCost/2;
    log(state,`${player.name} sold a building at ${space.name} for ₺${space.buildCost/2}.`);
  } else if (action.type === 'SELL_GROUP') {
    check(space.type === 'property','Only a district color group can have buildings.');
    check(ownsSet(state,index,player.id),'You must own the complete color group.');
    check(group.some(i => state.properties[i].houses > 0),'This color group has no buildings to sell.');
    let proceeds=0;
    for (const i of group) {
      const deed=state.properties[i];
      proceeds += deed.houses*BOARD[i].buildCost/2;
      if (deed.houses === 5) state.bank.hotels++; else state.bank.houses += deed.houses;
      deed.houses=0;
    }
    player.cash += proceeds;
    log(state,`${player.name} sold all buildings in ${GROUPS[space.group].name} for ₺${proceeds}.`);
  } else if (action.type === 'MORTGAGE') {
    check(!asset.mortgaged,'This property is already mortgaged.');
    check(group.every(i => state.properties[i].houses === 0),'Sell every building in this color group before mortgaging.');
    asset.mortgaged = true; player.cash += Math.floor(space.price/2);
    log(state,`${player.name} mortgaged ${space.name} for ₺${Math.floor(space.price/2)}.`);
  } else {
    check(state.phase !== 'debt','Pay the debt before unmortgaging.');
    check(asset.mortgaged,'This property is not mortgaged.');
    const cost = Math.ceil(Math.floor(space.price/2)*11/10);
    check(player.cash >= cost,`You need ₺${cost} to unmortgage this property.`);
    player.cash -= cost; asset.mortgaged = false;
    log(state,`${player.name} unmortgaged ${space.name} for ₺${cost}.`);
  }
}

export function applyAction(previous,actorId,action,rng=Math.random) {
  check(previous && previous.version === 1,'Unsupported game state.');
  check(action && typeof action.type === 'string','Choose a valid action.');
  check(previous.phase !== 'finished','The game is finished.');
  const state = structuredClone(previous);
  state.settings = normalizeRules(state.settings);
  state.freeParkingPot ??= 0;
  state.lastMove = null;
  state.lastAction = {id:state.revision+1,type:action.type,playerId:actorId};
  if (ownable(action.property)) state.lastAction.property = action.property;
  const player = byId(state,actorId);
  check(player && !player.bankrupt,'You are not an active player in this game.');
  const tradeResponse = ['ACCEPT_TRADE','REJECT_TRADE'].includes(action.type);
  if (tradeResponse) {
    check(state.trade && state.trade.toId === actorId,'There is no trade offer for you.');
    check(action.tradeId === state.trade.id,'This trade offer has changed. Review the current offer first.');
  } else if (state.phase === 'auction') {
    check(['BID','PASS'].includes(action.type),'Finish the auction first.');
    check(state.auction.bidderId === actorId,'Wait for your auction turn.');
  } else {
    check(current(state).id === actorId,'It is not your turn.');
    if (state.phase === 'debt') check(['SELL_BUILDING','SELL_GROUP','MORTGAGE','BANKRUPT','OFFER_TRADE','CANCEL_TRADE'].includes(action.type),'Sell buildings, mortgage property, negotiate a trade, or declare bankruptcy.');
  }

  switch (action.type) {
    case 'ROLL': {
      check(state.phase === 'roll','You cannot roll now.');
      check(!state.trade,'Finish or cancel the trade first.');
      state.lastCard = null;
      state.dice = [rollDie(rng),rollDie(rng)];
      const [a,b] = state.dice, steps = a+b, doubles = a===b;
      log(state,`${player.name} rolled ${a} + ${b}.`);
      if (player.inJail) {
        state.extraRoll = false;
        if (doubles) {
          player.inJail = false; player.jailTurns = 0;
          log(state,`${player.name} rolled doubles and left the detour.`);
          move(state,player,steps,rng);
        } else {
          player.jailTurns++;
          state.phase = 'end';
          if (player.jailTurns >= 3) {
            if (charge(state,player,state.settings.bail,null,'third detour turn','end',{release:true,move:steps})) {
              player.inJail = false; player.jailTurns = 0; move(state,player,steps,rng);
            }
          } else log(state,`${player.name} stays on the detour (${player.jailTurns}/3 attempts).`);
        }
      } else {
        state.extraRoll = doubles;
        state.doubles = doubles ? state.doubles+1 : 0;
        if (state.doubles >= 3) sendToJail(state,player);
        else move(state,player,steps,rng);
      }
      break;
    }
    case 'BUY': {
      check(state.phase === 'purchase' && state.pending,'There is no property to buy.');
      const index = state.pending.property, price = BOARD[index].price;
      check(player.cash >= price,state.settings.auctions ? 'Not enough cash. Send the property to auction instead.' : 'Not enough cash. Skip this purchase instead.');
      state.lastAction.property = index;
      player.cash -= price; state.properties[index].owner = player.id;
      state.phase = state.pending.returnPhase; state.pending = null;
      log(state,`${player.name} bought ${BOARD[index].name} for ₺${price}.`);
      break;
    }
    case 'AUCTION': {
      check(state.phase === 'purchase' && state.pending,'There is no property to auction.');
      state.lastAction.property = state.pending.property;
      if (!state.settings.auctions) {
        log(state,`${player.name} declined ${BOARD[state.pending.property].name}; it stays with the bank.`);
        state.phase = state.pending.returnPhase; state.pending = null;
        break;
      }
      state.auction = {property:state.pending.property,highestBid:0,highestBidder:null,activeBidders:active(state).map(p => p.id),bidderId:player.id,returnPhase:state.pending.returnPhase};
      state.pending = null; state.phase = 'auction';
      log(state,`${BOARD[state.auction.property].name} is up for auction. Everyone may bid, including ${player.name}.`);
      break;
    }
    case 'BID': {
      check(state.phase === 'auction','There is no auction.');
      check(cashAmount(action.amount) && action.amount > state.auction.highestBid,'Bid a whole amount higher than the current bid.');
      check(player.cash >= action.amount,'Your bid exceeds your cash.');
      state.auction.highestBid = action.amount; state.auction.highestBidder = player.id;
      log(state,`${player.name} bid ₺${action.amount}.`);
      advanceAuction(state,actorId); break;
    }
    case 'PASS': {
      check(state.phase === 'auction','You can only pass during an auction.');
      state.auction.activeBidders = state.auction.activeBidders.filter(id => id !== actorId);
      log(state,`${player.name} passed on this auction.`);
      advanceAuction(state,actorId); break;
    }
    case 'END_TURN':
      check(state.phase === 'end','Finish your turn actions first.');
      check(!state.trade,'Finish or cancel the trade first.');
      nextTurn(state); break;
    case 'BUILD': case 'SELL_BUILDING': case 'SELL_GROUP': case 'MORTGAGE': case 'UNMORTGAGE':
      check(['roll','end','debt'].includes(state.phase),'Finish the current decision first.');
      check(!state.trade,'Finish or cancel the trade first.');
      manageProperty(state,player,action);
      settleDebt(state,rng); break;
    case 'PAY_BAIL':
      check(state.phase === 'roll' && player.inJail,'You can leave a detour before rolling.');
      check(!state.trade,'Finish or cancel the trade first.');
      if (player.jailCards > 0) {
        player.jailCards--; player.inJail = false; player.jailTurns = 0;
        log(state,`${player.name} used a free detour pass.`);
      } else if (charge(state,player,state.settings.bail,null,'detour exit','roll',{release:true})) {
        player.inJail = false; player.jailTurns = 0;
      }
      break;
    case 'BANKRUPT': {
      check(state.phase === 'debt' && state.debt.playerId === actorId,'You can declare bankruptcy only when you owe a debt.');
      const creditor = state.debt.creditorId ? byId(state,state.debt.creditorId) : null;
      if (creditor) creditor.cash += player.cash;
      else if (state.debt.effect?.parkingContribution) state.freeParkingPot += player.cash;
      player.cash = 0; player.bankrupt = true;
      for (const asset of Object.values(state.properties)) {
        if (asset.owner !== actorId) continue;
        if (asset.houses === 5) state.bank.hotels++; else state.bank.houses += asset.houses;
        // Buildings are liquidated to the creditor at half cost; ownership survives.
        if (creditor && asset.houses) {
          const index = Object.keys(state.properties).find(i => state.properties[i] === asset);
          creditor.cash += asset.houses * BOARD[index].buildCost/2;
        }
        asset.owner = creditor?.id || null; asset.houses = 0;
        if (!creditor) asset.mortgaged = false;
      }
      state.debt = null; state.trade = null;
      log(state,`${player.name} is bankrupt${creditor ? `; remaining assets pass to ${creditor.name}` : '; remaining properties return to the bank'}.`);
      const survivors = active(state);
      if (survivors.length === 1) {
        state.phase = 'finished'; state.winner = survivors[0].id;
        log(state,`${survivors[0].name} wins Istanbul Exchange!`);
      } else nextTurn(state);
      break;
    }
    case 'OFFER_TRADE': {
      check(['roll','end','debt'].includes(state.phase),'Finish your current decision before trading.');
      check(!state.trade,'Finish or cancel the existing offer first.');
      const trade = {id:`trade-${state.revision+1}`,fromId:actorId,toId:action.targetId,giveProperties:action.giveProperties ?? [],receiveProperties:action.receiveProperties ?? [],giveCash:action.giveCash ?? 0,receiveCash:action.receiveCash ?? 0};
      check(Array.isArray(trade.giveProperties) && Array.isArray(trade.receiveProperties),'Choose valid property lists.');
      validateTrade(state,trade); state.trade = trade;
      log(state,`${player.name} offered a trade to ${byId(state,trade.toId).name}.`); break;
    }
    case 'ACCEPT_TRADE': {
      const trade = state.trade; validateTrade(state,trade);
      const from = byId(state,trade.fromId), to = byId(state,trade.toId);
      from.cash += trade.receiveCash-trade.giveCash; to.cash += trade.giveCash-trade.receiveCash;
      trade.giveProperties.forEach(index => { state.properties[index].owner=to.id; });
      trade.receiveProperties.forEach(index => { state.properties[index].owner=from.id; });
      log(state,`${to.name} accepted ${from.name}'s trade.`);
      state.trade = null; settleDebt(state,rng); break;
    }
    case 'REJECT_TRADE':
      log(state,`${player.name} declined the trade.`); state.trade = null; break;
    case 'CANCEL_TRADE':
      check(state.trade?.fromId === actorId,'You have no offer to cancel.');
      check(action.tradeId === state.trade.id,'This trade offer has changed. Review the current offer first.');
      state.trade = null; log(state,`${player.name} cancelled the trade offer.`); break;
    default: throw new Error('Unknown game action.');
  }
  state.revision++;
  return state;
}
