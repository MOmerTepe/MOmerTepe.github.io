import { createGame, applyAction, getPlayerView } from './engine.js';
import { getIceConfig } from '../monopoly/ice-config.js?v=20261006-5';

// The page stays entirely static. PeerJS supplies signaling and WebRTC transport;
// the room creator's browser is the only authority allowed to change game state.
const PROTOCOL = 1;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'omtepe-secret-hitler-v1-';
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 5;
const CONNECT_TIMEOUT = 20000;
const LIBRARY_TIMEOUT = 15000;
const JOIN_TIMEOUT = 60000;
const NEGOTIATION_TIMEOUT = 20000;
const HELLO_INTERVAL = 2000;
const HELLO_TIMEOUT = 15000;
const RECONNECT_GRACE = 90000;
const MAX_MESSAGE = 8192;
const CHAT_COOLDOWN = 1000;
const CHAT_LIMIT = 400;
const CHAT_HISTORY = 80;
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
const validInstance = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
const cleanName = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Player';
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const actionValid = action => {
  try { return isObject(action) && typeof action.type === 'string' && /^[A-Z_]{2,40}$/.test(action.type) && JSON.stringify(action).length <= 4096; }
  catch { return false; }
};

function cleanChat(text) {
  if (typeof text !== 'string' || text.length > CHAT_LIMIT) throw new Error('Messages must contain 1–400 characters.');
  const message = text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!message) throw new Error('Messages must contain 1–400 characters.');
  return message;
}

function saveIdentity(storage, identity) {
  try { storage?.setItem('omertepe.secret-hitler.identity.v1', JSON.stringify(identity)); } catch { /* In-memory identity remains usable. */ }
}

function getIdentity(storage) {
  const key = 'omertepe.secret-hitler.identity.v1';
  try {
    const saved = JSON.parse(storage?.getItem(key) || null);
    if (saved && validId(saved.id) && validToken(saved.token)) return saved;
  } catch { /* Storage may be disabled. This tab can still play. */ }
  const identity = { id: `p${randomHex()}`, token: randomHex(32) };
  saveIdentity(storage, identity);
  return identity;
}

