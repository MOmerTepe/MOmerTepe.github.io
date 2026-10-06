import { createGame, applyAction } from './engine.js?v=20261006-4';
import { DEFAULT_RULES, normalizeRules } from './rules.js?v=20261006-4';
import { PLAYER_COLORS, sanitizeProfile } from './cosmetics.js?v=20261006-4';

// The page stays entirely static. PeerJS supplies signaling and WebRTC transport;
// the room creator's browser is the only authority allowed to change game state.
const PROTOCOL = 2;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'omertepe-estates-v2-';
const MAX_PLAYERS = 6;
const CONNECT_TIMEOUT = 20000;
const RECONNECT_GRACE = 90000;
const MAX_MESSAGE = 8192;
const REACTIONS = new Set(['wave', 'gg', 'wow', 'lucky']);
const REACTION_COOLDOWN = 2000;
let peerScript;

const clone = value => JSON.parse(JSON.stringify(value));
const randomHex = (size = 16) => [...crypto.getRandomValues(new Uint8Array(size))].map(n => n.toString(16).padStart(2, '0')).join('');
const randomRoom = () => [...crypto.getRandomValues(new Uint8Array(8))].map(n => ALPHABET[n % ALPHABET.length]).join('');
const randomNumber = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const displayCode = code => `${code.slice(0, 4)}-${code.slice(4)}`;
const normalCode = value => String(value || '').toUpperCase().replace(/[\s-]/g, '');
const validCode = code => code.length === 8 && [...code].every(c => ALPHABET.includes(c));
const validId = id => typeof id === 'string' && /^p[a-f0-9]{32}$/.test(id);
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const cleanName = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Player';
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const actionValid = action => {
  try { return isObject(action) && typeof action.type === 'string' && /^[A-Z_]{2,40}$/.test(action.type) && JSON.stringify(action).length <= 4096; }
  catch { return false; }
};

function getIdentity() {
  const key = 'omertepe.estates.identity.v1';
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved && validId(saved.id) && validToken(saved.token)) return saved;
  } catch { /* Storage may be disabled. This tab can still play. */ }
  const identity = { id: `p${randomHex()}`, token: randomHex(32) };
  try { sessionStorage.setItem(key, JSON.stringify(identity)); } catch { /* In-memory identity. */ }
  return identity;
}

function loadPeer() {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  if (!peerScript) peerScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/peerjs.min.js', import.meta.url).href;
    script.onload = () => globalThis.Peer ? resolve(globalThis.Peer) : reject(new Error('Online play could not load. Refresh the page and try again.'));
    script.onerror = () => { peerScript = null; script.remove(); reject(new Error('Online play could not load. Check your connection and try again.')); };
    document.head.append(script);
  });
  return peerScript;
}

function friendlyError(error) {
  const messages = {
    'browser-incompatible': 'This browser does not support online play. Try a recent Chrome, Firefox, Edge, or Safari.',
    'peer-unavailable': 'That room is unavailable. Check the code, keep the host tab open, and refresh both browsers to use the same game version.',
    'unavailable-id': 'That room code is already in use. Create a new room.',
    'network': 'The connection service is unavailable. Check your internet and try again.',
    'server-error': 'The connection service is unavailable. Try again in a moment.',
    'socket-error': 'The connection service is unavailable. Try again in a moment.',
    'socket-closed': 'The connection service closed. Reconnecting…',
    'webrtc': 'The browsers could not connect. Try another network or disable a restrictive VPN.',
  };
  return messages[error?.type] || error?.message || 'The room connection was interrupted. Please try again.';
}

export class RoomSession {
  constructor({ onState = () => {}, onStatus = () => {}, onError = () => {}, onReaction = () => {} } = {}) {
    this.onState = onState;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onReaction = onReaction;
    this.identity = getIdentity();
    this.playerId = this.identity.id;
    this.state = null;
    this.roomCode = '';
    this.isHost = false;
    this.revision = -1;
    this._roster = new Map();
    this._connections = new Map();
    this._pending = new Map();
    this._seen = new Map();
    this._lastReaction = new Map();
    this._reactionSeen = new Set();
    this._timers = new Set();
    this._generation = 0;
    this._active = false;
    this._retryTimer = null;
    this._signalingRetry = null;
    this._hostConnection = null;
    this._connecting = false;
    this._offlineSince = null;
    this._lastHostMessage = 0;
  }

