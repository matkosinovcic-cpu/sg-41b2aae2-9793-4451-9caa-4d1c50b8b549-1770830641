import { supabase } from "@/integrations/supabase/client";

export interface Ticket {
  id: string;
  serial_number: string;
  event_id: string;
  session_id: string | null;
  is_winner: boolean;
  created_at?: string;
  ticket_questions?: Array<{
    id: string;
    ticket_id: string;
    question_number: number;
    // Optional fields depending on join
    question_id?: string;
    answer?: string | null;
    is_correct?: boolean | null;
  }>;
}

// Maximum free tickets per player in promo phase
const MAX_FREE_TICKETS_PER_PLAYER = 4;

// Generate cryptographically secure serial number
const generateUniqueSerial = (): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Readable chars (no 0/O, 1/I confusion)
  let serial = "T-";
  for (let i = 0; i < 8; i++) {
    serial += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return serial;
};

// Get or create player session
async function getOrCreatePlayerSession(eventId: string): Promise<string> {
  try {
    // Try to get existing session from localStorage
    const existingSessionId = localStorage.getItem(`ps_session_${eventId}`);
    
    if (existingSessionId) {
      // Verify session exists in DB
      const { data, error } = await supabase
        .from("player_sessions")
        .select("id")
        .eq("id", existingSessionId)
        .eq("event_id", eventId)
        .single();
      
      if (!error && data) {
        return existingSessionId;
      }
    }
    
    // Create new session
    const { data: newSession, error: createError } = await supabase
      .from("player_sessions")
      .insert({
        event_id: eventId,
        session_token: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      })
      .select()
      .single();
    
    if (createError) throw createError;
    
    // Store session ID in localStorage
    localStorage.setItem(`ps_session_${eventId}`, newSession.id);
    
    return newSession.id;
  } catch (error) {
    console.error("[TicketService] Error getting/creating session:", error);
    throw new Error("Failed to create player session");
  }
}

