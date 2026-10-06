import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RoomSession } from './network.js';
import { DEFAULT_RULES, RULE_PRESETS } from './rules.js';
import { PLAYER_COLORS, TOKEN_OPTIONS, sanitizeProfile } from './cosmetics.js';
import { getIceConfig } from './ice-config.js';

// A deterministic transport double exercises the actual RoomSession and engine.
// Browser-to-browser WebRTC is verified separately; this suite tests authority,
// reconnect credentials, lobby admission, snapshots, and duplicate requests.
const peers = new Map();
let nextPeer = 0;
const flush = () => new Promise(resolve => setTimeout(resolve, 5));

class Connection extends EventEmitter {
  constructor(peer) { super(); this.peer = peer; this.open = false; }
  send(data) {
    const copy = structuredClone(data);
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
globalThis.location = { href: 'https://omertepe.com/monopoly/' };

function session(identity) {
  const storage = new Map();
  if (identity) storage.set('omertepe.estates.identity.v1', JSON.stringify(identity));
  globalThis.sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const states = [];
  const errors = [];
  const statuses = [];
  const reactions = [];
  const value = new RoomSession({ onState: state => states.push(state), onError: message => errors.push(message), onStatus: status => statuses.push(status), onReaction: event => reactions.push(event) });
  return { value, states, errors, statuses, reactions, storage };
}

async function room(t, { hostProfile = {}, guestProfile = {} } = {}) {
  const host = session();
  const guest = session();
  t.after(() => { guest.value.leave(); host.value.leave(); });
  const code = await host.value.host('Host', hostProfile);
  await guest.value.join(code, 'Guest', guestProfile);
  await flush();
  return { host, guest, code };
}

test('room creation, join, code normalization, snapshots, and private reconnect token', async t => {
  const { host, guest, code } = await room(t);
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(host.value.players.length, 2);
  assert.deepEqual(guest.value.state, host.value.state);
  assert.equal(host.value.shareUrl, `https://omertepe.com/monopoly/#room=${code}`);
  assert.ok(guest.states.every(state => !JSON.stringify(state).includes(host.value.identity.token)));
  assert.equal(guest.value.state.players[1].id, guest.value.playerId);
  guest.states[0].players[0].name = 'Tampered UI copy';
  assert.equal(host.value.state.players[0].name, 'Host');
});

test('only host starts, only the actual connection seat can act', async t => {
  const { host, guest } = await room(t);
  await assert.rejects(guest.value.startGame(), /Only the host/);
  await host.value.startGame();
  await flush();
  const before = structuredClone(host.value.state);
  await assert.rejects(guest.value.dispatch({ type: 'ROLL', playerId: host.value.playerId }), /turn/i);
  assert.deepEqual(host.value.state, before);
  await host.value.dispatch({ type: 'ROLL' });
  await flush();
  assert.deepEqual(guest.value.state, host.value.state);
});

test('retransmitted actions are acknowledged without applying twice', async t => {
  const { host, guest } = await room(t);
  await host.value.startGame();
  host.value.state.turn = 1;
  host.value.revision++;
  host.value._publish();
  await flush();
  const send = host.value._send.bind(host.value);
  let dropped = false;
  host.value._send = (conn, data) => {
    if (data.type === 'state' && data.ack && !dropped) { dropped = true; return true; }
    return send(conn, data);
  };
  const action = guest.value.dispatch({ type: 'ROLL' });
  await flush();
  assert.ok(dropped);
  const afterOnce = structuredClone(host.value.state);
  assert.equal(guest.value._pending.size, 1);
  for (const [id, request] of guest.value._pending) guest.value._sendRequest(id, request);
  await action;
  assert.deepEqual(host.value.state, afterOnce);
  assert.equal(guest.value._pending.size, 0);
});

test('in-game reconnect restores same seat, new players and wrong tokens are rejected', async t => {
  const { host, guest, code } = await room(t);
  await host.value.startGame();
  await flush();
  guest.value._hostConnection.close();
  assert.equal(host.value.players.find(player => player.id === guest.value.playerId).connected, false);
  guest.value._connectToHost();
  await flush();
  assert.equal(host.value.players.length, 2);
  assert.equal(host.value.players[1].connected, true);
  assert.deepEqual(guest.value.state, host.value.state);
  const stranger = session();
  t.after(() => stranger.value.leave());
  await assert.rejects(stranger.value.join(code, 'Late joiner'), /already started/);
  const hijacker = session();
  hijacker.value.playerId = guest.value.playerId;
  hijacker.value.identity.id = guest.value.playerId;
  t.after(() => hijacker.value.leave());
  await assert.rejects(hijacker.value.join(code, 'Pretend guest'), /another session/);
  assert.equal(host.value.players.length, 2);
});

test('disconnected lobby seats block start and can be removed', async t => {
  const { host, guest } = await room(t);
  const third = session();
  t.after(() => third.value.leave());
  await third.value.join(host.value.roomCode, 'Third');
  guest.value.leave();
  await flush();
  await assert.rejects(host.value.startGame(), /disconnected/);
  assert.equal(host.value.kick(host.value.playerId), false);
  assert.equal(host.value.kick(third.value.playerId), false);
  assert.equal(host.value.kick(guest.value.playerId), true);
  await host.value.startGame();
  assert.equal(host.value.state.players.length, 2);
});

test('malformed action and oversized name are handled', async t => {
  const { host, guest } = await room(t);
  await assert.rejects(guest.value.dispatch({ type: 'roll' }), /not valid/);
  await assert.rejects(guest.value.dispatch({ type: 'ROLL', extra: 'x'.repeat(5000) }), /not valid/);
  const another = session();
  t.after(() => another.value.leave());
  await another.value.join(host.value.roomCode.toLowerCase().replace('-', ' '), 'N'.repeat(100));
  assert.equal(host.value.players.at(-1).name.length, 24);
});

test('host rules are validated, synchronized, and are the only source for starting the game', async t => {
  const { host, guest } = await room(t);
  assert.deepEqual(host.value.state.settings, DEFAULT_RULES);
  assert.deepEqual(guest.value.state.settings, DEFAULT_RULES);
  await assert.rejects(guest.value.setRules({ startingCash: 5000 }), /Only the host/);
  await assert.rejects(guest.value._request('rules', { options: { startingCash: 5000 } }), /Only the host/);
  const before = structuredClone(host.value.state);
  for (const options of [{ startingCash: -1 }, { salary: '300' }, { auctions: 1 }, { unknownRule: true }, null]) {
    await assert.rejects(host.value.setRules(options), /Invalid|Unknown|valid/i);
    assert.deepEqual(host.value.state, before);
  }
  await host.value.setRules(RULE_PRESETS.quick);
  await host.value.setRules({ freeParkingPot: true });
  await flush();
  const expected = { ...RULE_PRESETS.quick, freeParkingPot: true };
  assert.deepEqual(guest.value.state.settings, expected);
  await host.value.startGame({ startingCash: 5000, salary: 500 });
  await flush();
  assert.deepEqual(host.value.state.settings, expected);
  assert.deepEqual(guest.value.state, host.value.state);
  assert.ok(host.value.state.players.every(player => player.cash === expected.startingCash));
  await assert.rejects(host.value.setRules(DEFAULT_RULES), /lobby/);
});

test('profiles sanitize to the fixed choices, propagate, and remain bound to the connection seat', async t => {
  const { host, guest } = await room(t, {
    hostProfile: { token: 'cat', color: PLAYER_COLORS[3] },
    guestProfile: { token: 'tea', color: PLAYER_COLORS[6] },
  });
  assert.deepEqual(TOKEN_OPTIONS.map(token => token.id), ['ferry', 'cat', 'tower', 'tulip', 'tea', 'tram']);
  assert.equal(host.value.players[0].token, 'cat');
  assert.equal(guest.value.players[1].token, 'tea');
  assert.ok(!JSON.stringify(host.value.state).includes(host.value.identity.token));
  assert.ok(!JSON.stringify(guest.value.state).includes(guest.value.identity.token));
  await host.value.updateProfile({ name: '  New\u0000 Host  ', token: 'tower' });
  await guest.value.updateProfile({ name: 'G'.repeat(100), token: 'tram', color: PLAYER_COLORS[3], id: host.value.playerId, cash: 10000 });
  await flush();
  assert.equal(host.value.players[0].name, 'New Host');
  assert.equal(host.value.players[1].name, 'G'.repeat(24));
  assert.equal(host.value.players[1].token, 'tram');
  assert.equal(host.value.players[1].color, host.value.players[0].color, 'matching colors are allowed');
  assert.equal(host.value.players[1].id, guest.value.playerId);
  assert.equal(host.value.players[1].cash, undefined);
  await guest.value._request('profile', { playerId: host.value.playerId, profile: { token: 'tulip' } });
  await flush();
  assert.equal(host.value.players[0].token, 'tower');
  assert.equal(host.value.players[1].token, 'tulip');
  await guest.value.updateProfile({ token: '<svg>', color: 'url(evil)', name: '\u0000' });
  await flush();
  assert.equal(host.value.players[1].token, 'tulip');
  assert.equal(host.value.players[1].color, PLAYER_COLORS[3]);
  await assert.rejects(guest.value._request('profile', { profile: [] }), /valid player profile/);
  assert.deepEqual(guest.value.state, host.value.state);
  assert.deepEqual(Object.keys(sanitizeProfile({ id: 'spoof', cash: 9999 })), ['name', 'token', 'color']);
});

test('rejoining preserves chosen appearance and current rules, and profiles freeze for the game', async t => {
  const { host, guest, code } = await room(t, { guestProfile: { token: 'cat', color: PLAYER_COLORS[7] } });
  await host.value.setRules(RULE_PRESETS.generous);
  guest.value.leave();
  await guest.value.join(code, 'Different name', { token: 'tower', color: PLAYER_COLORS[0] });
  await flush();
  assert.equal(host.value.players[1].name, 'Guest');
  assert.equal(guest.value.players[1].token, 'cat');
  assert.equal(guest.value.players[1].color, PLAYER_COLORS[7]);
  assert.deepEqual(guest.value.state.settings, RULE_PRESETS.generous);
  await host.value.startGame();
  await flush();
  assert.equal(guest.value.state.players[1].token, 'cat');
  const before = structuredClone(host.value.state);
  await assert.rejects(guest.value.updateProfile({ token: 'tea' }), /lobby/);
  await assert.rejects(host.value.updateProfile({ color: PLAYER_COLORS[0] }), /lobby/);
  await assert.rejects(guest.value._request('profile', { profile: { token: 'tea' } }), /locked/);
  assert.deepEqual(host.value.state, before);
  guest.value.leave();
  await guest.value.join(code, 'Another name', { token: 'ferry' });
  await flush();
  assert.equal(guest.value.state.players[1].token, 'cat');
  assert.deepEqual(guest.value.state.settings, RULE_PRESETS.generous);
});

test('quick reactions reach every player once, are seat-bound and rate limited without changing the game', async t => {
  const { host, guest, code } = await room(t);
  await host.value.startGame();
  await flush();
  const before = structuredClone(host.value.state);
  await guest.value._request('reaction', { playerId: host.value.playerId, reaction: 'wave' });
  await flush();
  assert.equal(host.reactions.length, 1);
  assert.deepEqual(guest.reactions, host.reactions);
  assert.equal(host.reactions[0].playerId, guest.value.playerId);
  assert.equal(host.reactions[0].reaction, 'wave');
  assert.deepEqual(Object.keys(host.reactions[0]), ['playerId', 'reaction', 'id']);
  await assert.rejects(guest.value.react('gg'), /two seconds/);
  await assert.rejects(guest.value.react('custom chat message'), /supported reaction/);
  await host.value.react('wow');
  await flush();
  assert.deepEqual(guest.reactions, host.reactions);
  assert.equal(guest.reactions.length, 2);
  guest.value._receiveFromHost({ protocol: 2, type: 'reaction', event: host.reactions[0] });
  assert.equal(guest.reactions.length, 2);
  await assert.rejects(host.value.react('lucky'), /two seconds/);
  assert.deepEqual(host.value.state, before);
  guest.value.leave();
  await guest.value.join(code, 'Guest');
  await assert.rejects(guest.value.react('gg'), /two seconds/);
});

test('protocol v2 isolates rooms and reports incompatible wire messages clearly', async t => {
  const { host, guest } = await room(t);
  assert.match(host.value._peer.id, /^omertepe-estates-v2-/);
  guest.value._hostConnection.send({ protocol: 1, type: 'hello' });
  await flush();
  assert.ok(guest.errors.some(message => /different game version.*Refresh/.test(message)));
  assert.equal(guest.value.state, null);
});

test('six simultaneous guest attempts fill five seats and reject only the seventh player', async t => {
  const host = session(), guests = Array.from({ length: 6 }, () => session());
  t.after(() => { guests.forEach(g => g.value.leave()); host.value.leave(); });
  const code = await host.value.host('Host');
  const results = await Promise.allSettled(guests.map((g, index) => g.value.join(code, `Guest ${index + 1}`)));
  await flush();
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 5);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /room is full/);
  assert.equal(host.value.players.length, 6);
  assert.equal(host.value.connectedPlayerIds.length, 6);
  for (const guest of guests.filter(g => g.value.state)) assert.deepEqual(guest.value.state, host.value.state);
});