function loadPeer() {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  if (!peerScript) peerScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const fail = message => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      script.remove();
      peerScript = null;
      reject(new Error(message));
    };
    const timeout = setTimeout(() => fail('The online-play library took too long to load. Check your connection and try again.'), LIBRARY_TIMEOUT);
    script.src = new URL('../monopoly/vendor/peerjs.min.js', import.meta.url).href;
    script.onload = () => {
      if (settled) return;
      if (!globalThis.Peer) { fail('Online play could not load. Refresh the page and try again.'); return; }
      settled = true;
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      resolve(globalThis.Peer);
    };
    script.onerror = () => fail('Online play could not load. Check your connection and try again.');
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
  constructor({ onState = () => {}, onStatus = () => {}, onError = () => {} } = {}) {
    this.onState = onState;
    this.onStatus = onStatus;
    this.onError = onError;
    try { this._identityStorage = globalThis.sessionStorage; } catch { this._identityStorage = null; }
    this.identity = getIdentity(this._identityStorage);
    this.playerId = this.identity.id;
    // This is deliberately not persisted: duplicated tabs may copy sessionStorage,
    // but must never silently evict an already connected player.
    this.clientInstance = randomHex();
    this.state = null;
    this.roomCode = '';
    this.isHost = false;
    this.revision = -1;
    this._roster = new Map();
    this._connections = new Map();
    this._pending = new Map();
    this._seen = new Map();
    this._lastChat = new Map();
    this._chat = [];
    this._game = null;
    this._timers = new Set();
    this._generation = 0;
    this._active = false;
    this._retryTimer = null;
    this._signalingRetry = null;
    this._hostConnection = null;
    this._connecting = false;
    this._offlineSince = null;
    this._lastHostMessage = 0;
    this._helloTimer = null;
    this._connectionAccepted = false;
    this._identityRotations = 0;
    this._lastConnectError = '';
  }

  get players() { return [...this._roster.values()].map(({ id, name, connected }) => ({ id, name, connected, alive: (this._game?.players || this.state?.players)?.find(player => player.id === id)?.alive ?? true })); }
  get connectedPlayerIds() { return this.players.filter(p => p.connected).map(p => p.id); }
  get shareUrl() {
    const url = new URL(location.href);
    url.hash = `room=${this.roomCode}`;
    return url.href;
  }

  _status(kind, message) {
    this._notify('onStatus', { kind, message, roomCode: this.roomCode, isHost: this.isHost, playerId: this.playerId, connectedPlayerIds: this.connectedPlayerIds });
  }

  _notify(callback, value) {
    try { this[callback](value); }
    catch (error) { console.error(`Room UI callback ${callback} failed:`, error); }
  }

  _later(callback, delay) {
    const timer = setTimeout(() => { this._timers.delete(timer); callback(); }, delay);
    this._timers.add(timer);
    return timer;
  }

  _cancel(timer) { clearTimeout(timer); this._timers.delete(timer); }

  async _makePeer(id, generation) {
    this._status('loading', 'Loading online play…');
    const Peer = await new Promise((resolve, reject) => {
      const opening = { reject };
      this._openingWait = opening;
      loadPeer().then(value => {
        if (this._openingWait === opening) this._openingWait = null;
        resolve(value);
      }, error => {
        if (this._openingWait === opening) this._openingWait = null;
        reject(error);
      });
    });
    if (generation !== this._generation) throw new Error('Connection cancelled.');
    this._status('signaling', 'Contacting the room connection service…');
    // Explicit deployment configuration avoids relying on bundled relay defaults.
    const options = { debug: 0, config: getIceConfig() };
    const peer = id ? new Peer(id, options) : new Peer(options);
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
        this._lastConnectError = friendlyError(error);
        if (!settled) { settled = true; clearOpening(); this._cancel(timeout); reject(new Error(friendlyError(error))); return; }
        if (!this.isHost && !this._hostConnection?.open) {
          this._connecting = false;
          this._hostConnection?.close();
          this._status('retrying', `${this._lastConnectError} Retrying while the room connection window is open.`);
          this._scheduleGuestRetry();
        } else if (error.type === 'webrtc') {
          this._status('connection-error', this._lastConnectError);
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
        if (generation !== this._generation || !this._active || this._peer !== peer) return;
        if (!this.isHost) this._guestOffline();
        else {
          this.leave(false);
          this._status('disconnected', 'The room connection closed. Create a new room to play again.');
        }
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

  async host(name) {
    this.leave(false);
    this.isHost = true;
    this._active = true;
    this._name = cleanName(name);
    const generation = this._generation;
    this._status('connecting', 'Creating your room…');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        this._code = randomRoom();
        this.roomCode = displayCode(this._code);
        try { await this._makePeer(`${PREFIX}${this._code}`, generation); break; }
        catch (error) {
          // Detach a failed attempt before destroying it, so its close event
          // cannot cancel the next room-code collision retry.
          const failedPeer = this._peer;
          this._peer = null;
          failedPeer?.destroy();
          if (!error.message.includes('already in use') || attempt === 2) throw error;
        }
      }
      if (generation !== this._generation) throw new Error('Connection cancelled.');
      this._roster.set(this.playerId, { id: this.playerId, reconnectToken: this.identity.token, clientInstance: this.clientInstance, name: this._name, connected: true });
      this.revision = 0;
      this._publish();
      this._heartbeat();
      this._status('connected', 'Room open. Share the code with your friends.');
      return this.roomCode;
    } catch (error) {
      if (generation === this._generation) { this.leave(false); this._notify('onError', error.message); }
      throw error;
    }
  }

  async join(code, name) {
    const normalized = normalCode(code);
    if (!validCode(normalized)) {
      const error = new Error('Enter the eight-character room code, such as ABCD-2345.');
      this._notify('onError', error.message);
      throw error;
    }
    this.leave(false);
    this._active = true;
    this._code = normalized;
    this.roomCode = displayCode(normalized);
    this._name = cleanName(name);
    const generation = this._generation;
    this._status('connecting', 'Finding your room…');
    try {
      await this._makePeer(null, generation);
      if (generation !== this._generation) throw new Error('Connection cancelled.');
      return await new Promise((resolve, reject) => {
        const timeout = this._later(() => {
          if (!this._joinWait) return;
          this._joinWait = null;
          const error = new Error(this._lastConnectError
            ? `Could not join the room. ${this._lastConnectError}`
            : 'The browsers could not finish connecting. Keep the host tab open and try again; your network may need an available relay.');
          this.leave(false);
          this._notify('onError', error.message);
          reject(error);
        }, JOIN_TIMEOUT);
        this._joinWait = { resolve, reject, timeout };
        this._connectToHost();
      });
    } catch (error) {
      if (generation === this._generation) { this.leave(false); this._notify('onError', error.message); }
      throw error;
    }
  }

  _connectToHost() {
    if (!this._active || this.isHost || this._connecting || this._hostConnection?.open || !this._peer || this._peer.destroyed || this._peer.disconnected) return;
    this._connecting = true;
    const generation = this._generation;
    const conn = this._peer.connect(`${PREFIX}${this._code}`, { reliable: true, serialization: 'json', metadata: { protocol: PROTOCOL } });
    this._hostConnection = conn;
    this._connectionAccepted = false;
    this._status('negotiating', 'Connecting your browser to the host…');
    const timeout = this._later(() => {
      if (generation === this._generation && this._hostConnection === conn && !conn.open) {
        this._connecting = false;
        this._lastConnectError = 'The browsers could not establish a data connection. A firewall or unavailable relay may be blocking this network.';
        conn.close();
        this._scheduleGuestRetry();
      }
    }, NEGOTIATION_TIMEOUT);
    conn.on('open', () => {
      if (generation !== this._generation || this._hostConnection !== conn) { conn.close(); return; }
      this._cancel(timeout);
      this._connecting = false;
      this._lastHostMessage = Date.now();
      this._status('handshaking', 'Browsers connected. Joining the table…');
      const openedAt = Date.now();
      const hello = () => {
        this._helloTimer = null;
        if (generation !== this._generation || this._hostConnection !== conn || !conn.open || this._connectionAccepted) return;
        if (Date.now() - openedAt >= HELLO_TIMEOUT) {
          this._lastConnectError = 'The host opened a connection but did not confirm your seat. Check that the host tab is responsive.';
          conn.close();
          return;
        }
        this._sendHello(conn);
        this._helloTimer = this._later(hello, HELLO_INTERVAL);
      };
      hello();
    });
    conn.on('data', data => {
      if (generation === this._generation && this._hostConnection === conn) this._receiveFromHost(data);
    });
    const closed = () => {
      this._cancel(timeout);
      if (generation !== this._generation || this._hostConnection !== conn) return;
      this._cancel(this._helloTimer);
      this._helloTimer = null;
      this._hostConnection = null;
      this._connectionAccepted = false;
      this._connecting = false;
      this._guestOffline();
    };
    conn.on('close', closed);
    conn.on('error', error => { this._lastConnectError = friendlyError(error); conn.close(); closed(); });
  }

  _sendHello(conn = this._hostConnection) {
    this._send(conn, { type: 'hello', playerId: this.playerId, token: this.identity.token, clientInstance: this.clientInstance, name: this._name });
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
    // PeerJS emits the incoming connection before ICE negotiation necessarily ends.
    const timeout = this._later(() => { if (!record.playerId) conn.close(); }, NEGOTIATION_TIMEOUT + HELLO_TIMEOUT);
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
      if (data.type === 'hello') {
        this._hello(record, data);
        if (record.playerId) this._cancel(timeout);
        return;
      }
      if (!record.playerId) { conn.close(); return; }
      if (data.type === 'ping') this._send(conn, { type: 'pong' });
      else if (['action', 'chat'].includes(data.type)) this._guestAction(record, data);
      else if (['start', 'kick'].includes(data.type)) this._send(conn, { type: 'error', ack: data.id, message: 'Only the host can manage the lobby.' });
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
        if (!player.connected && this._roster.get(player.id) === player) this._status('player-offline', `${player.name} is still offline. ${this.state?.phase === 'lobby' ? 'Remove their seat or wait for them to rejoin.' : 'The game will wait when their action is needed.'}`);
      }, RECONNECT_GRACE);
    };
    conn.on('close', closed);
    conn.on('error', () => { conn.close(); closed(); });
  }

  _hello(record, data) {
    const reject = message => { this._send(record.conn, { type: 'rejected', message }); this._later(() => record.conn.close(), 200); };
    if (!validId(data.playerId) || !validToken(data.token) || !validInstance(data.clientInstance)) { reject('This player session is invalid or outdated. Refresh the game and try again.'); return; }
    let player = this._roster.get(data.playerId);
    if (record.playerId) {
      if (record.playerId !== data.playerId || player?.conn !== record.conn || player.reconnectToken !== data.token || player.clientInstance !== data.clientInstance) {
        reject('This connection no longer owns that seat. Rejoin from your original tab.');
        return;
      }
      // A repeated hello only resends the welcome; it never changes the roster.
      this._sendState(record.conn);
      return;
    }
    if (player) {
      if (player.reconnectToken !== data.token) { reject('That seat belongs to another session. Rejoin from your original browser tab.'); return; }
      const activeElsewhere = player.id === this.playerId || (player.connected && player.conn?.open && player.clientInstance !== data.clientInstance);
      if (activeElsewhere) {
        if (this.state?.phase === 'lobby') this._send(record.conn, { type: 'identity-conflict' });
        else reject('That player is already active in another tab. Return to the original tab, or close it before rejoining your seat.');
        return;
      }
      const oldConnection = player.conn;
      player.conn = record.conn;
      player.clientInstance = data.clientInstance;
      oldConnection?.close();
      player.connected = true;
      player.offlineAt = null;
    } else {
      if (this.state?.phase !== 'lobby') { reject('This game has already started. Ask the host to create a new room after the game.'); return; }
      if (this._roster.size >= MAX_PLAYERS) { reject('This room is full. Up to ten players can join.'); return; }
      player = { id: data.playerId, reconnectToken: data.token, clientInstance: data.clientInstance, name: cleanName(data.name), connected: true, conn: record.conn };
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

  _viewFor(playerId) {
    // All UI and wire snapshots originate here. Never add _game, deck, votes,
    // or another player's private view to this object or the public roster.
    const view = this._game ? getPlayerView(this._game, playerId) : {
      phase: 'lobby', players: this.players.map(({ id, name }) => ({ id, name, alive: true })),
    };
    return { ...clone(view), roomCode: this.roomCode, hostId: this.playerId, connectedPlayerIds: this.connectedPlayerIds, chat: clone(this._chat) };
  }

  _sendState(conn, ack) {
    const playerId = this._connections.get(conn)?.playerId;
    if (!playerId || this._roster.get(playerId)?.conn !== conn) return;
    this._send(conn, { type: 'state', state: this._viewFor(playerId), roomCode: this.roomCode, hostId: this.playerId, roster: this.players, revision: this.revision, ...(ack ? { ack } : {}) });
  }

  _publish() {
    this.state = this._viewFor(this.playerId);
    // Admission and acknowledgments cannot depend on a successful UI render.
    for (const record of this._connections.values()) if (record.playerId) this._sendState(record.conn);
    this._notify('onState', clone(this.state));
  }

  _receiveFromHost(data) {
    // State snapshots may be larger than guest action messages as the log grows.
    if (!isObject(data) || data.protocol !== PROTOCOL || typeof data.type !== 'string') return;
    this._lastHostMessage = Date.now();
    if (data.type === 'identity-conflict') {
      if (!this._joinWait || this._identityRotations >= 2) {
        this._receiveFromHost({ protocol: PROTOCOL, type: 'rejected', message: 'This tab could not create a separate player identity. Close duplicate game tabs and try again.' });
        return;
      }
      this._identityRotations++;
      this.identity = { id: `p${randomHex()}`, token: randomHex(32) };
      this.playerId = this.identity.id;
      saveIdentity(this._identityStorage, this.identity);
      this._status('handshaking', 'Creating a separate seat for this tab…');
      this._sendHello();
      return;
    }
    if (data.type === 'rejected') {
      const message = typeof data.message === 'string' ? data.message.slice(0, 240) : 'The room declined the connection.';
      const wait = this._joinWait;
      this._joinWait = null;
      if (wait) { this._cancel(wait.timeout); wait.reject(new Error(message)); }
      this.leave(false);
      this._notify('onError', message);
      this._status('disconnected', message);
      return;
    }
    if (data.type === 'error') {
      const request = this._pending.get(data.ack);
      if (request) { this._pending.delete(data.ack); request.reject(new Error(String(data.message || 'That action is not available.').slice(0, 240))); }
      this._notify('onError', String(data.message || 'That action is not available.').slice(0, 240));
      return;
    }
    if (data.type === 'closing') {
      const message = 'The host closed this room. Create or join a new room to play again.';
      this.leave(false);
      this._status('disconnected', message);
      return;
    }
    if (data.type !== 'state' || !isObject(data.state) || !Number.isSafeInteger(data.revision) || !Array.isArray(data.roster) || data.roster.length > MAX_PLAYERS || !data.roster.some(p => p?.id === this.playerId)) return;
    this._connectionAccepted = true;
    this._cancel(this._helloTimer);
    this._helloTimer = null;
    let changed = false;
    if (data.revision >= this.revision) {
      this.revision = data.revision;
      this.state = clone(data.state);
      this._roster = new Map(data.roster.filter(p => isObject(p) && validId(p.id)).map(p => [p.id, { id: p.id, name: cleanName(p.name), connected: !!p.connected }]));
      changed = true;
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
    this._lastConnectError = '';
    if (changed) this._notify('onState', clone(this.state));
    for (const [id, pending] of this._pending) if (!pending.sentAt || Date.now() - pending.sentAt > 1500) this._sendRequest(id, pending);
  }

  _guestAction(record, data) {
    if (!record.playerId || this._roster.get(record.playerId)?.conn !== record.conn) { record.conn.close(); return; }
    if (typeof data.id !== 'string' || !/^[a-f0-9]{32}$/.test(data.id) || (data.type === 'action' && !actionValid(data.action))) { record.conn.close(); return; }
    const key = `${record.playerId}:${data.id}`;
    if (this._seen.has(key)) {
      const result = this._seen.get(key);
      if (result.error) this._send(record.conn, { type: 'error', ack: data.id, message: result.error });
      else this._sendState(record.conn, data.id);
      return;
    }
    try {
      if (data.type === 'chat') this._applyChat(record.playerId, data.text);
      else {
        if (this.state?.phase === 'lobby') throw new Error('Wait for the host to start the game.');
        this._game = applyAction(this._game, record.playerId, data.action, { rng: randomNumber });
        this.revision++;
      }
      this._seen.set(key, { ok: true });
      this._publish();
      this._sendState(record.conn, data.id);
    } catch (error) {
      const message = String(error.message || 'That action is not available.').slice(0, 240);
      this._seen.set(key, { error: message });
      this._send(record.conn, { type: 'error', ack: data.id, message });
    }
    // A room's realistic move history fits comfortably in this bounded cache.
    if (this._seen.size > 20000) this._seen.delete(this._seen.keys().next().value);
  }

  action(action) {
    if (!this._active || !this.state) return Promise.reject(new Error('Join a room first.'));
    if (!actionValid(action)) return Promise.reject(new Error('That action is not valid.'));
    if (this.isHost) {
      try {
        if (this.state.phase === 'lobby') throw new Error('Start the game first.');
        this._game = applyAction(this._game, this.playerId, clone(action), { rng: randomNumber });
        this.revision++;
        this._publish();
        return Promise.resolve(clone(this.state));
      } catch (error) { this._notify('onError', error.message); return Promise.reject(error); }
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

  _applyChat(playerId, text) {
    const player = this._roster.get(playerId);
    if (!this._active || !player?.connected) throw new Error('Join the room before sending a message.');
    const message = cleanChat(text);
    if (this._game) {
      if (this._game.phase !== 'gameover' && this._game.players.find(p => p.id === playerId)?.alive === false) throw new Error('Eliminated players cannot send messages.');
      if (['president-discard', 'chancellor-enact', 'veto'].includes(this._game.phase)
        && [this._game.presidentId, this._game.chancellorId].includes(playerId)) {
        throw new Error('The President and Chancellor cannot communicate during the legislative session.');
      }
    }
    const previous = this._lastChat.get(playerId);
    if (previous !== undefined && Date.now() - previous < CHAT_COOLDOWN) throw new Error('Wait one second before sending another message.');
    this._lastChat.set(playerId, Date.now());
    this._chat.push({ id: randomHex(), playerId, name: player.name, text: message });
    if (this._chat.length > CHAT_HISTORY) this._chat.splice(0, this._chat.length - CHAT_HISTORY);
    this.revision++;
  }

  chat(text) {
    if (!this._active || !this.state) return Promise.reject(new Error('Join a room first.'));
    try { text = cleanChat(text); }
    catch (error) { return Promise.reject(error); }
    if (this.isHost) {
      try { this._applyChat(this.playerId, text); this._publish(); return Promise.resolve(clone(this.state)); }
      catch (error) { return Promise.reject(error); }
    }
    return this._request('chat', { text });
  }

  start() {
    if (!this.isHost || this.state?.phase !== 'lobby') return Promise.reject(new Error('Only the host can start a room.'));
    if (this.players.length < MIN_PLAYERS) return Promise.reject(new Error('At least five players are needed. Share your room code to invite friends.'));
    if (this.players.some(p => !p.connected)) return Promise.reject(new Error('Wait for disconnected players to return, or remove their seats before starting.'));
    try {
      this._game = createGame(this.players.map(({ id, name }) => ({ id, name })), { rng: randomNumber });
      this.revision++;
      this._publish();
      this._status('playing', 'The game has started. Keep the host tab open.');
      return Promise.resolve(clone(this.state));
    } catch (error) { this._notify('onError', error.message); return Promise.reject(error); }
  }

  kick(playerId) {
    if (!this.isHost || this.state?.phase !== 'lobby') return false;
    const player = this._roster.get(playerId);
    if (!player || player.id === this.playerId) return false;
    if (player.conn) {
      this._send(player.conn, { type: 'rejected', message: 'The host removed your seat from the lobby.' });
      this._later(() => player.conn.close(), 200);
    }
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
    this._lastChat.clear();
    this._chat = [];
    this._game = null;
    this._peer?.destroy();
    this._peer = null;
    this._hostConnection = null;
    this._connections.clear();
    this._roster.clear();
    this._retryTimer = null;
    this._signalingRetry = null;
    this._helloTimer = null;
    this._connectionAccepted = false;
    this._identityRotations = 0;
    this._lastConnectError = '';
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
