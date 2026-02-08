import { supabase } from "@/integrations/supabase/client";
import { generateTicketSerial } from "@/lib/utils";

// Standardized Storage Keys
const STORAGE_KEYS = {
  SESSION_ID: "ps_session_id",
  PLAYER_ID: "ps_player_id",
  // Legacy keys to clear/migrate
  LEGACY_SESSION: "session_id",
  LEGACY_PLAYER: "player_id",
  LEGACY_PLAYER_SESSION: "player_session_id"
};

export interface Ticket {
  id: string;
  event_id: string;
  serial_number: string;
  created_at: string;
  session_id: string;
  player_id: string | null;
  is_winner: boolean;
  ticket_questions?: {
    id: string;
    ticket_id: string;
    question_number: number;
  }[];
}

export interface TicketQuestion {
  id: string;
  ticket_id: string;
  question_number: number;
}

/**
 * Ensures a valid player session exists in the database.
 * This prevents FK constraint errors when creating tickets.
 */
async function ensureValidSession(eventId: string, playerId?: string): Promise<string> {
  // 1. Clean legacy keys
  try {
    const legacyKeys = [STORAGE_KEYS.LEGACY_SESSION, STORAGE_KEYS.LEGACY_PLAYER, STORAGE_KEYS.LEGACY_PLAYER_SESSION];
    legacyKeys.forEach(key => localStorage.removeItem(key));
  } catch (e) {
    // Ignore storage errors
  }

  // 2. Check for existing session in localStorage
  let sessionId = localStorage.getItem(STORAGE_KEYS.SESSION_ID);

  if (sessionId) {
    // Verify it exists in DB
    const { data } = await supabase
      .from("player_sessions")
      .select("id")
      .eq("id", sessionId)
      .maybeSingle();

    if (data) {
      // Session is valid
      return data.id;
    } else {
      // Session in storage is invalid/stale - clear it
      console.warn("[Session] Found invalid session in storage, clearing:", sessionId);
      localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
      sessionId = null;
    }
  }

  // 3. Create NEW session if none exists or was invalid
  if (!sessionId) {
    console.log("[Session] Creating new player session...");
    const sessionToken = crypto.randomUUID(); 
    
    const { data: newSession, error } = await supabase
      .from("player_sessions")
      .insert({
        event_id: eventId,
        player_id: playerId || null,
        session_token: sessionToken
      })
      .select("id")
      .single();

    if (error) {
      console.error("[Session] Failed to create session:", error);
      // Fallback: retry logic handled by caller or UI, but we can try once more
      const retryToken = crypto.randomUUID();
      const { data: retrySession, error: retryError } = await supabase
        .from("player_sessions")
        .insert({
          event_id: eventId,
          player_id: playerId || null,
          session_token: retryToken
        })
        .select("id")
        .single();
        
      if (retryError) throw retryError;
      sessionId = retrySession.id;
    } else {
      sessionId = newSession.id;
    }

    // 4. Save valid session
    localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
  }
  
  return sessionId;
}

