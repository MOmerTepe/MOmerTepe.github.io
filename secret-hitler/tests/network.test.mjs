import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RoomSession } from '../network.js';
import { getPlayerView } from '../engine.js';
import { getIceConfig } from '../../monopoly/ice-config.js';

// A deterministic transport double exercises the actual RoomSession and engine.
// Browser-to-browser WebRTC is verified separately; this suite tests authority,
// reconnect credentials, lobby admission, snapshots, and duplicate requests.
const peers = new Map();
let nextPeer = 0;
const flush = () => new Promise(resolve => setTimeout(resolve, 5));

class Connection extends EventEmitter {
  constructor(peer) { super(); this.peer = peer; this.open = false; this.sent = []; }
  send(data) {
    const copy = structuredClone(data);
    this.sent.push(copy);
    queueMicrotask(() => { if (this.remote?.open) this.remote.emit('data', copy); });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit('close');
    this.remote?.close();
  }
}

class FakePeer extends EventEmitter {
  constructor(id, options) {
    super();
    this.options = typeof id === 'string' ? options : id;
    this.id = typeof id === 'string' ? id : `auto${++nextPeer}`;
    this.destroyed = false;
    this.disconnected = false;
    this.links = [];
    if (peers.has(this.id)) queueMicrotask(() => this.emit('error', { type: 'unavailable-id' }));
    else { peers.set(this.id, this); queueMicrotask(() => this.emit('open', this.id)); }
  }
  connect(id) {
    const local = new Connection(id);
    this.links.push(local);
    const target = peers.get(id);
    if (!target) { queueMicrotask(() => this.emit('error', { type: 'peer-unavailable' })); return local; }
    const remote = new Connection(this.id);
    local.remote = remote;
    remote.remote = local;
    target.links.push(remote);
    queueMicrotask(() => {
      target.emit('connection', remote);
      const open = () => {
        if (local.closed || remote.closed) return;
        local.open = remote.open = true;
        remote.emit('open');
        local.emit('open');
      };
      if (FakePeer.connectionDelay) setTimeout(open, FakePeer.connectionDelay);
      else open();
    });
    return local;
  }
  reconnect() { this.disconnected = false; this.emit('open', this.id); }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (peers.get(this.id) === this) peers.delete(this.id);
    this.links.forEach(conn => conn.close());
    this.emit('close');
  }
}

globalThis.Peer = FakePeer;
globalThis.location = { href: 'https://omertepe.com/secret-hitler/' };

function session(identity) {
  const storage = new Map();
  if (identity) storage.set('omertepe.secret-hitler.identity.v1', JSON.stringify(identity));
  globalThis.sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const states = [];
  const errors = [];
  const statuses = [];
  const value = new RoomSession({ onState: state => states.push(state), onError: message => errors.push(message), onStatus: status => statuses.push(status) });
  return { value, states, errors, statuses, storage };
}

async function room(t, count = 5) {
  const all = Array.from({ length: count }, () => session());
  const [host, ...guests] = all;
  t.after(() => { guests.forEach(guest => guest.value.leave()); host.value.leave(); });
  const code = await host.value.host('Host');
  await Promise.all(guests.map((guest, i) => guest.value.join(code, `Guest ${i + 1}`)));
  await flush();
  return { host, guests, all, code };
}

function gameView(view) {
  const { roomCode, hostId, connectedPlayerIds, chat, ...game } = view;
  return game;
}