  get players() { return [...this._roster.values()].map(({ id, name, token, color, connected }) => ({ id, name, token, color, connected })); }
  get connectedPlayerIds() { return this.players.filter(p => p.connected).map(p => p.id); }
  get shareUrl() {
    const url = new URL(location.href);
    url.hash = `room=${this.roomCode}`;
    return url.href;
  }

  _status(kind, message) {
    this.onStatus({ kind, message, roomCode: this.roomCode, isHost: this.isHost, playerId: this.playerId, connectedPlayerIds: this.connectedPlayerIds });
  }

  _later(callback, delay) {
    const timer = setTimeout(() => { this._timers.delete(timer); callback(); }, delay);
    this._timers.add(timer);
    return timer;
  }

  _cancel(timer) { clearTimeout(timer); this._timers.delete(timer); }

  async _makePeer(id, generation) {
    const Peer = await loadPeer();
    if (generation !== this._generation) throw new Error('Connection cancelled.');
    // Keep PeerJS's default STUN + TURN configuration. Do not replace it with STUN-only.
    const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    this._peer = peer;
    return new Promise((resolve, reject) => {
      let settled = false;
      const opening = { reject };
      this._openingWait = opening;
      const clearOpening = () => { if (this._openingWait === opening) this._openingWait = null; };
      const timeout = this._later(() => {
        if (settled) return;
        settled = true;
        clearOpening();
        reject(new Error('The connection service did not respond. Check your internet and try again.'));
      }, CONNECT_TIMEOUT);
      peer.on('open', () => {
        if (generation !== this._generation) return;
        if (!settled) { settled = true; clearOpening(); this._cancel(timeout); resolve(peer); }
        else if (this.isHost) this._status('connected', 'Room connection restored.');
        else if (!this._hostConnection?.open) this._connectToHost();
      });
      peer.on('connection', conn => {
        if (generation !== this._generation || !this.isHost) { conn.close(); return; }
        this._acceptConnection(conn);
      });
      peer.on('error', error => {
        if (generation !== this._generation) return;
        if (!settled) { settled = true; clearOpening(); this._cancel(timeout); reject(new Error(friendlyError(error))); return; }
        if (!this.isHost && !this._hostConnection?.open) {
          this._connecting = false;
          this._scheduleGuestRetry();
        } else if (error.type !== 'peer-unavailable') {
          this._status('signaling-offline', 'The connection service is reconnecting. Existing players can keep playing.');
          this._reconnectSignaling();
        }
      });
      peer.on('disconnected', () => {
        if (generation !== this._generation) return;
        this._status('signaling-offline', 'The connection service is reconnecting. Existing players can keep playing.');
        this._reconnectSignaling();
      });
      peer.on('close', () => {
        if (generation !== this._generation || !this._active) return;
        if (!this.isHost) this._guestOffline();
        else this._status('disconnected', 'The room connection closed. Create a new room to play again.');
      });
    });
  }

  _reconnectSignaling() {
    if (this._signalingRetry || !this._active || this._peer?.destroyed) return;
    this._signalingRetry = this._later(() => {
      this._signalingRetry = null;
      if (this._peer?.disconnected && !this._peer.destroyed) {
        try { this._peer.reconnect(); } catch { /* Retry below. */ }
        this._reconnectSignaling();
      }
    }, 3500);
  }

