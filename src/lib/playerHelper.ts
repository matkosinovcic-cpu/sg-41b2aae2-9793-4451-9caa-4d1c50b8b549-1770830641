/**
 * Player Helper - Manages player_id storage and retrieval
 * 
 * Uses localStorage with cookie fallback for persistence
 * Tracks: player_id (UUID)
 */

const STORAGE_KEY = "ps_player_id";
const COOKIE_NAME = "ps_player_id";

/**
 * Get player_id from storage
 * Returns null if not found
 */
export function getPlayerId(): string | null {
  try {
    // Try localStorage first
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      console.log("[Player] Found player_id in localStorage:", stored);
      return stored;
    }
  } catch (err) {
    console.warn("[Player] localStorage not available:", err);
  }

  // Fallback to cookie check
  try {
    const cookies = document.cookie.split("; ");
    const playerCookie = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
    if (playerCookie) {
      const value = playerCookie.split("=")[1];
      console.log("[Player] Found player_id in cookie:", value);
      return value;
    }
  } catch (err) {
    console.warn("[Player] Cookie check failed:", err);
  }

  console.log("[Player] No player_id found");
  return null;
}

/**
 * Save player_id to storage
 */
export function savePlayerId(playerId: string): void {
  try {
    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, playerId);
    console.log("[Player] Saved player_id to localStorage:", playerId);
  } catch (err) {
    console.warn("[Player] localStorage save failed:", err);
  }

  // Always save to cookie as fallback
  try {
    const maxAge = 365 * 24 * 60 * 60; // 1 year
    document.cookie = `${COOKIE_NAME}=${playerId}; path=/; max-age=${maxAge}; SameSite=Lax`;
    console.log("[Player] Saved player_id to cookie");
  } catch (err) {
    console.warn("[Player] Cookie save failed:", err);
  }
}

/**
 * Check if player has a profile (has player_id stored locally)
 */
export function hasPlayerProfile(): boolean {
  const playerId = getPlayerId();
  const hasProfile = playerId !== null;
  console.log("[Player] Has profile:", hasProfile);
  return hasProfile;
}

/**
 * Clear player_id from storage (for testing/logout)
 */
export function clearPlayerId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
    console.log("[Player] Cleared player_id");
  } catch (err) {
    console.warn("[Player] Clear failed:", err);
  }
}