function assertPrivateViews({ host, all }) {
  for (const player of all) {
    assert.deepEqual(gameView(player.value.state), getPlayerView(host.value._game, player.value.playerId));
    assert.equal(player.value.state.deck, undefined);
    assert.equal(player.value.state.votes, undefined);
    assert.equal(player.value.state.roles, undefined);
    assert.equal(player.value.state.secret, undefined);
    assert.ok(player.value.state.players.every(p => !('role' in p) && !('party' in p) && !('hand' in p)));
    if (player !== host) {
      assert.equal(player.value._game, null);
      const snapshots = player.value._hostConnection.remote.sent.filter(message => message.type === 'state');
      const wire = snapshots.at(-1);
      assert.deepEqual(wire.state, player.value.state);
      assert.deepEqual(Object.keys(wire).sort(), ['protocol', 'type', 'state', 'roomCode', 'hostId', 'roster', 'revision', ...(wire.ack ? ['ack'] : [])].sort());
      for (const publicPlayer of wire.roster) assert.deepEqual(Object.keys(publicPlayer).sort(), ['id', 'name', 'connected', 'alive'].sort());
      assert.ok(!JSON.stringify(wire).includes(player.value.identity.token));
      for (const snapshot of snapshots) {
        assert.equal(snapshot.state.secret, undefined);
        assert.equal(snapshot.state.deck, undefined);
        assert.equal(snapshot.state.roles, undefined);
        if (snapshot.state.phase === 'lobby') continue;
        assert.equal(snapshot.state.private.role, getPlayerView(host.value._game, player.value.playerId).private.role);
        if (snapshot.state.private.hand.length) {
          const officerId = snapshot.state.phase === 'president-discard' ? snapshot.state.presidentId : snapshot.state.chancellorId;
          assert.equal(officerId, player.value.playerId, 'no intermediate wire snapshot contains a different officer’s hand');
        }
      }
    }
  }
}

const act = (player, type, extra = {}) => player.value.action({ type, round: player.value.state.round, ...extra });
const participant = (group, id) => group.all.find(player => player.value.playerId === id);

test('lobby state, separate room namespace and identity storage, and explicit ICE configuration', async t => {
  const { host, guests, code } = await room(t);
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.match(host.value._peer.id, /^omtepe-secret-hitler-v1-/);
  assert.ok(host.storage.has('omertepe.secret-hitler.identity.v1'));
  assert.ok(!host.storage.has('omertepe.estates.identity.v1'));
  assert.equal(host.value.state.phase, 'lobby');
  assert.equal(host.value.state.players.length, 5);
  assert.ok(host.value.state.players.every(p => p.alive && Object.keys(p).length === 3));
  assert.equal(host.value.shareUrl, `https://omertepe.com/secret-hitler/#room=${code}`);
  assert.deepEqual(host.value.state.connectedPlayerIds, host.value.connectedPlayerIds);
  assert.deepEqual(host.value._peer.options.config, getIceConfig());
  assert.deepEqual(guests[0].value._peer.options.config, getIceConfig());
  assert.deepEqual(guests[0].value.state, host.value.state);
  guests[0].states[0].players[0].name = 'UI mutation';
  assert.equal(host.value.state.players[0].name, 'Host');
});

test('ten simultaneous guest attempts fill nine seats and reject only the eleventh player', async t => {
  const host = session(), guests = Array.from({ length: 10 }, () => session());
  t.after(() => { guests.forEach(guest => guest.value.leave()); host.value.leave(); });
  const code = await host.value.host('Host');
  const results = await Promise.allSettled(guests.map((guest, i) => guest.value.join(code, `Guest ${i + 1}`)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 9);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /room is full/);
  assert.equal(host.value.players.length, 10);
  assert.equal(host.value.connectedPlayerIds.length, 10);
  await host.value.start();
  await flush();
  assertPrivateViews({ host, all: [host, ...guests.filter(guest => guest.value.state)] });
});

test('host and every guest receive only their own engine view, including callback and return values', async t => {
  const group = await room(t, 7);
  const returned = await group.host.value.start();
  await flush();
  assertPrivateViews(group);
  assert.deepEqual(returned, group.host.value.state);
  assert.deepEqual(group.host.states.at(-1), group.host.value.state);
  const before = structuredClone(group.host.value._game);
  group.host.value.state.private.role = 'mutated';
  returned.players[0].name = 'mutated';
  assert.deepEqual(group.host.value._game, before, 'host UI never holds authority state references');
  group.host.value._publish();
  await flush();
  assertPrivateViews(group);
});

async function electGovernment(group) {
  const { host } = group;
  const president = participant(group, host.value.state.presidentId);
  const chancellorId = president.value.state.eligibleChancellors[0];
  await act(president, 'NOMINATE', { targetId: chancellorId });
  await Promise.all(group.all.map(player => act(player, 'VOTE', { approve: true })));
  await flush();
  return { president, chancellor: participant(group, chancellorId) };
}

