import { supabase } from "@/integrations/supabase/client";

/**
 * Check if running in Preview environment
 */
export function isPreviewEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    host.includes("softgen.ai") ||
    host.includes("softgen.dev") ||
    host.includes("vercel.app") ||
    host.includes("localhost") ||
    host.includes("127.0.0.1")
  );
}

/**
 * Player Session Interface
 */
export interface PlayerSession {
  playerId: string;
  nickname: string;
  email: string;
  ticketIds: string[];
  eventId: string | null;
}

/**
 * Get or create player session for Preview environment
 * Returns null in production (domain) environment
 */
export async function getPlayerSession(): Promise<PlayerSession | null> {
  // Production/Domain: Return null (use existing auth)
  if (!isPreviewEnvironment()) {
    console.log("[PlayerHelper] Production environment - skipping session");
    return null;
  }

  console.log("[PlayerHelper] Preview environment - loading session");

  // Try to get from localStorage first
  const stored = localStorage.getItem("player_session");
  if (stored) {
    try {
      const session = JSON.parse(stored) as PlayerSession;
      console.log("[PlayerHelper] ✅ Session from localStorage:", {
        playerId: session.playerId?.slice(0, 8),
        nickname: session.nickname,
        ticketCount: session.ticketIds?.length || 0
      });
      return session;
    } catch (e) {
      console.warn("[PlayerHelper] Failed to parse stored session:", e);
      localStorage.removeItem("player_session");
    }
  }

  // Try to load from Supabase (check players table)
  const email = localStorage.getItem("player_email");
  if (email) {
    console.log("[PlayerHelper] Attempting to load player from DB:", email);
    
    const { data: player, error } = await supabase
      .from("players")
      .select("id, email, nickname")
      .eq("email", email)
      .maybeSingle();

    if (!error && player) {
      // Load player's tickets
      const { data: tickets } = await supabase
        .from("tickets")
        .select("id, event_id")
        .eq("player_id", player.id);

      const ticketIds = tickets?.map(t => t.id) || [];
      const eventId = tickets?.[0]?.event_id || null;

      const session: PlayerSession = {
        playerId: player.id,
        nickname: player.nickname || "Igrač",
        email: player.email,
        ticketIds,
        eventId
      };

      // Save to localStorage
      localStorage.setItem("player_session", JSON.stringify(session));
      
      console.log("[PlayerHelper] ✅ Session loaded from DB:", {
        playerId: session.playerId.slice(0, 8),
        nickname: session.nickname,
        ticketCount: session.ticketIds.length
      });

      return session;
    }
  }

  console.log("[PlayerHelper] ⚠️ No session found");
  return null;
}

/**
 * Save player session to localStorage (Preview only)
 */
export function savePlayerSession(session: PlayerSession): void {
  if (!isPreviewEnvironment()) return;
  
  localStorage.setItem("player_session", JSON.stringify(session));
  console.log("[PlayerHelper] Session saved:", {
    playerId: session.playerId.slice(0, 8),
    nickname: session.nickname
  });
}

/**
 * Clear player session (Preview only)
 */
export function clearPlayerSession(): void {
  if (!isPreviewEnvironment()) return;
  
  localStorage.removeItem("player_session");
  console.log("[PlayerHelper] Session cleared");
}

/**
 * Update session after registration (Preview only)
 */
export async function updateSessionAfterRegistration(
  email: string,
  nickname: string,
  ticketIds: string[],
  eventId: string
): Promise<void> {
  if (!isPreviewEnvironment()) return;

  console.log("[PlayerHelper] Updating session after registration:", {
    email,
    nickname,
    ticketCount: ticketIds.length
  });

  // Get player ID from DB
  const { data: player } = await supabase
    .from("players")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (player) {
    const session: PlayerSession = {
      playerId: player.id,
      nickname,
      email,
      ticketIds,
      eventId
    };

    savePlayerSession(session);
    localStorage.setItem("player_email", email);
  }
}

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