test('copied host and guest sessionStorage get distinct lobby seats without evicting the originals', async t => {
  const { host, guest, code } = await room(t);
  const hostCopy = session(host.value.identity), guestCopy = session(guest.value.identity);
  t.after(() => { hostCopy.value.leave(); guestCopy.value.leave(); });
  const originalIdentity = { ...guest.value.identity };
  await hostCopy.value.join(code, 'Host tab copy');
  await guestCopy.value.join(code, 'Guest tab copy');
  await flush();
  assert.equal(host.value.players.length, 4);
  assert.equal(new Set(host.value.players.map(p => p.id)).size, 4);
  assert.ok(guest.value._hostConnection.open);
  assert.notEqual(hostCopy.value.playerId, host.value.playerId);
  assert.notEqual(guestCopy.value.playerId, guest.value.playerId);
  assert.deepEqual(guest.value.identity, originalIdentity);
  assert.deepEqual(JSON.parse(guestCopy.storage.get('omertepe.estates.identity.v1')), guestCopy.value.identity);
  assert.ok(!JSON.stringify(host.value.state).includes(guest.value.identity.token));
  assert.ok(!JSON.stringify(host.value.state).includes(guest.value.clientInstance));
  assert.deepEqual(guestCopy.value.state, host.value.state);
});