  async host(name, profile = {}) {
    this.leave(false);
    this.isHost = true;
    this._active = true;
    this._name = cleanName(name);
    this._profile = sanitizeProfile({ ...profile, name: this._name });
    const generation = this._generation;
    this._status('connecting', 'Creating your room…');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        this._code = randomRoom();
        this.roomCode = displayCode(this._code);
        try { await this._makePeer(`${PREFIX}${this._code}`, generation); break; }
        catch (error) {
          this._peer?.destroy();
          if (!error.message.includes('already in use') || attempt === 2) throw error;
        }
      }
      if (generation !== this._generation) throw new Error('Connection cancelled.');
      this._roster.set(this.playerId, { id: this.playerId, reconnectToken: this.identity.token, ...this._profile, connected: true });
      this.state = { kind: 'lobby', players: this.players, hostId: this.playerId, roomCode: this.roomCode, settings: normalizeRules(DEFAULT_RULES) };
      this.revision = 0;
      this._publish();
      this._heartbeat();
      this._status('connected', 'Room open. Share the code with your friends.');
      return this.roomCode;
    } catch (error) {
      if (generation === this._generation) { this.leave(false); this.onError(error.message); }
      throw error;
    }
  }

  async join(code, name, profile = {}) {
    const normalized = normalCode(code);
    if (!validCode(normalized)) {
      const error = new Error('Enter the eight-character room code, such as ABCD-2345.');
      this.onError(error.message);
      throw error;
    }
    this.leave(false);
    this._active = true;
    this._code = normalized;
    this.roomCode = displayCode(normalized);
    this._name = cleanName(name);
    this._profile = sanitizeProfile({ ...profile, name: this._name });
    const generation = this._generation;
    this._status('connecting', 'Finding your room…');
    try {
      await this._makePeer(null, generation);
      if (generation !== this._generation) throw new Error('Connection cancelled.');
      return await new Promise((resolve, reject) => {
        const timeout = this._later(() => {
          if (!this._joinWait) return;
          this._joinWait = null;
          const error = new Error('Could not reach the room. Check the code, keep the host tab open, or try another network.');
          this.leave(false);
          this.onError(error.message);
          reject(error);
        }, CONNECT_TIMEOUT);
        this._joinWait = { resolve, reject, timeout };
        this._connectToHost();
      });
    } catch (error) {
      if (generation === this._generation) { this.leave(false); this.onError(error.message); }
      throw error;
    }
  }

  _connectToHost() {
    if (!this._active || this.isHost || this._connecting || this._hostConnection?.open || !this._peer || this._peer.destroyed || this._peer.disconnected) return;
    this._connecting = true;
    const generation = this._generation;
    const conn = this._peer.connect(`${PREFIX}${this._code}`, { reliable: true, serialization: 'json', metadata: { protocol: PROTOCOL } });
    this._hostConnection = conn;
    const timeout = this._later(() => {
      if (generation === this._generation && this._hostConnection === conn && !conn.open) {
        this._connecting = false;
        conn.close();
        this._scheduleGuestRetry();
      }
    }, 6500);
    conn.on('open', () => {
      if (generation !== this._generation || this._hostConnection !== conn) { conn.close(); return; }
      this._cancel(timeout);
      this._connecting = false;
      this._lastHostMessage = Date.now();
      this._send(conn, { type: 'hello', playerId: this.playerId, token: this.identity.token, profile: this._profile });
    });
    conn.on('data', data => {
      if (generation === this._generation && this._hostConnection === conn) this._receiveFromHost(data);
    });
    const closed = () => {
      this._cancel(timeout);
      if (generation !== this._generation || this._hostConnection !== conn) return;
      this._hostConnection = null;
      this._connecting = false;
      this._guestOffline();
    };
    conn.on('close', closed);
    conn.on('error', closed);
  }

  _guestOffline() {
    if (!this._active || this.isHost) return;
    this._offlineSince ??= Date.now();
    this._status('reconnecting', 'Host connection lost. Reconnecting for up to 90 seconds; keep this tab open.');
    this._scheduleGuestRetry();
  }

  _scheduleGuestRetry() {
    if (this._retryTimer || !this._active || this.isHost || this._hostConnection?.open) return;
    this._offlineSince ??= Date.now();
    if (Date.now() - this._offlineSince > RECONNECT_GRACE || this._peer?.destroyed) {
      this._status('disconnected', 'The host is offline. Your seat is reserved while the host keeps the room open; rejoin with the same code to try again.');
      for (const request of this._pending.values()) request.reject(new Error('The host is offline. Rejoin the room before taking an action.'));
      this._pending.clear();
      return;
    }
    this._retryTimer = this._later(() => {
      this._retryTimer = null;
      this._connectToHost();
      if (!this._hostConnection?.open) this._scheduleGuestRetry();
    }, 3000);
  }

  _acceptConnection(conn) {
    if (this._connections.size >= MAX_PLAYERS + 3) { conn.close(); return; }
    const record = { conn, playerId: null, lastMessage: Date.now(), window: Date.now(), count: 0 };
    this._connections.set(conn, record);
    const generation = this._generation;
    const timeout = this._later(() => { if (!record.playerId) conn.close(); }, 8000);
    conn.on('data', data => {
      if (generation !== this._generation) return;
      record.lastMessage = Date.now();
      if (record.lastMessage - record.window > 1000) { record.window = record.lastMessage; record.count = 0; }
      if (isObject(data) && Number.isInteger(data.protocol) && data.protocol !== PROTOCOL) {
        this._send(conn, { type: 'rejected', message: 'This room uses a different game version. Refresh your browser and ask the host to refresh before creating a new room.' });
        this._later(() => conn.close(), 200);
        return;
      }
      if (++record.count > 30 || !this._validMessage(data)) { conn.close(); return; }
      if (!record.playerId) {
        if (data.type !== 'hello') { conn.close(); return; }
        this._cancel(timeout);
        this._hello(record, data);
        return;
      }
      if (data.type === 'ping') this._send(conn, { type: 'pong' });
      else if (['action', 'profile', 'reaction'].includes(data.type)) this._guestAction(record, data);
      else if (data.type === 'rules') this._send(conn, { type: 'error', ack: data.id, message: 'Only the host can change the room rules.' });
      else if (data.type === 'sync') this._sendState(conn);
    });
    const closed = () => {
      this._cancel(timeout);
      if (generation !== this._generation) return;
      this._connections.delete(conn);
      const player = this._roster.get(record.playerId);
      if (!player || player.conn !== conn) return;
      player.connected = false;
      player.conn = null;
      player.offlineAt = Date.now();
      this.revision++;
      this._publish();
      this._status('player-disconnected', `${player.name} disconnected. Their seat is reserved for rejoining.`);
      this._later(() => {
        if (!player.connected && this._roster.get(player.id) === player) this._status('player-offline', `${player.name} is still offline. ${this.state?.kind === 'lobby' ? 'Remove their seat or wait for them to rejoin.' : 'Their turn will wait until they rejoin.'}`);
      }, RECONNECT_GRACE);
    };
    conn.on('close', closed);
    conn.on('error', () => { conn.close(); closed(); });
  }

  _hello(record, data) {
    const reject = message => { this._send(record.conn, { type: 'rejected', message }); this._later(() => record.conn.close(), 200); };
    if (!validId(data.playerId) || !validToken(data.token) || data.playerId === this.playerId) { reject('This player session is already hosting the room. Open another browser to join as a different player.'); return; }
    let player = this._roster.get(data.playerId);
    if (player) {
      if (player.reconnectToken !== data.token) { reject('That seat belongs to another session. Rejoin from your original browser tab.'); return; }
      const oldConnection = player.conn;
      player.conn = record.conn;
      oldConnection?.close();
      player.connected = true;
      player.offlineAt = null;
    } else {
      if (this.state?.kind !== 'lobby') { reject('This game has already started. Ask the host to create a new room after the game.'); return; }
      if (this._roster.size >= MAX_PLAYERS) { reject('This room is full. Up to six players can join.'); return; }
      const profile = sanitizeProfile(data.profile, { color: PLAYER_COLORS[this._roster.size % PLAYER_COLORS.length] });
      player = { id: data.playerId, reconnectToken: data.token, ...profile, connected: true, conn: record.conn };
      this._roster.set(player.id, player);
    }
    record.playerId = player.id;
    this.revision++;
    this._publish();
    this._status('player-connected', `${player.name} joined the room.`);
  }

  _validMessage(data) {
    try { return isObject(data) && data.protocol === PROTOCOL && typeof data.type === 'string' && JSON.stringify(data).length <= MAX_MESSAGE; }
    catch { return false; }
  }

  _send(conn, data) {
    if (!conn?.open) return false;
    try { conn.send({ protocol: PROTOCOL, ...data }); return true; }
    catch { return false; }
  }

  _sendState(conn, ack) {
    this._send(conn, { type: 'state', state: this.state, roomCode: this.roomCode, hostId: this.playerId, roster: this.players, revision: this.revision, ...(ack ? { ack } : {}) });
  }

  _publish() {
    if (this.state?.kind === 'lobby') this.state.players = this.players;
    this.onState(clone(this.state));
    for (const record of this._connections.values()) if (record.playerId) this._sendState(record.conn);
  }

  _receiveFromHost(data) {
    // State snapshots may be larger than guest action messages as the log grows.
    if (!isObject(data) || data.protocol !== PROTOCOL || typeof data.type !== 'string') return;
    this._lastHostMessage = Date.now();
    if (data.type === 'rejected') {
      const message = typeof data.message === 'string' ? data.message.slice(0, 240) : 'The room declined the connection.';
      const wait = this._joinWait;
      this._joinWait = null;
      if (wait) { this._cancel(wait.timeout); wait.reject(new Error(message)); }
      this.leave(false);
      this.onError(message);
      this._status('disconnected', message);
      return;
    }
    if (data.type === 'error') {
      const request = this._pending.get(data.ack);
      if (request) { this._pending.delete(data.ack); request.reject(new Error(String(data.message || 'That action is not available.').slice(0, 240))); }
      this.onError(String(data.message || 'That action is not available.').slice(0, 240));
      return;
    }
    if (data.type === 'closing') {
      const message = 'The host closed this room. Create or join a new room to play again.';
      this.leave(false);
      this._status('disconnected', message);
      return;
    }
    if (data.type === 'reaction') { this._deliverReaction(data.event); return; }
    if (data.type !== 'state' || !isObject(data.state) || !Number.isSafeInteger(data.revision) || !Array.isArray(data.roster) || data.roster.length > MAX_PLAYERS) return;
    if (data.revision >= this.revision) {
      this.revision = data.revision;
      this.state = clone(data.state);
      this._roster = new Map(data.roster.filter(p => isObject(p) && validId(p.id)).map(p => [p.id, { id: p.id, ...sanitizeProfile(p), connected: !!p.connected }]));
      this.onState(clone(this.state));
    }
    if (data.ack) {
      const request = this._pending.get(data.ack);
      if (request) { this._pending.delete(data.ack); request.resolve(clone(this.state)); }
    }
    if (this._joinWait) {
      const wait = this._joinWait;
      this._joinWait = null;
      this._cancel(wait.timeout);
      this._heartbeat();
      wait.resolve(this.roomCode);
      this._status('connected', 'Connected to the room.');
    } else if (this._offlineSince !== null) {
      this._status('connected', 'Reconnected. Your game is up to date.');
    }
    this._offlineSince = null;
    this._cancel(this._retryTimer);
    this._retryTimer = null;
    for (const [id, pending] of this._pending) if (!pending.sentAt || Date.now() - pending.sentAt > 1500) this._sendRequest(id, pending);
  }

  _guestAction(record, data) {
    if (typeof data.id !== 'string' || !/^[a-f0-9]{32}$/.test(data.id) || (data.type === 'action' && !actionValid(data.action))) { record.conn.close(); return; }
    const key = `${record.playerId}:${data.id}`;
    if (this._seen.has(key)) {
      const result = this._seen.get(key);
      if (result.error) this._send(record.conn, { type: 'error', ack: data.id, message: result.error });
      else this._sendState(record.conn, data.id);
      return;
    }
    try {
      if (data.type === 'profile') this._applyProfile(record.playerId, data.profile);
      else if (data.type === 'reaction') this._applyReaction(record.playerId, data.reaction);
      else {
        if (this.state?.kind === 'lobby') throw new Error('Wait for the host to start the game.');
        this.state = applyAction(this.state, record.playerId, data.action, randomNumber);
        this.revision++;
      }
      this._seen.set(key, { ok: true });
      if (data.type !== 'reaction') this._publish();
      this._sendState(record.conn, data.id);
    } catch (error) {
      const message = String(error.message || 'That action is not available.').slice(0, 240);
      this._seen.set(key, { error: message });
      this._send(record.conn, { type: 'error', ack: data.id, message });
    }
    // A room's realistic move history fits comfortably in this bounded cache.
    if (this._seen.size > 20000) this._seen.delete(this._seen.keys().next().value);
  }

  dispatch(action) {
    if (!this._active || !this.state) return Promise.reject(new Error('Join a room first.'));
    if (!actionValid(action)) return Promise.reject(new Error('That action is not valid.'));
    if (this.isHost) {
      try {
        if (this.state.kind === 'lobby') throw new Error('Start the game first.');
        this.state = applyAction(this.state, this.playerId, clone(action), randomNumber);
        this.revision++;
        this._publish();
        return Promise.resolve(clone(this.state));
      } catch (error) { this.onError(error.message); return Promise.reject(error); }
    }
    return this._request('action', { action });
  }

  _request(type, payload) {
    if (!this._active || !this.state) return Promise.reject(new Error('Join a room first.'));
    if (!this._hostConnection?.open || this._offlineSince !== null) return Promise.reject(new Error('Reconnecting to the host. Your request has not been sent.'));
    if (this._pending.size) return Promise.reject(new Error('Waiting for the host to confirm your previous request.'));
    return new Promise((resolve, reject) => {
      const id = randomHex();
      const request = { type, payload: clone(payload), resolve, reject, sentAt: 0, createdAt: Date.now() };
      this._pending.set(id, request);
      this._sendRequest(id, request);
    });
  }

  _sendRequest(id, request) {
    if (this._send(this._hostConnection, { type: request.type, id, ...request.payload })) request.sentAt = Date.now();
  }

  _applyProfile(playerId, profile) {
    if (this.state?.kind !== 'lobby') throw new Error('Player appearance and names are locked after the game starts.');
    if (!isObject(profile)) throw new Error('Choose a valid player profile.');
    const player = this._roster.get(playerId);
    if (!player?.connected) throw new Error('Join the room before changing your player.');
    Object.assign(player, sanitizeProfile(profile, player));
    this.revision++;
  }

  updateProfile(profile = {}) {
    if (!this._active || this.state?.kind !== 'lobby') return Promise.reject(new Error('Player appearance and names can only change in the lobby.'));
    if (!isObject(profile)) return Promise.reject(new Error('Choose a valid player profile.'));
    const sanitized = sanitizeProfile(profile, this.players.find(p => p.id === this.playerId));
    if (this.isHost) {
      this._applyProfile(this.playerId, sanitized);
      this._profile = sanitized;
      this._name = sanitized.name;
      this._publish();
      return Promise.resolve(this.players.find(p => p.id === this.playerId));
    }
    return this._request('profile', { profile: sanitized }).then(() => {
      this._profile = sanitizeProfile(this.players.find(p => p.id === this.playerId));
      this._name = this._profile.name;
      return this.players.find(p => p.id === this.playerId);
    });
  }

  setRules(options) {
    if (!this.isHost || this.state?.kind !== 'lobby') return Promise.reject(new Error('Only the host can change rules in the lobby.'));
    try {
      if (!isObject(options)) throw new Error('Choose valid room rules.');
      this.state.settings = normalizeRules({ ...this.state.settings, ...options });
      this.revision++;
      this._publish();
      return Promise.resolve(clone(this.state.settings));
    } catch (error) { return Promise.reject(error); }
  }

  _deliverReaction(event) {
    if (!isObject(event) || !this._roster.has(event.playerId) || !REACTIONS.has(event.reaction) || !/^[a-f0-9]{32}$/.test(event.id) || this._reactionSeen.has(event.id)) return;
    this._reactionSeen.add(event.id);
    if (this._reactionSeen.size > 64) this._reactionSeen.delete(this._reactionSeen.values().next().value);
    this.onReaction({ playerId: event.playerId, reaction: event.reaction, id: event.id });
  }

  _applyReaction(playerId, reaction) {
    if (!this._active || !this._roster.get(playerId)?.connected) throw new Error('Join the room before reacting.');
    if (!REACTIONS.has(reaction)) throw new Error('Choose a supported reaction.');
    const previous = this._lastReaction.get(playerId);
    if (previous !== undefined && Date.now() - previous < REACTION_COOLDOWN) throw new Error('Wait two seconds before sending another reaction.');
    this._lastReaction.set(playerId, Date.now());
    const event = { playerId, reaction, id: randomHex() };
    this._deliverReaction(event);
    for (const record of this._connections.values()) if (record.playerId) this._send(record.conn, { type: 'reaction', event });
  }

  react(reaction) {
    if (!this._active || !this.state) return Promise.reject(new Error('Join a room first.'));
    if (!REACTIONS.has(reaction)) return Promise.reject(new Error('Choose a supported reaction.'));
    if (this.isHost) {
      try { this._applyReaction(this.playerId, reaction); return Promise.resolve(); }
      catch (error) { return Promise.reject(error); }
    }
    return this._request('reaction', { reaction }).then(() => undefined);
  }

  startGame() {
    if (!this.isHost || this.state?.kind !== 'lobby') return Promise.reject(new Error('Only the host can start a room.'));
    if (this.players.length < 2) return Promise.reject(new Error('At least two players are needed. Share your room code to invite a friend.'));
    if (this.players.some(p => !p.connected)) return Promise.reject(new Error('Wait for disconnected players to return, or remove their seats before starting.'));
    try {
      this.state = createGame(this.players, normalizeRules(this.state.settings));
      this.revision++;
      this._publish();
      this._status('playing', 'The game has started. Keep the host tab open.');
      return Promise.resolve(clone(this.state));
    } catch (error) { this.onError(error.message); return Promise.reject(error); }
  }

  kick(playerId) {
    if (!this.isHost || this.state?.kind !== 'lobby') return false;
    const player = this._roster.get(playerId);
    if (!player || player.id === this.playerId || player.connected) return false;
    this._roster.delete(playerId);
    this.revision++;
    this._publish();
    return true;
  }

  _heartbeat() {
    if (this._heartbeatStarted) return;
    this._heartbeatStarted = true;
    const tick = () => {
      if (!this._active) return;
      const now = Date.now();
      if (this.isHost) {
        for (const record of this._connections.values()) if (now - record.lastMessage > 35000) record.conn.close();
      } else {
        this._send(this._hostConnection, { type: 'ping' });
        if (this._hostConnection?.open && now - this._lastHostMessage > 35000) this._hostConnection.close();
        for (const [id, request] of this._pending) {
          if (now - request.createdAt > RECONNECT_GRACE) { this._pending.delete(id); request.reject(new Error('The host did not confirm this action. Reconnect to see the latest game state.')); }
          else if (now - request.sentAt > 2500) this._sendRequest(id, request);
        }
      }
      this._later(tick, 5000);
    };
    this._later(tick, 5000);
  }

  leave(notify = true) {
    if (this.isHost) for (const record of this._connections.values()) this._send(record.conn, { type: 'closing' });
    this._active = false;
    this._generation++;
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
    const wait = this._joinWait;
    this._joinWait = null;
    if (wait) wait.reject(new Error('Connection cancelled.'));
    const opening = this._openingWait;
    this._openingWait = null;
    if (opening) opening.reject(new Error('Connection cancelled.'));
    for (const request of this._pending.values()) request.reject(new Error('You left the room.'));
    this._pending.clear();
    this._seen.clear();
    this._lastReaction.clear();
    this._reactionSeen.clear();
    this._peer?.destroy();
    this._peer = null;
    this._hostConnection = null;
    this._connections.clear();
    this._roster.clear();
    this._retryTimer = null;
    this._signalingRetry = null;
    this._offlineSince = null;
    this._connecting = false;
    this._heartbeatStarted = false;
    this.state = null;
    this.revision = -1;
    this.roomCode = '';
    this.isHost = false;
    if (notify) this._status('left', 'You left the room.');
  }
}

export default RoomSession;
