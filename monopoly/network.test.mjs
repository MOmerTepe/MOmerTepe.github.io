import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RoomSession } from './network.js';

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
  constructor(id) {
    super();
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
      local.open = remote.open = true;
      remote.emit('open');
      local.emit('open');
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

function session() {
  const storage = new Map();
  globalThis.sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const states = [];
  const errors = [];
  const statuses = [];
  const value = new RoomSession({ onState: state => states.push(state), onError: message => errors.push(message), onStatus: status => statuses.push(status) });
  return { value, states, errors, statuses };
}

async function room(t) {
  const host = session();
  const guest = session();
  t.after(() => { guest.value.leave(); host.value.leave(); });
  const code = await host.value.host('Host');
  await guest.value.join(code, 'Guest');
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
