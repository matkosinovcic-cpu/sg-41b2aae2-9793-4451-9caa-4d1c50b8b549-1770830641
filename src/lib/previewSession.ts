/**
 * Preview Session Management
 * CRITICAL: This module is ONLY used in Preview mode (softgen.ai)
 * Production uses separate auth flow and should never call these functions
 */

export interface PreviewPlayerSession {
  eventId: string;
  playerId: string;
  nickname: string;
  email: string;
  ticketIds: string[];
  timestamp: number;
}

const STORAGE_KEY = "ps_preview_session_v1";
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get Preview player session from localStorage
 * Returns null if session doesn't exist or is expired
 */
export function getPreviewPlayerSession(): PreviewPlayerSession | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const session = JSON.parse(stored) as PreviewPlayerSession;

    // Validate structure
    if (!session.playerId || !session.eventId || !session.nickname) {
      console.warn("[PreviewSession] Invalid session structure, clearing...");
      clearPreviewPlayerSession();
      return null;
    }

    // Check expiration
    if (Date.now() - session.timestamp > SESSION_TTL) {
      console.warn("[PreviewSession] Session expired, clearing...");
      clearPreviewPlayerSession();
      return null;
    }

    return session;
  } catch (error) {
    console.error("[PreviewSession] Failed to parse session:", error);
    clearPreviewPlayerSession();
    return null;
  }
}

/**
 * Save Preview player session to localStorage
 */
export function setPreviewPlayerSession(session: Omit<PreviewPlayerSession, "timestamp">): void {
  if (typeof window === "undefined") return;

  const fullSession: PreviewPlayerSession = {
    ...session,
    timestamp: Date.now()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fullSession));
    console.log("[PreviewSession] ✅ Session saved:", {
      playerId: session.playerId.slice(0, 8),
      nickname: session.nickname,
      ticketCount: session.ticketIds.length
    });
  } catch (error) {
    console.error("[PreviewSession] Failed to save session:", error);
  }
}

/**
 * Clear Preview player session from localStorage
 */
export function clearPreviewPlayerSession(): void {
  if (typeof window === "undefined") return;
  
  localStorage.removeItem(STORAGE_KEY);
  console.log("[PreviewSession] Session cleared");
}

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