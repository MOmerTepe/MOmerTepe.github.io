import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyAction,getPlayerView,POWER_TRACKS} from '../engine.js';

const roster=count => Array.from({length:count},(_,index) => ({id:`p${index}`,name:`Player ${index+1}`}));
const seeded=start => { let seed=start>>>0; return () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }; };
function game(count=5) {
  const state=createGame(roster(count),{rng:seeded(123)});
  state.presidentId='p0';
  const fascists=count<=6?1:count<=8?2:3;
  state.secret.roles=state.players.map((player,index) => ({id:player.id,role:index===count-1?'hitler':index>=count-fascists-1?'fascist':'liberal'}));
  return state;
}
const act=(state,actorId,type,fields={},rng=seeded(456)) => applyAction(state,actorId,{type,round:state.round,...fields},{rng});
function elect(state,{targetId=null,approve=true}={}) {
  const target=targetId || getPlayerView(state,state.presidentId).eligibleChancellors.find(id => state.secret.roles.find(p=>p.id===id).role!=='hitler');
  let next=act(state,state.presidentId,'NOMINATE',{targetId:target});
  for (const player of state.players.filter(p=>p.alive)) next=act(next,player.id,'VOTE',{approve});
  return next;
}
function enactFixture(state,policy='fascist') {
  let next=elect(state);
  next.secret.presidentHand=[policy,policy,policy];
  next=act(next,next.presidentId,'DISCARD',{index:0});
  return act(next,next.chancellorId,'ENACT',{index:0});
}
function executive(count,power) {
  const state=game(count); state.phase='power'; state.power=power;
  return state;
}
function topPolicy(state,policy) {
  const index=state.secret.deck.indexOf(policy);
  [state.secret.deck[0],state.secret.deck[index]]=[state.secret.deck[index],state.secret.deck[0]];
}
function policyInventory(state) {
  const tiles=[...state.secret.deck,...state.secret.discard,...state.secret.presidentHand,...state.secret.chancellorHand];
  return {liberal:tiles.filter(p=>p==='liberal').length+state.policies.liberal,fascist:tiles.filter(p=>p==='fascist').length+state.policies.fascist};
}

test('official role distributions and 6/11 policy deck for every player count',() => {
  const expected={5:[3,1],6:[4,1],7:[4,2],8:[5,2],9:[5,3],10:[6,3]};
  for (let count=5;count<=10;count++) {
    const state=createGame(roster(count),{rng:seeded(count)});
    assert.equal(state.secret.roles.filter(p=>p.role==='liberal').length,expected[count][0]);
    assert.equal(state.secret.roles.filter(p=>p.role==='fascist').length,expected[count][1]);
    assert.equal(state.secret.roles.filter(p=>p.role==='hitler').length,1);
    assert.deepEqual(policyInventory(state),{liberal:6,fascist:11});
    assert.ok(state.players.some(p=>p.id===state.presidentId));
    assert.equal(state.boardSize,count);
  }
  assert.throws(()=>createGame(roster(4)),/5–10/);
  assert.throws(()=>createGame(roster(11)),/5–10/);
  const duplicate=roster(5); duplicate[1].id='p0';
  assert.throws(()=>createGame(duplicate),/unique/);
  assert.throws(()=>createGame(roster(5),{rng:()=>1}),/random source/);
  assert.equal(createGame(roster(5)).secret.deck.length,17);
});

test('secret knowledge follows 5–6 versus 7–10 player setup',() => {
  for (let count=5;count<=10;count++) {
    const state=game(count);
    const hitler=getPlayerView(state,`p${count-1}`);
    assert.equal(hitler.private.role,'hitler');
    assert.equal(hitler.private.party,'fascist');
    assert.equal(hitler.private.knownPlayers.length,count<=6?1:0);
    const fascist=state.secret.roles.find(p=>p.role==='fascist');
    const known=getPlayerView(state,fascist.id).private.knownPlayers;
    assert.ok(known.some(p=>p.role==='hitler'));
    assert.ok(known.every(p=>p.role!=='liberal' && p.id!==fascist.id));
    assert.deepEqual(getPlayerView(state,'p0').private.knownPlayers,[]);
    assert.equal(getPlayerView(state,'unknown').private,null);
  }
});