test('simultaneous votes stay secret until everyone votes, and policy hands go only to the current officer', async t => {
  const group = await room(t);
  await group.host.value.start();
  await flush();
  const president = participant(group, group.host.value.state.presidentId);
  const chancellor = participant(group, president.value.state.eligibleChancellors[0]);
  await act(president, 'NOMINATE', { targetId: chancellor.value.playerId });
  await Promise.all(group.all.slice(0, 4).map((player, i) => act(player, 'VOTE', { approve: i !== 0 })));
  await flush();
  assertPrivateViews(group);
  for (const player of group.all) {
    assert.equal(player.value.state.phase, 'voting');
    assert.equal(player.value.state.votedPlayerIds.length, 4);
    assert.equal(player.value.state.lastVote, null);
    assert.deepEqual(player.value.state.private.hand, []);
    assert.ok(!JSON.stringify(player.value.state).includes('"approve"'), 'submitted Ja/Nein choices are absent from every view');
  }
  await act(group.all[4], 'VOTE', { approve: true });
  await flush();
  assertPrivateViews(group);
  assert.equal(group.host.value.state.phase, 'president-discard');
  assert.ok(group.host.value.state.lastVote);
  for (const player of group.all) assert.equal(player.value.state.private.hand.length, player === president ? 3 : 0);
  await act(president, 'DISCARD', { index: 1 });
  await flush();
  assertPrivateViews(group);
  assert.equal(group.host.value.state.phase, 'chancellor-enact');
  for (const player of group.all) assert.equal(player.value.state.private.hand.length, player === chancellor ? 2 : 0);
  await act(chancellor, 'ENACT', { index: 0 });
  await flush();
  assertPrivateViews(group);
  for (const player of group.all) assert.deepEqual(player.value.state.private.hand, []);
});

test('a guest cannot spoof the action actor or round, and replayed actions are applied once', async t => {
  const group = await room(t);
  const { host, guests } = group;
  await host.value.start();
  await flush();
  const president = participant(group, host.value.state.presidentId);
  const impostor = guests.find(guest => guest !== president);
  const nomination = { type: 'NOMINATE', targetId: president.value.state.eligibleChancellors[0], round: host.value.state.round, playerId: president.value.playerId };
  await assert.rejects(impostor.value._request('action', { playerId: president.value.playerId, action: nomination }), /Only the President/);
  await assert.rejects(president.value.action({ ...nomination, round: nomination.round - 1 }), /old round/);
  await assert.rejects(president.value.action({ type: 'NOMINATE', targetId: nomination.targetId }), /old round/);
  await assert.rejects(impostor.value.action({ type: 'vote' }), /not valid/);
  await assert.rejects(impostor.value.action({ type: 'VOTE', extra: 'x'.repeat(5000) }), /not valid/);
  await act(president, 'NOMINATE', { targetId: nomination.targetId });
  const guest = guests[0], send = host.value._send.bind(host.value);
  let dropped = false;
  host.value._send = (conn, data) => {
    if (data.type === 'state' && data.ack && !dropped) { dropped = true; return false; }
    return send(conn, data);
  };
  const voting = act(guest, 'VOTE', { approve: true });
  await flush();
  assert.ok(dropped);
  const revision = host.value._game.revision;
  for (const [id, pending] of guest.value._pending) guest.value._sendRequest(id, pending);
  await voting;
  assert.equal(host.value._game.revision, revision);
  assert.equal(host.value._game.secret.votes.filter(vote => vote.id === guest.value.playerId).length, 1);
  assertPrivateViews(group);
});

test('legislative officers and eliminated players cannot chat, including forged requests', async t => {
  const group = await room(t);
  await group.host.value.start();
  const { president, chancellor } = await electGovernment(group);
  const spectator = group.all.find(player => player !== president && player !== chancellor);
  for (const officer of [president, chancellor]) await assert.rejects(officer.value.chat('Secret agenda'), /cannot communicate/);
  await spectator.value.chat('Public discussion');
  await act(president, 'DISCARD', { index: 0 });
  for (const officer of [president, chancellor]) await assert.rejects(officer.value.chat('Secret agenda'), /cannot communicate/);
  // Exercise the unlocked veto branch while retaining a valid elected cabinet.
  group.host.value._game.policies.fascist = 5;
  group.host.value._publish();
  await flush();
  await act(chancellor, 'REQUEST_VETO');
  for (const officer of [president, chancellor]) await assert.rejects(officer.value.chat('Secret agenda'), /cannot communicate/);
  group.host.value._game.players.find(player => player.id === spectator.value.playerId).alive = false;
  group.host.value._publish();
  await flush();
  await assert.rejects(spectator.value.chat('Speaking from the grave'), /Eliminated players/);
  const guest = group.guests.find(player => player !== president && player !== chancellor);
  group.host.value._game.players.find(player => player.id === guest.value.playerId).alive = false;
  await assert.rejects(guest.value._request('chat', { playerId: president.value.playerId, text: 'Spoofed speaker' }), /Eliminated players/);
  assert.equal(group.host.value.state.chat.length, 1);
});

