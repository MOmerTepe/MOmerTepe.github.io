import test from 'node:test';
import assert from 'node:assert/strict';
import { TURN_SERVERS, getIceConfig, validateTurnServers } from './ice-config.js';

const accountEntry = {
  urls: [
    'turn:global.relay.metered.ca:80',
    'turn:global.relay.metered.ca:80?transport=tcp',
    'turn:global.relay.metered.ca:443',
    'turns:global.relay.metered.ca:443?transport=tcp',
  ],
  username: 'test-browser-user',
  credential: 'test-browser-password',
};

test('direct-connection configuration is explicit; relay readiness is checked separately', () => {
  assert.deepEqual(getIceConfig({ turnServers: [] }), { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  assert.throws(() => getIceConfig({ turnServers: [], requireRelay: true }), /relay configuration is missing/);
});

test('deployment has configured TURN credentials', {
  skip: TURN_SERVERS.length === 0 ? 'Metered account setup is pending; cross-network relay is not configured.' : false,
}, () => {
  assert.doesNotThrow(() => getIceConfig({ requireRelay: true }));
});

test('valid browser UDP, TCP, and TLS TURN entries are copied alongside STUN', () => {
  const source = structuredClone(accountEntry);
  const config = getIceConfig({ turnServers: [source], requireRelay: true });
  assert.equal(config.iceServers[0].urls, 'stun:stun.l.google.com:19302');
  assert.deepEqual(config.iceServers[1], accountEntry);
  config.iceServers[1].urls[0] = 'changed';
  config.iceServers[1].credential = 'changed';
  assert.deepEqual(source, accountEntry);
  assert.deepEqual(validateTurnServers([{ ...accountEntry, urls: 'turn:relay.example.com', credentialType: 'password' }]), [
    { ...accountEntry, urls: 'turn:relay.example.com', credentialType: 'password' },
  ]);
});

test('malformed TURN URLs and unsupported endpoint forms fail validation', () => {
  for (const urls of [
    '', 'https://global.relay.metered.ca:443', 'stun:stun.l.google.com:19302',
    'turn://relay.example.com:3478', 'turn:user:password@relay.example.com:3478',
    'turn:relay.example.com:0', 'turn:relay.example.com:65536', 'turn:relay.example.com:abc',
    'turn:relay.example.com:3478/path', 'turn:relay.example.com:3478#fragment',
    'turn:relay.example.com:3478?transport=tcp&key=secret', 'turn:relay.example.com?transport=sctp',
    'turns:relay.example.com:443?transport=udp', ' turn:relay.example.com:80',
    'turn:relay.example.com:80\n', 'turn:bad_host.example.com:80',
    'turn:-relay.example.com:80', 'turn:relay-.example.com:80', 'turn:relay..example.com:80',
    'turn:relay.example.com.:80', 'turn:localhost:80', 'turn:127.0.0.1:80',
    'turn:[2001:db8::1]:80', `turn:${'a'.repeat(64)}.example.com:80`,
    [], ['turn:relay.example.com:80', 'https://example.com'], null, 42,
  ]) assert.throws(() => validateTurnServers([{ ...accountEntry, urls }]), /invalid TURN URL/, String(urls));
});

test('missing, malformed, or non-password credentials fail without exposing values', () => {
  for (const field of ['username', 'credential']) {
    for (const value of [undefined, null, '', ' ', 'x y', 'x\ny', 42, {}, 'a'.repeat(1025)]) {
      assert.throws(() => validateTurnServers([{ ...accountEntry, [field]: value }]), /requires a non-empty browser TURN/);
    }
  }
  assert.throws(() => validateTurnServers([{ ...accountEntry, credentialType: 'oauth' }]), /password credentials only/);
  assert.throws(() => validateTurnServers([{ ...accountEntry, secretKey: 'never-client-side' }]), /must contain only/);
  assert.throws(() => validateTurnServers([{ ...accountEntry, apiKey: 'never-needed-here' }]), /must contain only/);
});

test('invalid server containers are rejected and default configuration is independently copied', () => {
  for (const value of [null, {}, 'turn:example.com', Array(17).fill(accountEntry)]) {
    assert.throws(() => validateTurnServers(value), /must be an array/);
  }
  for (const value of [null, [], 'turn:example.com', new Date()]) {
    assert.throws(() => validateTurnServers([value]), /must contain only/);
  }
  const first = getIceConfig();
  first.iceServers[0].urls = 'changed';
  assert.equal(getIceConfig().iceServers[0].urls, 'stun:stun.l.google.com:19302');
});