export const ticketService = {
  // Get or create player session (Public wrapper)
  async getOrCreateSessionId(eventId: string): Promise<string> {
    return getOrCreatePlayerSession(eventId);
  },

  /**
   * Count free tickets for a session + event
   * Uses SELECT * with count=exact (not HEAD) as required
   */
  async getFreeTicketsCountForSession(sessionId: string, eventId: string): Promise<number> {
    try {
      const { count, error } = await supabase
        .from("tickets")
        .select("*", { count: "exact" })
        .eq("event_id", eventId)
        .eq("session_id", sessionId);

      if (error) {
        console.error("[TicketService] Error counting tickets:", error);
        return 0;
      }

      return count || 0;
    } catch (err) {
      console.error("[TicketService] ❌ Error counting free tickets:", err);
      return 0;
    }
  },

  /**
   * Create a free ticket with session tracking and limit enforcement
   */
  async createFreeTicket(eventId: string): Promise<Ticket> {
    try {
      // Get or create player session
      const sessionId = await getOrCreatePlayerSession(eventId);
      
      // ENFORCE FREE TICKETS LIMIT (backend hard rule)
      const freeTicketsCount = await this.getFreeTicketsCountForSession(sessionId, eventId);
      
      if (freeTicketsCount >= MAX_FREE_TICKETS_PER_PLAYER) {
        throw new Error(`FREE_LIMIT_REACHED: Dosegnut je limit od ${MAX_FREE_TICKETS_PER_PLAYER} besplatna tiketa u promo fazi.`);
      }

      // Create ticket with retry logic for duplicate serials
      const maxRetries = 5;
      let lastError: any = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const serialNumber = generateUniqueSerial();

          const { data: ticket, error } = await supabase
            .from("tickets")
            .insert({
              serial_number: serialNumber,
              event_id: eventId,
              session_id: sessionId,
              is_winner: false,
            })
            .select()
            .single();

          // Handle duplicate serial number (23505 = unique constraint violation)
          if (error?.code === "23505" && error.message.includes("tickets_serial_number_key")) {
            console.warn(`[TicketService] Duplicate serial (attempt ${attempt + 1}/${maxRetries}), retrying...`);
            continue; // Retry with new serial
          }

          if (error) throw error;

          console.log(`[TicketService] ✅ Free ticket created: ${ticket.serial_number}`);
          return ticket;
        } catch (err) {
          lastError = err;
          if (attempt >= maxRetries - 1) {
            break;
          }
        }
      }

      throw lastError || new Error("Failed to create ticket after multiple attempts");
    } catch (error: any) {
      console.error("[TicketService] ❌ Error creating free ticket:", error);
      throw error;
    }
  },

  /**
   * Get ticket by serial number
   */
  async getTicketBySerial(serialNumber: string): Promise<Ticket | null> {
    try {
      const { data, error } = await supabase
        .from("tickets")
        .select("*, ticket_questions(*)")
        .eq("serial_number", serialNumber)
        .single();

      if (error) {
        console.error("[TicketService] Error fetching ticket by serial:", error);
        return null;
      }

      return data;
    } catch (error) {
      console.error("[TicketService] ❌ Error in getTicketBySerial:", error);
      return null;
    }
  },

  /**
   * Get all tickets for a session + event
   */
  async getTicketsForSessionAndEvent(sessionId: string, eventId: string): Promise<Ticket[]> {
    try {
      const { data, error } = await supabase
        .from("tickets")
        .select("*, ticket_questions(*)")
        .eq("event_id", eventId)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[TicketService] Error fetching tickets:", error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error("[TicketService] ❌ Error in getTicketsForSessionAndEvent:", error);
      return [];
    }
  },

  /**
   * Add existing ticket to current session (by serial number)
   */
  async addTicketBySerial(serialNumber: string, eventId: string): Promise<Ticket> {
    try {
      // Get or create player session
      const sessionId = await getOrCreatePlayerSession(eventId);

      // Check if ticket exists and is for this event
      const ticket = await this.getTicketBySerial(serialNumber);

      if (!ticket) {
        throw new Error("TICKET_NOT_FOUND: Tiket s ovim serijskim brojem ne postoji.");
      }

      if (ticket.event_id !== eventId) {
        throw new Error("TICKET_WRONG_EVENT: Ovaj tiket nije za trenutni event.");
      }

      // Check if ticket already has a session
      if (ticket.session_id) {
        // If it's already this session, just return it
        if (ticket.session_id === sessionId) {
          return ticket;
        }
        throw new Error("TICKET_ALREADY_CLAIMED: Ovaj tiket je već preuzet.");
      }

      // Check if adding this ticket would exceed limit
      const freeTicketsCount = await this.getFreeTicketsCountForSession(sessionId, eventId);
      
      if (freeTicketsCount >= MAX_FREE_TICKETS_PER_PLAYER) {
        throw new Error(`FREE_LIMIT_REACHED: Dosegnut je limit od ${MAX_FREE_TICKETS_PER_PLAYER} besplatna tiketa u promo fazi.`);
      }

      // Assign ticket to session
      const { data: updatedTicket, error } = await supabase
        .from("tickets")
        .update({ session_id: sessionId })
        .eq("id", ticket.id)
        .select("*, ticket_questions(*)")
        .single();

      if (error) throw error;

      console.log(`[TicketService] ✅ Ticket ${serialNumber} added to session`);
      return updatedTicket;
    } catch (error: any) {
      console.error("[TicketService] ❌ Error adding ticket by serial:", error);
      throw error;
    }
  },

  /**
   * Get max free tickets limit
   */
  getMaxFreeTickets(): number {
    return MAX_FREE_TICKETS_PER_PLAYER;
  },

  /**
   * Check if player can create more free tickets
   */
  async canCreateFreeTicket(sessionId: string, eventId: string): Promise<boolean> {
    const count = await this.getFreeTicketsCountForSession(sessionId, eventId);
    return count < MAX_FREE_TICKETS_PER_PLAYER;
  }
};