test('eliminated host and guests can discuss the result only after gameover', async t => {
  const { host, guests, all } = await room(t);
  await host.value.start();
  const guest = guests[0];
  for (const player of host.value._game.players) {
    if ([host.value.playerId, guest.value.playerId].includes(player.id)) player.alive = false;
  }
  host.value._publish();
  await flush();
  await assert.rejects(host.value.chat('Too early'), /Eliminated players/);
  await assert.rejects(guest.value.chat('Too early'), /Eliminated players/);
  assert.equal(host.value.state.chat.length, 0);

  host.value._game.phase = 'gameover';
  host.value._game.winner = 'liberal';
  host.value._game.winReason = 'Test game completed.';
  host.value._publish();
  await flush();
  await host.value.chat('Good game from the eliminated host');
  await guest.value.chat('Good game from the eliminated guest');
  await flush();
  for (const player of all) {
    assert.equal(player.value.state.phase, 'gameover');
    assert.deepEqual(player.value.state.chat.map(message => message.playerId), [host.value.playerId, guest.value.playerId]);
    assert.deepEqual(player.value.state.chat.map(message => message.text), ['Good game from the eliminated host', 'Good game from the eliminated guest']);
  }
  await assert.rejects(guest.value.chat('Still rate limited'), /one second/);
});

test('executive investigation and deck peek results are redacted separately for each connection', async t => {
  const group = await room(t, 7);
  await group.host.value.start();
  await flush();
  const president = participant(group, group.host.value.state.presidentId);
  const target = group.all.find(player => player !== president);
  group.host.value._game.phase = 'power';
  group.host.value._game.power = 'investigate';
  group.host.value._publish();
  await flush();
  await act(president, 'INVESTIGATE', { targetId: target.value.playerId });
  await flush();
  assertPrivateViews(group);
  for (const player of group.all) assert.equal(player.value.state.private.investigations.length, player === president ? 1 : 0);
  group.host.value._game.power = 'peek';
  group.host.value._game.powerResolved = false;
  group.host.value._publish();
  await flush();
  await act(president, 'PEEK');
  await flush();
  assertPrivateViews(group);
  for (const player of group.all) assert.equal(player.value.state.private.peek.length, player === president ? 3 : 0);
});

test('start is host-only, requires five connected players, and lobby removals are host-only', async t => {
  const { host, guests } = await room(t, 4);
  await assert.rejects(host.value.start(), /five players/);
  await assert.rejects(guests[0].value.start(), /Only the host/);
  await assert.rejects(guests[0].value._request('start', {}), /Only the host/);
  assert.equal(guests[0].value.kick(host.value.playerId), false);
  assert.equal(host.value.kick(host.value.playerId), false);
  const fifth = session();
  t.after(() => fifth.value.leave());
  await fifth.value.join(host.value.roomCode, 'Fifth');
  guests[0].value.leave();
  await assert.rejects(host.value.start(), /disconnected/);
  assert.equal(host.value.kick(guests[0].value.playerId), true);
  assert.equal(host.value.kick(fifth.value.playerId), true);
  await flush();
  assert.equal(fifth.value.state, null);
  assert.match(fifth.errors.at(-1), /removed your seat/);
  assert.equal(host.value.players.length, 3);
});