const ticketService = {
  // Expose max tickets constant
  getMaxFreeTickets: () => 4,

  /**
   * Create a FREE ticket for a player
   * Handles session creation automatically to prevent FK errors.
   * 
   * @param eventId - The event ID
   * @param venueId - The venue ID (REQUIRED for venue-specific tickets)
   * @param playerId - Optional player ID
   */
  async createFreeTicket(eventId: string, venueId: string, playerId?: string): Promise<Ticket> {
    try {
      console.log("[TicketService] Creating free ticket for event:", eventId, "venue:", venueId);
      
      // CRITICAL: Ensure we have a valid DB session first
      const sessionId = await ensureValidSession(eventId, playerId);
      console.log("[TicketService] Using verified session:", sessionId);

      // 1. Generate unique serial
      const serialNumber = await this.generateUniqueSerial();

      // 2. Create ticket
      const { data, error } = await supabase
        .from("tickets")
        .insert({
          event_id: eventId,
          venue_id: venueId,  // ✅ CRITICAL: Always set venue_id
          serial_number: serialNumber,
          session_id: sessionId,
          player_id: playerId || null,
          is_winner: false
        })
        .select("*, ticket_questions(*)")
        .single();

      if (error) {
        console.error("[TicketService] DB Insert Error:", error);
        // If error is FK constraint on session, retry session creation once
        if (error.code === '23503' && error.message.includes('tickets_session_id_fkey')) {
           console.warn("[TicketService] Session FK error, forcing new session and retrying...");
           localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
           const newSessionId = await ensureValidSession(eventId, playerId);
           
           const { data: retryData, error: retryError } = await supabase
            .from("tickets")
            .insert({
              event_id: eventId,
              venue_id: venueId,  // ✅ CRITICAL: Always set venue_id
              serial_number: serialNumber,
              session_id: newSessionId,
              player_id: playerId || null,
              is_winner: false
            })
            .select("*, ticket_questions(*)")
            .single();
            
            if (retryError) throw retryError;
            // Generate numbers for retry
            await this.generateTicketNumbers(retryData.id);
            return retryData as Ticket;
        }
        throw error;
      }

      // 3. Generate random numbers for ticket
      await this.generateTicketNumbers(data.id);

      // 4. Return complete ticket (fetch again to get questions if needed, but select should handle it)
      // Since ticket_questions are inserted AFTER ticket, the initial select returned empty array
      // We need to construct the return object or fetch again.
      // Fetching again is safer.
      const completeTicket = await this.getTicket(data.id);
      
      console.log("[TicketService] Ticket created:", data.serial_number);
      return completeTicket || data as Ticket;
    } catch (error) {
      console.error("[TicketService] Failed to create ticket:", error);
      throw error;
    }
  },

  /**
   * Helper: Generate ticket numbers (1-90)
   */
  async generateTicketNumbers(ticketId: string) {
    // Generate 15 unique random numbers between 1-90
    const numbers = new Set<number>();
    while (numbers.size < 15) {
      numbers.add(Math.floor(Math.random() * 90) + 1);
    }
    
    const ticketQuestions = Array.from(numbers).map(num => ({
      ticket_id: ticketId,
      question_number: num
    }));

    const { error } = await supabase
      .from("ticket_questions")
      .insert(ticketQuestions);

    if (error) {
      console.error("[TicketService] Failed to generate numbers:", error);
    }
  },

  /**
   * Helper: Generate unique serial number
   */
  async generateUniqueSerial(): Promise<string> {
    let isUnique = false;
    let serial = "";
    
    while (!isUnique) {
      serial = generateTicketSerial();
      
      // Check if exists
      const { count } = await supabase
        .from("tickets")
        .select("*", { count: 'exact', head: true })
        .eq("serial_number", serial);
        
      if (count === 0) isUnique = true;
    }
    return serial;
  },

  /**
   * Get total free tickets count for this device/session
   */
  async getFreeTicketsCount(eventId: string): Promise<number> {
    const sessionId = localStorage.getItem(STORAGE_KEYS.SESSION_ID);
    if (!sessionId) return 0;

    const { count } = await supabase
      .from("tickets")
      .select("*", { count: 'exact', head: true })
      .eq("event_id", eventId)
      .eq("session_id", sessionId);

    return count || 0;
  },

  /**
   * Check if player can get more free tickets
   */
  async canGetFreeTicket(eventId: string): Promise<boolean> {
    const count = await this.getFreeTicketsCount(eventId);
    // Hardcoded max tickets limit (e.g., 4)
    return count < 4;
  },

  /**
   * Get a ticket by ID
   */
  async getTicket(ticketId: string): Promise<Ticket | null> {
    try {
      const { data, error } = await supabase
        .from("tickets")
        .select("*, ticket_questions(*)")
        .eq("id", ticketId)
        .maybeSingle();

      if (error) throw error;
      return data as Ticket | null;
    } catch (error) {
      console.error("[TicketService] ❌ Failed to get ticket by ID:", error);
      throw error;
    }
  },

  /**
   * Get a ticket by serial number
   */
  async getTicketBySerial(serialNumber: string): Promise<Ticket | null> {
    try {
      const { data, error } = await supabase
        .from("tickets")
        .select("*, ticket_questions(*)")
        .eq("serial_number", serialNumber)
        .maybeSingle();

      if (error) throw error;
      return data as Ticket | null;
    } catch (error) {
      console.error("[TicketService] ❌ Failed to get ticket:", error);
      throw error;
    }
  }
};

/**
 * Atomically claim free tickets for a player (max 4)
 * Uses RPC function to ensure transaction safety and idempotency
 * 
 * @param eventId - The event ID
 * @param venueId - The venue ID (REQUIRED for venue-specific tickets)
 * @param email - Player email
 * @param nickname - Player nickname
 * @param limit - Maximum tickets to create (default 4)
 */
export async function claimFreeTickets(
  eventId: string,
  venueId: string,
  email: string,
  nickname: string,
  limit: number = 4
): Promise<{
  success: boolean;
  tickets_created: number;
  total_tickets: number;
  session_id: string;
  user_id: string;
  tickets: Array<{
    id: string;
    serial_number: string;
    source: string;
    created_at: string;
    venue_id: string;
  }>;
  error?: string;
  event_id?: string;
  event_name?: string;
  venue_name?: string;
}> {
  console.log(`[TicketService] 🎟️ Claiming free tickets for ${email} (event: ${eventId}, venue: ${venueId}, limit: ${limit})`);

  // Normalize email (lowercase + trim) before sending to backend
  const normalizedEmail = email.trim().toLowerCase();

  if (!eventId) throw new Error("Event ID is required");
  if (!venueId) throw new Error("Venue ID is required");

  try {
    // Call the MAIN RPC function (Version 2) with 5 parameters
    const { data, error } = await supabase.rpc("claim_free_tickets", {
      p_email: normalizedEmail,
      p_nickname: nickname.trim(),
      p_event_id: eventId,
      p_venue_id: venueId,
      p_limit: limit,
    });

    if (error) {
      console.error("[TicketService] ❌ RPC error:", error);
      throw new Error(error.message || "Failed to claim tickets");
    }

    if (!data) {
      throw new Error("No data returned from RPC");
    }

    // Parse RPC response (handle both string and object return types just in case)
    const result = typeof data === "string" ? JSON.parse(data) : data;

    if (!result.success) {
      console.error("[TicketService] ❌ RPC returned error:", result.error);
      throw new Error(result.error || "Failed to claim tickets");
    }

    console.log(
      `[TicketService] ✅ Successfully claimed ${result.tickets_created} tickets`
    );

    return result;
  } catch (err) {
    console.error("[TicketService] ❌ Failed to claim free tickets:", err);
    throw err;
  }
}

export default ticketService;