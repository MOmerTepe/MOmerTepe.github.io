// Rules: https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf
// Original game: Mike Boxleiter, Tommy Maranges, and Mac Schubert. CC BY-NC-SA 4.0.
// This host-only state contains secrets. Send clients getPlayerView(state, theirId), never state.

const ROLES = Object.freeze({
  5: {liberal:3,fascist:1}, 6: {liberal:4,fascist:1},
  7: {liberal:4,fascist:2}, 8: {liberal:5,fascist:2},
  9: {liberal:5,fascist:3}, 10: {liberal:6,fascist:3},
});
export const POWER_TRACKS = Object.freeze({
  small:Object.freeze([null,null,'peek','execute','execute',null]),
  medium:Object.freeze([null,'investigate','special-election','execute','execute',null]),
  large:Object.freeze(['investigate','investigate','special-election','execute','execute',null]),
});
const check=(condition,message) => { if (!condition) throw new Error(message); };
const living=state => state.players.filter(player => player.alive);
const playerById=(state,id) => state.players.find(player => player.id===id);
const roleOf=(state,id) => state.secret.roles.find(player => player.id===id)?.role;
const partyOf=(state,id) => roleOf(state,id)==='liberal' ? 'liberal' : 'fascist';
const hasVoted=(state,id) => state.secret.votes.some(vote => vote.id===id);
const powerTrack=state => POWER_TRACKS[state.boardSize<=6?'small':state.boardSize<=8?'medium':'large'];