test('chat is seat-bound, bounded, rate-limited, sanitized, and retained for new lobby arrivals', async t => {
  const { host, guests, code } = await room(t);
  const guest = guests[0];
  await guest.value._request('chat', { text: '  Hello\u0000 friends  ', playerId: host.value.playerId, name: 'Impersonation' });
  assert.equal(host.value.state.chat[0].text, 'Hello  friends');
  assert.equal(host.value.state.chat[0].playerId, guest.value.playerId);
  assert.equal(host.value.state.chat[0].name, 'Guest 1');
  await assert.rejects(guest.value.chat('Again'), /one second/);
  for (const text of ['', '   ', 'x'.repeat(401), null, {}]) await assert.rejects(host.value.chat(text), /1–400/);
  await assert.rejects(guest.value.chat('x'.repeat(9000)), /1–400/);
  assert.ok(guest.value._hostConnection.open, 'oversized local chat input does not drop a valid connection');
  for (let i = 0; i < 82; i++) {
    host.value._lastChat.delete(host.value.playerId);
    await host.value.chat(`Message ${i}`);
  }
  assert.equal(host.value.state.chat.length, 80);
  assert.equal(host.value.state.chat[0].text, 'Message 2');
  const newcomer = session();
  t.after(() => newcomer.value.leave());
  await newcomer.value.join(code, 'Newcomer');
  assert.deepEqual(newcomer.value.state.chat, host.value.state.chat);
  assert.ok(host.value.state.chat.every(message => Object.keys(message).sort().join(',') === 'id,name,playerId,text'));
});

test('retransmitting a chat request acknowledges once without repeating the message', async t => {
  const { host, guests } = await room(t);
  const guest = guests[0], send = host.value._send.bind(host.value);
  let dropped = false;
  host.value._send = (conn, data) => {
    if (data.type === 'state' && data.ack && !dropped) { dropped = true; return false; }
    return send(conn, data);
  };
  const sending = guest.value.chat('One message');
  await flush();
  assert.ok(dropped);
  assert.equal(guest.value._pending.size, 1);
  for (const [id, pending] of guest.value._pending) guest.value._sendRequest(id, pending);
  await sending;
  assert.equal(host.value.state.chat.length, 1);
  assert.equal(guest.value.state.chat.length, 1);
});

test('copied host and guest tabs get new lobby identities without replacing active connections', async t => {
  const { host, guests, code } = await room(t);
  const original = guests[0];
  const copies = [session(host.value.identity), session(original.value.identity)];
  t.after(() => copies.forEach(copy => copy.value.leave()));
  await Promise.all(copies.map((copy, i) => copy.value.join(code, `Copy ${i}`)));
  assert.equal(host.value.players.length, 7);
  assert.equal(new Set(host.value.players.map(player => player.id)).size, 7);
  assert.ok(original.value._hostConnection.open);
  assert.notEqual(copies[0].value.playerId, host.value.playerId);
  assert.notEqual(copies[1].value.playerId, original.value.playerId);
  assert.deepEqual(JSON.parse(copies[1].storage.get('omertepe.secret-hitler.identity.v1')), copies[1].value.identity);
});

test('in-game reconnect restores only the returning seat, and new or active duplicate identities are rejected', async t => {
  const group = await room(t);
  const { host, guests, code } = group;
  await host.value.start();
  await flush();
  const guest = guests[0], before = structuredClone(guest.value.state.private);
  const copy = session(guest.value.identity), stranger = session(), hijacker = session();
  t.after(() => { copy.value.leave(); stranger.value.leave(); hijacker.value.leave(); });
  await assert.rejects(copy.value.join(code, 'Copy'), /already active in another tab/);
  await assert.rejects(stranger.value.join(code, 'Latecomer'), /already started/);
  hijacker.value.identity.id = guest.value.playerId;
  hijacker.value.playerId = guest.value.playerId;
  await assert.rejects(hijacker.value.join(code, 'Pretend guest'), /another session/);
  assert.ok(guest.value._hostConnection.open);
  assert.equal(host.value.kick(guest.value.playerId), false);
  guest.value.leave();
  await copy.value.join(code, 'Renamed on reconnect');
  assert.deepEqual(copy.value.state.private, before);
  assert.equal(copy.value.state.players.find(p => p.id === copy.value.playerId).name, 'Guest 1');
  assert.equal(host.value.players.length, 5);
  assertPrivateViews({ host, all: [host, copy, ...guests.slice(1)] });
});