test('views use an explicit allowlist and do not share mutable objects with host state',() => {
  const state=game(7); state.secret.extraSensitive='never send this'; state.unexpectedSecret='host only';
  const view=getPlayerView(state,'p0');
  assert.equal(view.secret,undefined);
  assert.equal(view.unexpectedSecret,undefined);
  assert.equal(view.deck,undefined);
  assert.equal(view.roles,undefined);
  assert.deepEqual(view.revealedRoles,[]);
  assert.deepEqual(Object.keys(view.players[0]).sort(),['alive','id','name']);
  view.players[0].name='Altered'; view.log[0].text='Altered'; view.policies.fascist=99;
  assert.notEqual(state.players[0].name,'Altered');
  assert.notEqual(state.log[0].text,'Altered');
  assert.equal(state.policies.fascist,0);
});

test('actions clone state and reject unauthorized, malformed, duplicate and stale commands',() => {
  const state=game(), before=structuredClone(state);
  assert.throws(()=>act(state,'p1','NOMINATE',{targetId:'p2'}),/President/);
  assert.throws(()=>act(state,'outsider','NOMINATE',{targetId:'p2'}),/living player/);
  assert.throws(()=>act(state,'p0','NOMINATE',{targetId:'p0'}),/eligible/);
  assert.throws(()=>applyAction(state,'p0',{type:'NOMINATE',targetId:'p1'}),/old round/);
  let next=act(state,'p0','NOMINATE',{targetId:'p1'});
  assert.deepEqual(state,before);
  assert.equal(next.revision,1);
  assert.throws(()=>act(next,'p0','VOTE',{approve:'yes'}),/Ja or Nein/);
  next=act(next,'p0','VOTE',{approve:true});
  assert.throws(()=>act(next,'p0','VOTE',{approve:false}),/already submitted/);
  assert.throws(()=>act(next,'p1','VOTE',{approve:true,round:0}),/old round/);
  assert.throws(()=>act(next,'p1','DISCARD',{index:0}),/phase/);
});

test('ballots remain hidden until every living player votes, then reveal together',() => {
  let state=act(game(),'p0','NOMINATE',{targetId:'p1'});
  for (const [index,approve] of [true,false,true,false].entries()) state=act(state,`p${index}`,'VOTE',{approve});
  const view=getPlayerView(state,'p4');
  assert.equal(state.phase,'voting');
  assert.deepEqual(view.votedPlayerIds,['p0','p1','p2','p3']);
  assert.equal(view.lastVote,null);
  assert.equal(JSON.stringify(view).includes('"approve"'),false);
  state=act(state,'p4','VOTE',{approve:true});
  assert.equal(state.phase,'president-discard');
  assert.deepEqual(getPlayerView(state,'p4').lastVote.votes,{p0:true,p1:false,p2:true,p3:false,p4:true});
  assert.equal(state.lastVote.passed,true);
});

test('an exact tie fails and successful elections alone do not reset the tracker',() => {
  let state=act(game(6),'p0','NOMINATE',{targetId:'p1'});
  for (let i=0;i<6;i++) state=act(state,`p${i}`,'VOTE',{approve:i<3});
  assert.equal(state.lastVote.passed,false);
  assert.equal(state.tracker,1);
  assert.equal(state.presidentId,'p1');
  assert.equal(state.round,2);
  state=elect(state);
  assert.equal(state.phase,'president-discard');
  assert.equal(state.tracker,1);
});

