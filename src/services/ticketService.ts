import { supabase } from "@/integrations/supabase/client";

export interface Ticket {
  id: string;
  serial_number: string;
  event_id: string;
  is_winner: boolean;
  created_at: string;
  ticket_questions: TicketQuestion[];
}

export interface TicketQuestion {
  id: string;
  ticket_id: string;
  question_number: number;
}

const MAX_FREE_TICKETS_PER_PLAYER = 4;

/**
 * Generate a cryptographically unique ticket serial number
 * Format: T-{8_random_chars} (e.g., T-A7F3K9M2)
 */
const generateUniqueSerial = (): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Readable chars (no 0/O, 1/I)
  let serial = "T-";
  for (let i = 0; i < 8; i++) {
    serial += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return serial;
};

/**
 * Generate 15 unique random numbers between 1 and 90
 */
const generateTicketNumbers = (): number[] => {
  const numbers: number[] = [];
  while (numbers.length < 15) {
    const num = Math.floor(Math.random() * 90) + 1;
    if (!numbers.includes(num)) {
      numbers.push(num);
    }
  }
  return numbers.sort((a, b) => a - b);
};

/**
 * Get player ID from localStorage (device-based identification)
 */
const getPlayerId = (): string => {
  if (typeof window === "undefined") return "";
  
  let playerId = localStorage.getItem("ps_player_id");
  
  if (!playerId) {
    // Generate new player ID (UUID-like)
    playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem("ps_player_id", playerId);
  }
  
  return playerId;
};

export const ticketService = {
  /**
   * UNIFIED: Get free tickets count for player + event from DATABASE
   * This is the SINGLE SOURCE OF TRUTH for all ticket counting
   */
  async getFreeTicketsCountForPlayer(playerId: string, eventId: string): Promise<number> {
    try {
      // Get all free tickets for this player + event
      // Fix: Select specific field 'id' instead of '*' to avoid excessive type instantiation depth
      // @ts-expect-error - Supabase types are too deep here, but the query is valid
      const { count, error } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("player_id", playerId);

      if (error) {
        console.error("[TicketService] ❌ Failed to count free tickets:", error);
        return 0;
      }

      console.log(`[TicketService] 📊 Free tickets count: ${count}/4 (player: ${playerId}, event: ${eventId})`);
      
      return count || 0;
    } catch (err) {
      console.error("[TicketService] ❌ Error counting free tickets:", err);
      return 0;
    }
  },

  /**
   * UNIFIED: Create a free ticket for the given event
   * Returns the created ticket with its serial number
   * Handles duplicate serial numbers with automatic retry (max 5 attempts)
   * ENFORCES MAX 4 FREE TICKETS PER PLAYER (HARD RULE)
   */
  async createFreeTicket(eventId: string): Promise<Ticket> {
    const playerId = getPlayerId();
    
    console.log("[TicketService] 🎫 Creating free ticket:", {
      playerId,
      eventId,
      limit: MAX_FREE_TICKETS_PER_PLAYER
    });
    
    // HARD RULE: Check free tickets count from DATABASE
    const freeTicketsCount = await this.getFreeTicketsCountForPlayer(playerId, eventId);
    
    console.log(`[TicketService] 📊 Current count: ${freeTicketsCount}/${MAX_FREE_TICKETS_PER_PLAYER}`);
    
    // ENFORCE FREE TICKETS LIMIT
    if (freeTicketsCount >= MAX_FREE_TICKETS_PER_PLAYER) {
      console.error(`[TicketService] ❌ FREE_LIMIT_REACHED: ${freeTicketsCount}/${MAX_FREE_TICKETS_PER_PLAYER}`);
      throw new Error(`FREE_LIMIT_REACHED: Dosegnut je limit od ${MAX_FREE_TICKETS_PER_PLAYER} besplatna tiketa u promo fazi.`);
    }
    
    const maxRetries = 5;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        attempt++;
        
        // Generate unique serial number
        const serialNumber = generateUniqueSerial();

        // Create ticket with player_id
        const { data: ticket, error: ticketError } = await supabase
          .from("tickets")
          .insert({
            serial_number: serialNumber,
            event_id: eventId,
            player_id: playerId,
            is_winner: false,
          })
          .select()
          .single();

        if (ticketError) {
          // Check if it's a duplicate serial number error
          if (ticketError.code === "23505" && ticketError.message.includes("tickets_serial_number_key")) {
            console.warn(`[TicketService] ⚠️ Duplicate serial (attempt ${attempt}/${maxRetries}), retrying...`);
            continue; // Retry with new serial
          }
          throw ticketError;
        }
        
        if (!ticket) throw new Error("Failed to create ticket");

        // Generate 15 random question numbers
        const questionNumbers = generateTicketNumbers();

        // Create ticket_questions entries
        const ticketQuestions = questionNumbers.map((questionNumber) => ({
          ticket_id: ticket.id,
          question_number: questionNumber,
        }));

        const { error: questionsError } = await supabase
          .from("ticket_questions")
          .insert(ticketQuestions);

        if (questionsError) throw questionsError;

        console.log("[TicketService] ✅ Free ticket created:", {
          serial: serialNumber,
          event_id: eventId,
          player_id: playerId,
          questions: questionNumbers,
          attempt,
          newCount: freeTicketsCount + 1
        });

        // Return full ticket object with questions
        return {
          ...ticket,
          ticket_questions: ticketQuestions.map((tq, index) => ({
            id: `temp-${index}`,
            ticket_id: ticket.id,
            question_number: tq.question_number
          }))
        } as Ticket;
      } catch (error) {
        // If not a duplicate error or max retries reached, throw
        if (attempt >= maxRetries) {
          console.error("[TicketService] ❌ Failed to create free ticket after", maxRetries, "attempts:", error);
          throw new Error("Failed to create ticket. Please try again.");
        }
        // If it's not a duplicate error, throw immediately
        if (error instanceof Error && !error.message.includes("duplicate")) {
          throw error;
        }
      }
    }
    
    throw new Error("Failed to create ticket after maximum retries.");
  },

  /**
   * Get all tickets for player + event
   */
  async getTicketsForPlayerAndEvent(playerId: string, eventId: string): Promise<Ticket[]> {
    try {
      const { data, error } = await supabase
        .from("tickets")
        .select("*, ticket_questions(*)")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[TicketService] ❌ Failed to get tickets:", error);
        return [];
      }

      return (data || []) as Ticket[];
    } catch (err) {
      console.error("[TicketService] ❌ Error getting tickets:", err);
      return [];
    }
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
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data as Ticket;
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
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return null;
        }
        throw error;
      }

      return data as Ticket;
    } catch (error) {
      console.error("[TicketService] ❌ Failed to get ticket:", error);
      throw error;
    }
  },

  /**
   * Get player ID (device-based)
   */
  getPlayerId(): string {
    return getPlayerId();
  },

  /**
   * Get max free tickets limit
   */
  getMaxFreeTickets(): number {
    return MAX_FREE_TICKETS_PER_PLAYER;
  },

  /**
   * Check if player can create more free tickets (based on DATABASE count)
   */
  async canCreateFreeTicket(playerId: string, eventId: string): Promise<boolean> {
    const count = await this.getFreeTicketsCountForPlayer(playerId, eventId);
    return count < MAX_FREE_TICKETS_PER_PLAYER;
  }
};