test('same-instance channel replacement and repeated hello preserve the seat and do not republish', async t => {
  const { host, guests } = await room(t);
  const guest = guests[0], oldConnection = guest.value._hostConnection;
  const oldRecord = [...host.value._connections.values()].find(record => record.playerId === guest.value.playerId);
  guest.value._hostConnection = null;
  guest.value._connectToHost();
  await flush();
  assert.ok(oldConnection.closed);
  const revision = host.value.revision;
  for (let i = 0; i < 3; i++) guest.value._sendHello();
  await flush();
  assert.equal(host.value.revision, revision);
  host.value._hello(oldRecord, { playerId: guest.value.playerId, token: guest.value.identity.token, clientInstance: guest.value.clientInstance });
  assert.ok(guest.value._hostConnection.open);
  assert.equal(host.value.players.length, 5);
});

test('incompatible wire versions are rejected clearly', async t => {
  const { guests } = await room(t);
  guests[0].value._hostConnection.send({ protocol: 2, type: 'hello' });
  await flush();
  assert.match(guests[0].errors.at(-1), /different game version.*Refresh/);
  assert.equal(guests[0].value.state, null);
});

test('a terminal host Peer close clears the room and authority state and prevents further local actions', async t => {
  const { host } = await room(t);
  await host.value.start();
  const round = host.value.state.round;
  host.value._peer.destroy();
  assert.equal(host.value.state, null);
  assert.equal(host.value._game, null);
  assert.equal(host.value._peer, null);
  assert.equal(host.value.roomCode, '');
  assert.equal(host.value.isHost, false);
  assert.equal(host.value._active, false);
  assert.equal(host.value._timers.size, 0);
  assert.deepEqual(host.value.players, []);
  assert.equal(host.statuses.at(-1).kind, 'disconnected');
  assert.equal(host.statuses.at(-1).roomCode, '');
  assert.equal(host.statuses.at(-1).isHost, false);
  await assert.rejects(host.value.action({ type: 'VOTE', approve: true, round }), /Join a room first/);
  await assert.rejects(host.value.chat('This room is gone'), /Join a room first/);
});

test('disposing a failed host room-code attempt does not cancel a successful retry', async t => {
  let collide = true;
  class CollisionPeer extends FakePeer {
    constructor(id, options) {
      const failThisAttempt = typeof id === 'string' && collide;
      if (failThisAttempt) { collide = false; peers.set(id, {}); }
      super(id, options);
      if (failThisAttempt) peers.delete(id);
    }
  }
  globalThis.Peer = CollisionPeer;
  const host = session();
  t.after(() => { host.value.leave(); globalThis.Peer = FakePeer; });
  await host.value.host('Retrying host');
  assert.equal(host.value.state.phase, 'lobby');
  assert.equal(host.value.players.length, 1);
  assert.ok(host.value.roomCode);
  assert.ok(host.value._active);
  assert.equal(host.statuses.at(-1).kind, 'connected');
});


// Drain promise and queued transport callbacks without waiting on mocked clocks.
async function settleTransport() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

test('the first dropped welcome is recovered by hello retry without duplicate membership', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const host = session(), guest = session();
  t.after(() => { guest.value.leave(); host.value.leave(); });
  const code = await host.value.host('Host');
  const send = host.value._send.bind(host.value);
  let dropped = false;
  host.value._send = (conn, data) => {
    if (data.type === 'state' && !dropped) { dropped = true; return false; }
    return send(conn, data);
  };
  const joining = guest.value.join(code, 'Guest');
  await settleTransport();
  assert.ok(dropped);
  assert.equal(guest.value.state, null);
  const revision = host.value.revision;
  t.mock.timers.tick(2000);
  await settleTransport();
  await joining;
  assert.equal(host.value.revision, revision);
  assert.equal(host.value.players.length, 2);
  assert.deepEqual(guest.value.state, host.value.state);
  assert.equal(guest.value._helloTimer, null);
});

test('a nine-second browser negotiation succeeds rather than being cut off at 6.5 seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const host = session(), guest = session();
  t.after(() => { FakePeer.connectionDelay = 0; guest.value.leave(); host.value.leave(); });
  const code = await host.value.host('Host');
  FakePeer.connectionDelay = 9000;
  const joining = guest.value.join(code, 'Slow network');
  await settleTransport();
  t.mock.timers.tick(8000);
  await settleTransport();
  assert.ok(!guest.value._hostConnection.closed);
  t.mock.timers.tick(1000);
  await settleTransport();
  await joining;
  assert.equal(host.value.players.length, 2);
  assert.ok(guest.statuses.some(status => status.kind === 'negotiating'));
  assert.ok(guest.statuses.some(status => status.kind === 'handshaking'));
});

