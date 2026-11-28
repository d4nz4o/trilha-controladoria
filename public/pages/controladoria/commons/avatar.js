// PALETA DE CORES E AVATAR

// Cores em controladoria/commons/tokens.css (--avatar-1 a --avatar-28)
const AVATAR_PALETTE = Array.from({ length: 28 }, (_, i) => `var(--avatar-${i + 1})`);

function corDoAvatar(id) {
  if (!id) return AVATAR_PALETTE[0];
  if (typeof id === 'number' || !isNaN(id)) {
    return AVATAR_PALETTE[Math.abs(Number(id)) % AVATAR_PALETTE.length];
  }
  let hash = 0;
  const idStr = String(id);
  for (let i = 0; i < idStr.length; i++) {
    hash = (hash * 31 + idStr.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
