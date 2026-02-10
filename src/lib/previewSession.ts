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
    
    console.log("[PreviewSession] 🔍 Getting session from localStorage...");
    console.log("[PreviewSession] Raw stored data:", stored ? "EXISTS" : "NULL");
    
    if (!stored) {
      console.log("[PreviewSession] ❌ No session in localStorage");
      return null;
    }

    const session = JSON.parse(stored) as PreviewPlayerSession;
    
    console.log("[PreviewSession] 📦 Parsed session:", {
      playerId: session.playerId ? session.playerId.slice(0, 8) + "..." : "MISSING",
      nickname: session.nickname || "MISSING",
      email: session.email || "MISSING",
      eventId: session.eventId ? session.eventId.slice(0, 8) + "..." : "MISSING",
      ticketCount: session.ticketIds?.length || 0,
      timestamp: new Date(session.timestamp).toLocaleString()
    });

    // Validate structure
    if (!session.playerId || !session.eventId || !session.nickname) {
      console.warn("[PreviewSession] ⚠️ Invalid session structure:", {
        hasPlayerId: !!session.playerId,
        hasEventId: !!session.eventId,
        hasNickname: !!session.nickname
      });
      console.warn("[PreviewSession] Clearing invalid session...");
      clearPreviewPlayerSession();
      return null;
    }

    // Check expiration
    if (Date.now() - session.timestamp > SESSION_TTL) {
      console.warn("[PreviewSession] ⏰ Session expired:", {
        age: Math.round((Date.now() - session.timestamp) / 1000 / 60),
        ttl: Math.round(SESSION_TTL / 1000 / 60)
      });
      console.warn("[PreviewSession] Clearing expired session...");
      clearPreviewPlayerSession();
      return null;
    }

    console.log("[PreviewSession] ✅ Valid session loaded");
    return session;
  } catch (error) {
    console.error("[PreviewSession] ❌ Failed to parse session:", error);
    clearPreviewPlayerSession();
    return null;
  }
}

/**
 * Save Preview player session to localStorage
 */
export function setPreviewPlayerSession(session: Omit<PreviewPlayerSession, "timestamp">): void {
  if (typeof window === "undefined") return;

  console.log("[PreviewSession] 💾 Saving session to localStorage...");
  console.log("[PreviewSession] Input data:", {
    playerId: session.playerId ? session.playerId.slice(0, 8) + "..." : "MISSING",
    nickname: session.nickname || "MISSING",
    email: session.email || "MISSING",
    eventId: session.eventId ? session.eventId.slice(0, 8) + "..." : "MISSING",
    ticketCount: session.ticketIds?.length || 0
  });

  const fullSession: PreviewPlayerSession = {
    ...session,
    timestamp: Date.now()
  };

  try {
    const serialized = JSON.stringify(fullSession);
    localStorage.setItem(STORAGE_KEY, serialized);
    
    console.log("[PreviewSession] ✅ Session saved successfully");
    console.log("[PreviewSession] Saved data:", {
      playerId: fullSession.playerId.slice(0, 8) + "...",
      nickname: fullSession.nickname,
      ticketCount: fullSession.ticketIds.length,
      timestamp: new Date(fullSession.timestamp).toLocaleString()
    });
    
    // Verify it was saved
    const verified = localStorage.getItem(STORAGE_KEY);
    if (verified) {
      console.log("[PreviewSession] ✅ Verified: Session exists in localStorage");
    } else {
      console.error("[PreviewSession] ❌ ERROR: Session NOT saved to localStorage!");
    }
  } catch (error) {
    console.error("[PreviewSession] ❌ Failed to save session:", error);
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