test('three failed elections enact the top policy, ignore its power, and clear term limits',() => {
  let state=game(7);
  state.policies.fascist=1;
  state.lastGovernment={presidentId:'p5',chancellorId:'p6'};
  topPolicy(state,'fascist');
  state=elect(state,{approve:false}); state=elect(state,{approve:false}); state=elect(state,{approve:false});
  assert.equal(state.policies.fascist,2);
  assert.equal(state.phase,'nomination');
  assert.equal(state.power,null);
  assert.equal(state.tracker,0);
  assert.equal(state.lastGovernment,null);
  assert.equal(state.round,4);
  assert.ok(getPlayerView(state,state.presidentId).eligibleChancellors.includes('p6'));
});

test('term limits apply to the last elected government and relax at five living players',() => {
  let state=game(7); state.presidentId='p4'; state.lastGovernment={presidentId:'p0',chancellorId:'p1'};
  assert.ok(!getPlayerView(state,'p4').eligibleChancellors.includes('p0'));
  assert.ok(!getPlayerView(state,'p4').eligibleChancellors.includes('p1'));
  state=elect(state,{targetId:'p2',approve:false});
  assert.deepEqual(state.lastGovernment,{presidentId:'p0',chancellorId:'p1'});
  state.players[2].alive=false; state.players[3].alive=false;
  const eligible=getPlayerView(state,state.presidentId).eligibleChancellors;
  assert.ok(eligible.includes('p0'));
  assert.ok(!eligible.includes('p1'));
  assert.ok(!eligible.includes('p2'));
  assert.equal(state.boardSize,7); // Executions do not change the executive board.
});

test('only the President sees three policies, then only the Chancellor sees the remaining two',() => {
  let state=elect(game());
  const hand=[...state.secret.presidentHand];
  assert.deepEqual(getPlayerView(state,'p0').private.hand,hand);
  for (const id of ['p1','p2','p3','p4']) assert.deepEqual(getPlayerView(state,id).private.hand,[]);
  assert.throws(()=>act(state,'p1','DISCARD',{index:0}),/President/);
  assert.throws(()=>act(state,'p0','DISCARD',{index:3}),/three policies/);
  state=act(state,'p0','DISCARD',{index:1});
  assert.deepEqual(state.secret.discard,[hand[1]]);
  assert.deepEqual(getPlayerView(state,'p1').private.hand,[hand[0],hand[2]]);
  assert.deepEqual(getPlayerView(state,'p0').private.hand,[]);
  assert.throws(()=>act(state,'p0','ENACT',{index:0}),/Chancellor/);
  state=act(state,'p1','ENACT',{index:1});
  assert.equal(state.policies[hand[2]],1);
  assert.deepEqual(policyInventory(state),{liberal:6,fascist:11});
  assert.equal(state.tracker,0);
});

test('five Liberal policies and six Fascist policies end the game immediately',() => {
  for (const [party,count] of [['liberal',4],['fascist',5]]) {
    let state=game(); state.policies[party]=count;
    state=enactFixture(state,party);
    assert.equal(state.phase,'gameover'); assert.equal(state.winner,party);
    assert.equal(state.power,null);
    const view=getPlayerView(state,'p0');
    assert.equal(view.revealedRoles.length,5);
    assert.equal(view.secret,undefined);
    assert.throws(()=>act(state,'p0','NOMINATE',{targetId:'p1'}),/ended/);
  }
});

test('Hitler elected after three Fascist policies wins before any policies are drawn',() => {
  let state=game(); state.policies.fascist=3;
  state=elect(state,{targetId:'p4'});
  assert.equal(state.winner,'fascist');
  assert.equal(state.phase,'gameover');
  assert.equal(state.secret.deck.length,17);
  assert.match(state.winReason,/Hitler.*Chancellor/);
  let earlier=game(); earlier.policies.fascist=2;
  earlier=elect(earlier,{targetId:'p4'});
  assert.equal(earlier.phase,'president-discard');
  assert.equal(earlier.winner,null);
});

test('exact executive tracks are selected by initial player count',() => {
  const expected={5:POWER_TRACKS.small,6:POWER_TRACKS.small,7:POWER_TRACKS.medium,8:POWER_TRACKS.medium,9:POWER_TRACKS.large,10:POWER_TRACKS.large};
  for (let count=5;count<=10;count++) for (let number=1;number<=5;number++) {
    let state=game(count); state.policies.fascist=number-1;
    state=enactFixture(state);
    assert.equal(state.power,expected[count][number-1],`${count} players, Fascist policy ${number}`);
    assert.equal(state.phase,expected[count][number-1]?'power':'nomination');
  }
});

