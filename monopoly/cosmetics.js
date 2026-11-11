export const TOKEN_OPTIONS = Object.freeze([
  { id: 'ferry', label: 'Ferry', labelTr: 'Vapur' },
  { id: 'cat', label: 'Cat', labelTr: 'Kedi' },
  { id: 'tower', label: 'Tower', labelTr: 'Kule' },
  { id: 'tulip', label: 'Tulip', labelTr: 'Lale' },
  { id: 'tea', label: 'Tea', labelTr: 'Çay' },
  { id: 'tram', label: 'Tram', labelTr: 'Tramvay' },
].map(Object.freeze));

export const PLAYER_COLORS = Object.freeze([
  '#a75542', '#447b76', '#7d6aa0', '#947a31',
  '#576f9d', '#9b5980', '#42534b', '#a56c32',
]);

// How a player's seated character looks.
export const HAIR_STYLES = Object.freeze(['short', 'long', 'bun', 'curly', 'bald']);
export const HAIR_COLORS = Object.freeze(['#26241f', '#5a3a22', '#b8894d', '#a8482b', '#9a9a94', '#ece9df']);
export const SKIN_TONES = Object.freeze(['#f1d3b8', '#dfb38f', '#b9835a', '#7c5236']);
const pick = (list, value, base) => list.includes(value) ? value : list.includes(base) ? base : list[0];

const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const cleanName = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) : '';
const validToken = value => TOKEN_OPTIONS.some(token => token.id === value);
const validColor = value => typeof value === 'string' && PLAYER_COLORS.includes(value.toLowerCase());

// Return only cosmetic metadata: caller-supplied ids, balances, connection state,
// reconnect credentials, and arbitrary CSS are never copied into a player.
export function sanitizeProfile(profile = {}, fallback = {}) {
  const value = object(profile), base = object(fallback);
  return {
    name: cleanName(value.name) || cleanName(base.name) || 'Player',
    token: validToken(value.token) ? value.token : validToken(base.token) ? base.token : TOKEN_OPTIONS[0].id,
    color: validColor(value.color) ? value.color.toLowerCase() : validColor(base.color) ? base.color.toLowerCase() : PLAYER_COLORS[0],
    hair: pick(HAIR_STYLES, value.hair, base.hair), hairColor: pick(HAIR_COLORS, value.hairColor, base.hairColor), skin: pick(SKIN_TONES, value.skin, base.skin),
  };
}