test('leaving during negotiation cancels the pending join and ignores a late channel open', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const host = session(), guest = session();
  t.after(() => { FakePeer.connectionDelay = 0; guest.value.leave(); host.value.leave(); });
  const code = await host.value.host('Host');
  FakePeer.connectionDelay = 9000;
  const joining = assert.rejects(guest.value.join(code, 'Cancelled player'), /cancelled/);
  await settleTransport();
  guest.value.leave();
  await joining;
  t.mock.timers.tick(10000);
  await settleTransport();
  assert.equal(guest.value.state, null);
  assert.equal(guest.value._peer, null);
  assert.equal(guest.value._timers.size, 0);
  assert.equal(guest.value._openingWait, null);
  assert.equal(guest.value._joinWait, null);
  assert.equal(host.value.players.length, 1);
});

test('a silent open channel is retried and the initial join eventually rejects with handshake evidence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const host = session(), guest = session();
  t.after(() => { guest.value.leave(); host.value.leave(); });
  const code = await host.value.host('Host');
  const send = host.value._send.bind(host.value);
  host.value._send = (conn, data) => data.type === 'state' ? false : send(conn, data);
  const joining = assert.rejects(guest.value.join(code, 'Guest'), /did not confirm your seat/);
  for (let i = 0; i < 61; i++) { await settleTransport(); t.mock.timers.tick(1000); }
  await settleTransport();
  await joining;
  assert.equal(guest.value._timers.size, 0);
  assert.equal(guest.value._joinWait, null);
  assert.equal(guest.value._hostConnection, null);
  assert.equal(host.value.players.length, 2, 'retries preserve the single reserved seat');
});

test('identity regeneration is bounded if a host keeps rejecting a fresh tab identity', async t => {
  const host = session(), guest = session();
  t.after(() => { guest.value.leave(); host.value.leave(); });
  const code = await host.value.host('Host');
  let attempts = 0;
  host.value._hello = record => { attempts++; host.value._send(record.conn, { type: 'identity-conflict' }); };
  await assert.rejects(guest.value.join(code, 'Guest'), /could not create a separate player identity/);
  assert.equal(attempts, 3);
  assert.equal(host.value.players.length, 1);
});

test('throwing UI callbacks cannot prevent room admission or confirmed snapshots', async t => {
  const host = session(), guest = session();
  t.after(() => { guest.value.leave(); host.value.leave(); });
  const code = await host.value.host('Host');
  const logged = t.mock.method(console, 'error', () => {});
  host.value.onState = () => { throw new Error('Host render failed'); };
  guest.value.onState = () => { throw new Error('Guest render failed'); };
  guest.value.onStatus = () => { throw new Error('Guest status failed'); };
  await guest.value.join(code, 'Guest');
  await host.value.chat('The room survives a failed render.');
  await flush();
  assert.equal(guest.value._joinWait, null);
  assert.deepEqual(guest.value.state, host.value.state);
  assert.ok(logged.mock.callCount() > 0);
});

test('a stalled library load times out, cleans up its script, and can be retried', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const host = session();
  const code = await host.value.host('Host');
  const originalDocument = globalThis.document;
  const scripts = [];
  globalThis.document = {
    createElement: () => ({ removed: false, remove() { this.removed = true; } }),
    head: { append(script) { scripts.push(script); } },
  };
  delete globalThis.Peer;
  const { RoomSession: LoaderSession } = await import('../network.js?library-timeout-test');
  globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
  const guest = new LoaderSession();
  t.after(() => { guest.leave(); host.value.leave(); globalThis.Peer = FakePeer; globalThis.document = originalDocument; });
  const failing = assert.rejects(guest.join(code, 'Guest'), /library took too long/);
  await settleTransport();
  assert.equal(scripts.length, 1);
  t.mock.timers.tick(15000);
  await settleTransport();
  await failing;
  assert.ok(scripts[0].removed);
  assert.equal(guest._timers.size, 0);
  assert.equal(guest._openingWait, null);
  const retry = guest.join(code, 'Guest');
  await settleTransport();
  assert.equal(scripts.length, 2);
  globalThis.Peer = FakePeer;
  scripts[1].onload();
  await retry;
  assert.equal(host.value.players.length, 2);
});