test('active different-instance game duplicates are rejected but a disconnected seat can reload', async t => {
  const { host, guest, code } = await room(t, { guestProfile: { token: 'cat' } });
  await host.value.setRules(RULE_PRESETS.quick);
  await host.value.startGame();
  const copy = session(guest.value.identity);
  t.after(() => copy.value.leave());
  await assert.rejects(copy.value.join(code, 'Copied tab'), /already active in another tab/);
  assert.ok(guest.value._hostConnection.open);
  assert.equal(host.value.players.length, 2);
  assert.deepEqual(host.value._peer.options.config, getIceConfig());
  assert.deepEqual(guest.value._peer.options.config, getIceConfig());
  guest.value.leave();
  await copy.value.join(code, 'Reloaded tab', { token: 'tower' });
  await flush();
  assert.equal(copy.value.players[1].token, 'cat');
  assert.equal(copy.value.players[1].name, 'Guest');
  assert.deepEqual(copy.value.state.settings, RULE_PRESETS.quick);
  assert.equal(host.value.players.length, 2);
});

test('same-instance reconnect can replace a stale channel and repeated hello is idempotent', async t => {
  const { host, guest } = await room(t);
  const oldConnection = guest.value._hostConnection;
  const oldRecord = [...host.value._connections.values()].find(record => record.playerId === guest.value.playerId);
  guest.value._hostConnection = null; // local ICE restarted while the host still sees the old channel as open
  guest.value._connectToHost();
  await flush();
  assert.ok(oldConnection.closed);
  assert.ok(guest.value._hostConnection.open);
  assert.equal(host.value.players.length, 2);
  const revision = host.value.revision;
  for (let i = 0; i < 3; i++) guest.value._send(guest.value._hostConnection, {
    type: 'hello', playerId: guest.value.playerId, token: guest.value.identity.token,
    clientInstance: guest.value.clientInstance, profile: { name: 'Do not rename', token: 'tower' },
  });
  await flush();
  assert.equal(host.value.revision, revision);
  assert.equal(host.value.players[1].name, 'Guest');
  host.value._hello(oldRecord, {
    playerId: guest.value.playerId, token: guest.value.identity.token,
    clientInstance: guest.value.clientInstance,
  });
  assert.ok(guest.value._hostConnection.open, 'a stale connection cannot reclaim the new connection');
  assert.equal(host.value.revision, revision);
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
  await host.value.startGame();
  await host.value.dispatch({ type: 'ROLL' });
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
  const { RoomSession: LoaderSession } = await import('./network.js?library-timeout-test');
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
