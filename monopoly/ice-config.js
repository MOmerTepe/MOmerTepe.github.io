// Deployment configuration: paste only the TURN entries from the account's
// generated browser ICE-server array here (UDP, TCP, and TLS endpoints).
// This TURN-only browser credential is intentionally public, approved by the
// site owner. It cannot administer the account. Never paste a management key.
export const TURN_SERVERS = [{
  urls: [
    'turn:standard.relay.metered.ca:80',
    'turn:standard.relay.metered.ca:80?transport=tcp',
    'turn:standard.relay.metered.ca:443',
    'turns:standard.relay.metered.ca:443?transport=tcp',
  ],
  username: '0820856f434dda860e9dc4c6',
  credential: 'Qbh3oMKbQlKq/9v4',
}];

const GOOGLE_STUN = 'stun:stun.l.google.com:19302';
const SERVER_KEYS = new Set(['urls', 'username', 'credential', 'credentialType']);

function validTurnUrl(url) {
  if (typeof url !== 'string' || url.length > 512 || /\s/.test(url)) return false;
  // This deployment accepts DNS names, not IP literals. TURN URIs do not use
  // https-style slashes, user-info, paths, fragments, or arbitrary queries.
  const match = /^(turns?):([a-z0-9.-]+)(?::([0-9]{1,5}))?(?:\?transport=(udp|tcp))?$/i.exec(url);
  if (!match) return false;
  const [, scheme, hostname, port, transport] = match;
  if (hostname.length > 253 || !hostname.includes('.') || /^[0-9.]+$/.test(hostname)) return false;
  if (!hostname.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return false;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return false;
  return !(scheme.toLowerCase() === 'turns' && transport?.toLowerCase() === 'udp');
}

function validCredential(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/\s|[\u0000-\u001f\u007f]/.test(value);
}

// Empty configuration is useful for direct-connection development. Deployment
// checks can require a relay explicitly; validity alone never proves reachability.
export function validateTurnServers(servers, { requireRelay = false } = {}) {
  if (!Array.isArray(servers) || servers.length > 16) throw new Error('TURN_SERVERS must be an array of at most 16 browser TURN server entries.');
  if (requireRelay && servers.length === 0) throw new Error('TURN relay configuration is missing. Add generated browser TURN credentials to ice-config.js.');
  return Array.from(servers).map((server, index) => {
    const label = `TURN server ${index + 1}`;
    if (!server || typeof server !== 'object' || Array.isArray(server) || ![Object.prototype, null].includes(Object.getPrototypeOf(server)) || Object.keys(server).some(key => !SERVER_KEYS.has(key))) {
      throw new Error(`${label} must contain only urls, username, credential, and optional credentialType.`);
    }
    const urls = Array.isArray(server.urls) ? Array.from(server.urls) : [server.urls];
    if (urls.length === 0 || urls.length > 8 || !urls.every(validTurnUrl)) throw new Error(`${label} has an invalid TURN URL. Use a turn: or turns: DNS endpoint with an optional valid port and transport.`);
    if (!validCredential(server.username) || !validCredential(server.credential)) throw new Error(`${label} requires a non-empty browser TURN username and credential without whitespace.`);
    if (server.credentialType !== undefined && server.credentialType !== 'password') throw new Error(`${label} supports password credentials only.`);
    return {
      urls: Array.isArray(server.urls) ? [...urls] : server.urls,
      username: server.username,
      credential: server.credential,
      ...(server.credentialType === 'password' ? { credentialType: 'password' } : {}),
    };
  });
}

export function getIceConfig({ turnServers = TURN_SERVERS, requireRelay = false } = {}) {
  return { iceServers: [{ urls: GOOGLE_STUN }, ...validateTurnServers(turnServers, { requireRelay })] };
}