test('investigation reveals party, never Hitler role, and requires private-result acknowledgement',() => {
  let state=executive(9,'investigate');
  assert.throws(()=>act(state,'p0','INVESTIGATE',{targetId:'p0'}),/eligible/);
  assert.throws(()=>act(state,'p1','INVESTIGATE',{targetId:'p8'}),/President/);
  assert.throws(()=>act(state,'p0','CONTINUE'),/Finish/);
  state=act(state,'p0','INVESTIGATE',{targetId:'p8'});
  assert.equal(state.phase,'power'); assert.equal(state.powerResolved,true);
  assert.deepEqual(getPlayerView(state,'p0').private.investigations,[{id:'p8',party:'fascist'}]);
  assert.deepEqual(getPlayerView(state,'p1').private.investigations,[]);
  assert.deepEqual(getPlayerView(state,'p8').private.investigations,[]);
  assert.throws(()=>act(state,'p0','INVESTIGATE',{targetId:'p2'}),/not available/);
  assert.throws(()=>act(state,'p1','CONTINUE'),/President/);
  state=act(state,'p0','CONTINUE');
  assert.equal(state.presidentId,'p1');
  assert.equal(getPlayerView(state,'p0').private.investigations.length,1);
  state.phase='power'; state.power='investigate';
  assert.ok(!getPlayerView(state,'p1').eligibleTargets.includes('p8'));
  assert.throws(()=>act(state,'p1','INVESTIGATE',{targetId:'p8'}),/eligible/);
});

test('peek preserves top-three order, stays private, and is cleared after Continue',() => {
  let state=executive(5,'peek');
  const deck=[...state.secret.deck];
  state=act(state,'p0','PEEK');
  assert.deepEqual(getPlayerView(state,'p0').private.peek,deck.slice(0,3));
  assert.deepEqual(getPlayerView(state,'p1').private.peek,[]);
  assert.deepEqual(state.secret.deck,deck);
  assert.equal(state.powerResolved,true);
  assert.throws(()=>act(state,'p0','PEEK'),/not available/);
  state=act(state,'p0','CONTINUE');
  assert.deepEqual(getPlayerView(state,'p0').private.peek,[]);
  assert.deepEqual(state.secret.deck,deck);
});

test('deck is reshuffled after legislation and before a policy peek',() => {
  let state=game(); state.policies.fascist=2;
  state.secret.deck=['fascist','fascist','fascist','liberal'];
  state.secret.discard=[...Array(5).fill('liberal'),...Array(6).fill('fascist')];
  state=elect(state);
  state=act(state,'p0','DISCARD',{index:0});
  state=act(state,'p1','ENACT',{index:0});
  assert.equal(state.phase,'power'); assert.equal(state.power,'peek');
  assert.equal(state.secret.deck.length,14); assert.equal(state.secret.discard.length,0);
  assert.deepEqual(policyInventory(state),{liberal:6,fascist:11});
  state=act(state,'p0','PEEK');
  assert.equal(getPlayerView(state,'p0').private.peek.length,3);
});

test('special election inserts one candidate then returns to the original rotation',() => {
  let state=executive(7,'special-election');
  state.lastGovernment={presidentId:'p0',chancellorId:'p1'};
  state=act(state,'p0','SPECIAL_ELECTION',{targetId:'p3'});
  assert.equal(state.presidentId,'p3'); assert.equal(state.round,2);
  assert.ok(!getPlayerView(state,'p3').eligibleChancellors.includes('p1'));
  state=elect(state,{approve:false});
  assert.equal(state.presidentId,'p1'); assert.equal(state.round,3);
  assert.equal(state.rotationResumeAfterId,null);
});