function secureRandom() {
  check(globalThis.crypto?.getRandomValues,'Secure randomness is unavailable in this browser.');
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;
}
function randomIndex(rng,length) {
  const value=rng();
  check(typeof value==='number' && value>=0 && value<1,'The random source must return a number between 0 and 1.');
  return Math.floor(value*length);
}
function shuffled(values,rng) {
  const result=[...values];
  for (let i=result.length-1;i>0;i--) {
    const j=randomIndex(rng,i+1);
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
}
function log(state,text) {
  state.log.push({id:++state.logSequence,text});
  if (state.log.length>150) state.log.shift();
}
function eligibleChancellors(state) {
  const last=state.lastGovernment;
  return living(state).filter(player => player.id!==state.presidentId && player.id!==last?.chancellorId && (living(state).length<=5 || player.id!==last?.presidentId)).map(player => player.id);
}
function eligibleTargets(state) {
  if (state.phase!=='power' || state.powerResolved || state.power==='peek') return [];
  return living(state).filter(player => player.id!==state.presidentId && (state.power!=='investigate' || !state.secret.investigatedIds.includes(player.id))).map(player => player.id);
}
function nextLivingId(state,afterId) {
  const index=state.players.findIndex(player => player.id===afterId);
  for (let step=1;step<=state.players.length;step++) {
    const player=state.players[(index+step)%state.players.length];
    if (player.alive) return player.id;
  }
  throw new Error('There are no living players.');
}
function reshuffleIfNeeded(state,rng) {
  if (state.secret.deck.length>=3) return;
  state.secret.deck=shuffled([...state.secret.deck,...state.secret.discard],rng);
  state.secret.discard=[];
  log(state,'The remaining policies and discard pile were shuffled together.');
}
function draw(state,count,rng) {
  if (state.secret.deck.length<count) reshuffleIfNeeded(state,rng);
  check(state.secret.deck.length>=count,'There are not enough policies to draw.');
  return state.secret.deck.splice(0,count);
}
function finishGame(state,winner,reason) {
  state.phase='gameover'; state.winner=winner; state.winReason=reason;
  state.power=null; state.powerResolved=false;
  state.secret.presidentHand=[]; state.secret.chancellorHand=[]; state.secret.peek=[];
  log(state,`${winner==='liberal'?'Liberals':'Fascists'} win: ${reason}`);
}
function nextRound(state,{presidentId=null}={}) {
  const next=presidentId || nextLivingId(state,state.rotationResumeAfterId || state.presidentId);
  // A special election is a single inserted round. Resume after its calling president.
  if (!presidentId) state.rotationResumeAfterId=null;
  state.presidentId=next;
  state.chancellorId=null;
  state.phase='nomination'; state.round++;
  state.power=null; state.powerResolved=false; state.vetoRejected=false;
  state.secret.votes=[]; state.secret.presidentHand=[]; state.secret.chancellorHand=[]; state.secret.peek=[];
  log(state,`Round ${state.round}: ${playerById(state,next).name} is the presidential candidate.`);
}
function enactPolicy(state,policy,{chaos=false,rng}) {
  state.policies[policy]++;
  state.tracker=0;
  log(state,`${chaos?'The election tracker enacted':'The government enacted'} a ${policy==='liberal'?'Liberal':'Fascist'} policy.`);
  if (chaos) state.lastGovernment=null;
  if (state.policies.liberal===5) return finishGame(state,'liberal','Five Liberal policies were enacted.');
  if (state.policies.fascist===6) return finishGame(state,'fascist','Six Fascist policies were enacted.');
  reshuffleIfNeeded(state,rng);
  const power=policy==='fascist' && !chaos ? powerTrack(state)[state.policies.fascist-1] : null;
  if (power) {
    state.phase='power'; state.power=power; state.powerResolved=false;
    log(state,`${playerById(state,state.presidentId).name} must use the ${power.replaceAll('-',' ')} power.`);
  } else nextRound(state);
}
function failGovernment(state,rng) {
  state.tracker++;
  log(state,`The election tracker advanced to ${state.tracker}/3.`);
  if (state.tracker===3) {
    const [policy]=draw(state,1,rng);
    enactPolicy(state,policy,{chaos:true,rng});
  } else {
    reshuffleIfNeeded(state,rng);
    nextRound(state);
  }
}
function resolveElection(state,rng) {
  const votes=Object.fromEntries(state.secret.votes.map(vote => [vote.id,vote.approve]));
  const yes=state.secret.votes.filter(vote => vote.approve).length;
  const passed=yes>living(state).length/2;
  state.lastVote={presidentId:state.presidentId,chancellorId:state.chancellorId,votes,passed};
  log(state,`The government ${passed?'passed':'failed'} with ${yes} Ja and ${living(state).length-yes} Nein votes.`);
  if (!passed) return failGovernment(state,rng);
  state.lastGovernment={presidentId:state.presidentId,chancellorId:state.chancellorId};
  if (state.policies.fascist>=3 && roleOf(state,state.chancellorId)==='hitler') {
    return finishGame(state,'fascist','Hitler was elected Chancellor after three Fascist policies.');
  }
  if (state.policies.fascist>=3) log(state,`${playerById(state,state.chancellorId).name} is not Hitler.`);
  state.secret.presidentHand=draw(state,3,rng);
  state.phase='president-discard';
  log(state,`${playerById(state,state.presidentId).name} drew three policies privately.`);
}

export function createGame(players,{rng=secureRandom}={}) {
  check(Array.isArray(players) && players.length>=5 && players.length<=10,'Secret Hitler needs 5–10 players.');
  check(typeof rng==='function','A valid random source is required.');
  const ids=new Set();
  const roster=players.map(player => {
    check(player && typeof player.id==='string' && player.id.length>0 && player.id.length<=128 && !ids.has(player.id),'Every player needs a unique id.');
    check(typeof player.name==='string' && player.name.trim().length>0,'Every player needs a name.');
    ids.add(player.id);
    return {id:player.id,name:player.name.trim().slice(0,32),alive:true};
  });
  const distribution=ROLES[roster.length];
  const assignedRoles=shuffled([...Array(distribution.liberal).fill('liberal'),...Array(distribution.fascist).fill('fascist'),'hitler'],rng);
  const deck=shuffled([...Array(6).fill('liberal'),...Array(11).fill('fascist')],rng);
  const presidentId=roster[randomIndex(rng,roster.length)].id;
  const state={
    version:1,revision:0,players:roster,phase:'nomination',presidentId,chancellorId:null,
    lastGovernment:null,tracker:0,policies:{liberal:0,fascist:0},round:1,boardSize:roster.length,
    power:null,powerResolved:false,vetoRejected:false,lastVote:null,winner:null,winReason:null,
    rotationResumeAfterId:null,log:[],logSequence:0,
    secret:{roles:roster.map((player,index) => ({id:player.id,role:assignedRoles[index]})),deck,discard:[],votes:[],presidentHand:[],chancellorHand:[],investigatedIds:[],investigations:[],peek:[]},
  };
  log(state,`${roster.length} players received secret roles. ${playerById(state,presidentId).name} is the first presidential candidate.`);
  return state;
}

// Build a fresh allowlisted projection rather than deleting selected secrets from full state.
export function getPlayerView(state,viewerId) {
  check(state && state.version===1,'Unsupported game state.');
  const viewer=playerById(state,viewerId);
  const role=viewer ? roleOf(state,viewerId) : null;
  const knowsFascists=role==='fascist' || (role==='hitler' && state.boardSize<=6);
  const hand=viewerId===state.presidentId && state.phase==='president-discard' ? state.secret.presidentHand : viewerId===state.chancellorId && ['chancellor-enact','veto'].includes(state.phase) ? state.secret.chancellorHand : [];
  return structuredClone({
    version:state.version,revision:state.revision,players:state.players.map(({id,name,alive}) => ({id,name,alive})),
    phase:state.phase,presidentId:state.presidentId,chancellorId:state.chancellorId,lastGovernment:state.lastGovernment,
    tracker:state.tracker,policies:state.policies,round:state.round,boardSize:state.boardSize,
    deckCount:state.secret.deck.length,discardCount:state.secret.discard.length,power:state.power,powerResolved:state.powerResolved,
    vetoAvailable:state.policies.fascist>=5,vetoRejected:state.vetoRejected,
    eligibleChancellors:state.phase==='nomination'?eligibleChancellors(state):[],eligibleTargets:eligibleTargets(state),
    votedPlayerIds:state.phase==='voting'?state.secret.votes.map(vote => vote.id):[],
    lastVote:state.lastVote,winner:state.winner,winReason:state.winReason,log:state.log,
    revealedRoles:state.phase==='gameover'?state.secret.roles:[],
    private:viewer ? {
      role,party:partyOf(state,viewerId),
      knownPlayers:knowsFascists?state.secret.roles.filter(player => player.id!==viewerId && player.role!=='liberal'):[],
      hand:viewer.alive?hand:[],
      investigations:state.secret.investigations.filter(result => result.presidentId===viewerId).map(({id,party}) => ({id,party})),
      peek:viewer.alive && viewerId===state.presidentId && state.phase==='power' && state.power==='peek' && state.powerResolved ? state.secret.peek : [],
    }:null,
  });
}

export function applyAction(previous,actorId,action,{rng=secureRandom}={}) {
  check(previous && previous.version===1,'Unsupported game state.');
  check(action && typeof action.type==='string','Choose a valid game action.');
  check(previous.phase!=='gameover','This game has ended.');
  check(Number.isSafeInteger(action.round) && action.round===previous.round,'This action belongs to an old round. Review the current table.');
  check(typeof rng==='function','A valid random source is required.');
  const actor=playerById(previous,actorId);
  check(actor?.alive,'Only a living player at this table can act.');
  const state=structuredClone(previous);
  const requirePhase=phase => check(state.phase===phase,'That action is not available in the current phase.');
  const requirePresident=() => check(state.presidentId===actorId,'Only the President can do that.');
  const requireChancellor=() => check(state.chancellorId===actorId,'Only the Chancellor can do that.');
  const requirePower=power => {
    requirePhase('power'); requirePresident();
    check(state.power===power && !state.powerResolved,'This executive power is not available.');
  };
  const requireTarget=() => check(typeof action.targetId==='string' && eligibleTargets(state).includes(action.targetId),'Choose an eligible living player other than yourself.');
  switch (action.type) {
    case 'NOMINATE':
      requirePhase('nomination'); requirePresident();
      check(typeof action.targetId==='string' && eligibleChancellors(state).includes(action.targetId),'Choose an eligible Chancellor who is not term-limited.');
      state.chancellorId=action.targetId; state.phase='voting'; state.secret.votes=[];
      log(state,`${actor.name} nominated ${playerById(state,action.targetId).name} as Chancellor.`);
      break;
    case 'VOTE':
      requirePhase('voting');
      check(typeof action.approve==='boolean','Choose Ja or Nein.');
      check(!hasVoted(state,actorId),'You already submitted your vote for this government.');
      state.secret.votes.push({id:actorId,approve:action.approve});
      if (state.secret.votes.length===living(state).length) resolveElection(state,rng);
      break;
    case 'DISCARD': {
      requirePhase('president-discard'); requirePresident();
      check(Number.isInteger(action.index) && action.index>=0 && action.index<3,'Select one of your three policies to discard.');
      state.secret.discard.push(state.secret.presidentHand[action.index]);
      state.secret.chancellorHand=state.secret.presidentHand.filter((_,index) => index!==action.index);
      state.secret.presidentHand=[]; state.phase='chancellor-enact';
      log(state,`${actor.name} discarded one policy and passed two to the Chancellor.`);
      break;
    }
    case 'ENACT': {
      requirePhase('chancellor-enact'); requireChancellor();
      check(Number.isInteger(action.index) && action.index>=0 && action.index<2,'Select one of your two policies to enact.');
      const policy=state.secret.chancellorHand[action.index];
      state.secret.discard.push(state.secret.chancellorHand[1-action.index]);
      state.secret.chancellorHand=[];
      enactPolicy(state,policy,{rng});
      break;
    }
    case 'REQUEST_VETO':
      requirePhase('chancellor-enact'); requireChancellor();
      check(state.policies.fascist>=5,'Veto power unlocks after five Fascist policies.');
      check(!state.vetoRejected,'The President already rejected a veto. Enact one policy.');
      state.phase='veto';
      log(state,`${actor.name} requested a veto of the policy agenda.`);
      break;
    case 'VETO':
      requirePhase('veto'); requirePresident();
      check(typeof action.approve==='boolean','Choose whether to approve the veto.');
      if (action.approve) {
        state.secret.discard.push(...state.secret.chancellorHand); state.secret.chancellorHand=[];
        log(state,`${actor.name} approved the veto. Both remaining policies were discarded.`);
        failGovernment(state,rng);
      } else {
        state.vetoRejected=true; state.phase='chancellor-enact';
        log(state,`${actor.name} rejected the veto. The Chancellor must enact a policy.`);
      }
      break;
    case 'INVESTIGATE':
      requirePower('investigate'); requireTarget();
      state.secret.investigatedIds.push(action.targetId);
      state.secret.investigations.push({presidentId:actorId,id:action.targetId,party:partyOf(state,action.targetId)});
      state.powerResolved=true;
      log(state,`${actor.name} investigated ${playerById(state,action.targetId).name}'s party membership privately.`);
      break;
    case 'PEEK':
      requirePower('peek');
      check(state.secret.deck.length>=3,'There are not enough policies to peek at.');
      state.secret.peek=state.secret.deck.slice(0,3); state.powerResolved=true;
      log(state,`${actor.name} looked at the top three policies privately.`);
      break;
    case 'CONTINUE':
      requirePhase('power'); requirePresident();
      check(state.powerResolved && ['investigate','peek'].includes(state.power),'Finish the executive action before continuing.');
      nextRound(state);
      break;
    case 'SPECIAL_ELECTION':
      requirePower('special-election'); requireTarget();
      state.rotationResumeAfterId=state.presidentId;
      log(state,`${actor.name} called a special election with ${playerById(state,action.targetId).name} as presidential candidate.`);
      nextRound(state,{presidentId:action.targetId});
      break;
    case 'EXECUTE':
      requirePower('execute'); requireTarget();
      playerById(state,action.targetId).alive=false;
      log(state,`${actor.name} executed ${playerById(state,action.targetId).name}.`);
      if (roleOf(state,action.targetId)==='hitler') finishGame(state,'liberal','Hitler was executed.');
      else { log(state,'The executed player was not Hitler. Their party remains secret.'); nextRound(state); }
      break;
    default: throw new Error('Unknown game action.');
  }
  state.revision++;
  return state;
}