test('appointing the next normal President gives that player two consecutive candidacies',() => {
  let state=executive(7,'special-election');
  state=act(state,'p0','SPECIAL_ELECTION',{targetId:'p1'});
  state=elect(state,{approve:false});
  assert.equal(state.presidentId,'p1');
  assert.equal(state.round,3);
});

test('special-election rotation survives execution of the calling President',() => {
  let state=executive(7,'special-election'); state.policies.fascist=3;
  state=act(state,'p0','SPECIAL_ELECTION',{targetId:'p3'});
  state=enactFixture(state);
  assert.equal(state.power,'execute');
  state=act(state,'p3','EXECUTE',{targetId:'p0'});
  assert.equal(state.presidentId,'p1');
  assert.equal(state.players[0].alive,false);
});

test('executions hide non-Hitler roles, remove voting rights, and skip dead presidents',() => {
  let state=executive(7,'execute');
  assert.throws(()=>act(state,'p0','EXECUTE',{targetId:'p0'}),/eligible/);
  state=act(state,'p0','EXECUTE',{targetId:'p1'});
  assert.equal(state.players[1].alive,false);
  assert.equal(state.presidentId,'p2');
  assert.equal(getPlayerView(state,'p0').players[1].role,undefined);
  assert.deepEqual(getPlayerView(state,'p0').revealedRoles,[]);
  assert.deepEqual(getPlayerView(state,'p1').private.hand,[]);
  assert.throws(()=>act(state,'p1','NOMINATE',{targetId:'p0'}),/living player/);
  state=act(state,'p2','NOMINATE',{targetId:'p0'});
  assert.throws(()=>act(state,'p1','VOTE',{approve:true}),/living player/);
  for (const player of state.players.filter(p=>p.alive)) state=act(state,player.id,'VOTE',{approve:true});
  assert.equal(state.phase,'president-discard');
  assert.equal(Object.keys(state.lastVote.votes).length,6);
});

test('executing Hitler immediately awards the Liberals the game',() => {
  let state=executive(7,'execute');
  state=act(state,'p0','EXECUTE',{targetId:'p6'});
  assert.equal(state.phase,'gameover'); assert.equal(state.winner,'liberal');
  assert.match(state.winReason,/Hitler was executed/);
});

test('veto unlocks only at five Fascist policies and a refusal forces enactment',() => {
  let state=elect(game()); state=act(state,'p0','DISCARD',{index:0});
  assert.throws(()=>act(state,'p1','REQUEST_VETO'),/five Fascist/);
  state.policies.fascist=5;
  const hand=[...state.secret.chancellorHand];
  state=act(state,'p1','REQUEST_VETO');
  assert.equal(state.phase,'veto');
  assert.deepEqual(getPlayerView(state,'p0').private.hand,[]);
  assert.deepEqual(getPlayerView(state,'p1').private.hand,hand);
  assert.throws(()=>act(state,'p1','VETO',{approve:true}),/President/);
  state=act(state,'p0','VETO',{approve:false});
  assert.equal(state.phase,'chancellor-enact'); assert.equal(state.vetoRejected,true);
  assert.throws(()=>act(state,'p1','REQUEST_VETO'),/already rejected/);
  assert.deepEqual(state.secret.chancellorHand,hand);
  state=act(state,'p1','ENACT',{index:0});
  assert.ok(['nomination','gameover'].includes(state.phase));
});

test('accepted veto discards both policies, advances tracker and retains elected term limits',() => {
  let state=game(); state.policies.fascist=5; state.tracker=1;
  state=elect(state); state=act(state,'p0','DISCARD',{index:0});
  state=act(state,'p1','REQUEST_VETO'); state=act(state,'p0','VETO',{approve:true});
  assert.equal(state.tracker,2);
  assert.equal(state.phase,'nomination');
  assert.deepEqual(state.lastGovernment,{presidentId:'p0',chancellorId:'p1'});
  assert.equal(state.secret.discard.length,3);
  assert.equal(state.policies.fascist,5);
  assert.equal(state.secret.chancellorHand.length,0);
});

test('third tracker advance through veto enacts chaos and clears term limits',() => {
  let state=game(); state.policies.fascist=5; state.tracker=2;
  state=elect(state); state=act(state,'p0','DISCARD',{index:0});
  topPolicy(state,'liberal');
  state=act(state,'p1','REQUEST_VETO'); state=act(state,'p0','VETO',{approve:true});
  assert.equal(state.policies.liberal,1); assert.equal(state.policies.fascist,5);
  assert.equal(state.tracker,0); assert.equal(state.lastGovernment,null);
  assert.equal(state.phase,'nomination'); assert.equal(state.power,null);
});

test('an empty draw pile is safely replenished before veto-triggered chaos',() => {
  let state=game(); state.policies.fascist=5; state.tracker=2;
  state.secret.deck=['liberal','liberal','liberal'];
  state.secret.discard=[...Array(3).fill('liberal'),...Array(6).fill('fascist')];
  state=elect(state); state=act(state,'p0','DISCARD',{index:0});
  assert.equal(state.secret.deck.length,0);
  state=act(state,'p1','REQUEST_VETO'); state=act(state,'p0','VETO',{approve:true});
  assert.deepEqual(policyInventory(state),{liberal:6,fascist:11});
  assert.equal(state.tracker,0);
  assert.ok(state.secret.deck.length>=3);
});

test('chaos policies also satisfy both policy victory conditions',() => {
  for (const [party,count] of [['liberal',4],['fascist',5]]) {
    let state=game(); state.policies[party]=count; state.tracker=2; topPolicy(state,party);
    state=elect(state,{approve:false});
    assert.equal(state.winner,party); assert.equal(state.phase,'gameover');
  }
});

test('deterministic full games preserve all policy tiles and secret projections across every player count',() => {
  for (let count=5;count<=10;count++) {
    const rng=seeded(count*163);
    let state=createGame(roster(count),{rng}), actions=0;
    while (state.phase!=='gameover' && actions<500) {
      const president=state.presidentId;
      let actor=president, type, fields={};
      if (state.phase==='nomination') { type='NOMINATE'; fields.targetId=getPlayerView(state,president).eligibleChancellors[0]; }
      else if (state.phase==='voting') { type='VOTE'; actor=state.players.find(p=>p.alive&&!state.secret.votes.some(v=>v.id===p.id)).id; fields.approve=true; }
      else if (state.phase==='president-discard') { type='DISCARD'; fields.index=0; }
      else if (state.phase==='chancellor-enact') { type='ENACT'; actor=state.chancellorId; fields.index=0; }
      else if (state.phase==='power') {
        if (state.powerResolved) type='CONTINUE';
        else if (state.power==='peek') type='PEEK';
        else { type={investigate:'INVESTIGATE','special-election':'SPECIAL_ELECTION',execute:'EXECUTE'}[state.power]; fields.targetId=getPlayerView(state,president).eligibleTargets[0]; }
      } else assert.fail(`Unexpected phase ${state.phase}`);
      state=act(state,actor,type,fields,rng); actions++;
      assert.deepEqual(policyInventory(state),{liberal:6,fascist:11});
      assert.ok(state.tracker>=0 && state.tracker<=2);
      for (const player of state.players) {
        const view=getPlayerView(state,player.id);
        assert.equal(view.secret,undefined);
        assert.equal(view.deck,undefined);
        assert.equal(view.discard,undefined);
        assert.equal(view.private.role,state.secret.roles.find(p=>p.id===player.id).role);
        if (state.phase!=='gameover') assert.deepEqual(view.revealedRoles,[]);
        if (view.private.hand.length) assert.ok((state.phase==='president-discard'&&player.id===state.presidentId)||(['chancellor-enact','veto'].includes(state.phase)&&player.id===state.chancellorId));
      }
    }
    assert.equal(state.phase,'gameover',`Game with ${count} players did not finish`);
    assert.ok(['liberal','fascist'].includes(state.winner));
  }
});
