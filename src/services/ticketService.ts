import { supabase } from "@/integrations/supabase/client";
import { generateTicketSerial } from "@/lib/utils";
import { getPlayerId } from "@/lib/playerHelper";

export interface Ticket {
  id: string;
  event_id: string;
  serial_number: string;
  created_at: string;
  session_id: string;
  player_id: string | null;
  is_winner: boolean;
}

export interface TicketQuestion {
  id: string;
  ticket_id: string;
  question_number: number;
}

const MAX_FREE_TICKETS_PER_PLAYER = 4;

/**
 * Generate a unique session ID (device fingerprint)
 */
function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "server";
  
  let sessionId = localStorage.getItem("ps_session_id");
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem("ps_session_id", sessionId);
  }
  
  return sessionId;
}

/**
 * Generate 15 random question numbers (1-60)
 */
function generateTicketNumbers(): number[] {
  const numbers: number[] = [];
  const available = Array.from({ length: 60 }, (_, i) => i + 1);
  
  for (let i = 0; i < 15; i++) {
    const randomIndex = Math.floor(Math.random() * available.length);
    numbers.push(available[randomIndex]);
    available.splice(randomIndex, 1);
  }
  
  return numbers.sort((a, b) => a - b);
}

/**
 * Get free tickets count for current player and event from localStorage
 */
function getFreeTicketsCount(eventId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const key = `ps_free_tickets_${eventId}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored).length : 0;
  } catch {
    return 0;
  }
}

/**
 * Store free ticket serial in localStorage
 */
function storeFreeTicket(eventId: string, serial: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = `ps_free_tickets_${eventId}`;
    const tickets = JSON.parse(localStorage.getItem(key) || "[]");
    if (!tickets.includes(serial)) {
      tickets.push(serial);
      localStorage.setItem(key, JSON.stringify(tickets));
    }
  } catch (err) {
    console.error("[TicketService] Failed to store free ticket:", err);
  }
}

export const ticketService = {
  /**
   * Create a free ticket for the given event
   * Returns the created ticket with its serial number
   * Handles duplicate serial numbers with automatic retry (max 5 attempts)
   * ENFORCES MAX 4 FREE TICKETS PER PLAYER
   */
  async createFreeTicket(eventId: string, playerId?: string): Promise<Ticket> {
    const freeTicketsCount = getFreeTicketsCount(eventId);
    
    console.log("[TicketService] 🎫 Creating free ticket:", {
      eventId,
      playerId: playerId || "will be resolved",
      currentFreeCount: freeTicketsCount,
      limit: MAX_FREE_TICKETS_PER_PLAYER
    });
    
    // ENFORCE FREE TICKETS LIMIT
    if (freeTicketsCount >= MAX_FREE_TICKETS_PER_PLAYER) {
      throw new Error(`FREE_LIMIT_REACHED: Dosegnut je limit od ${MAX_FREE_TICKETS_PER_PLAYER} besplatna tiketa u promo fazi.`);
    }
    
    const maxRetries = 5;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        attempt++;
        
        // Generate unique serial number
        const serialNumber = generateTicketSerial();
        
        // Get session ID
        const sessionId = getOrCreateSessionId();
        
        // Resolve player_id (use provided or get from localStorage)
        const resolvedPlayerId = playerId || getPlayerId();

        // Create ticket
        const { data: ticket, error: ticketError } = await supabase
          .from("tickets")
          .insert({
            serial_number: serialNumber,
            event_id: eventId,
            session_id: sessionId,
            player_id: resolvedPlayerId,
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

        // Store in localStorage (client-side tracking)
        storeFreeTicket(eventId, serialNumber);

        console.log("[TicketService] ✅ Free ticket created:", {
          serial: serialNumber,
          event_id: eventId,
          player_id: resolvedPlayerId,
          questions: questionNumbers,
          attempt,
          freeTicketsCount: freeTicketsCount + 1
        });

        // Return ticket
        return ticket as Ticket;
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
   * Get a ticket by ID
   */
  async getTicket(ticketId: string): Promise<Ticket | null> {
    try {
      const { data, error } = await supabase
        .from("tickets")
        .select("*")
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
        .select("*")
        .eq("serial_number", serialNumber)
        .maybeSingle();

      if (error) throw error;
      return data as Ticket | null;
    } catch (error) {
      console.error("[TicketService] ❌ Failed to get ticket:", error);
      throw error;
    }
  },

  /**
   * Get free tickets count for current player and event
   */
  getFreeTicketsCount(eventId: string): number {
    return getFreeTicketsCount(eventId);
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
  canCreateFreeTicket(eventId: string): boolean {
    return getFreeTicketsCount(eventId) < MAX_FREE_TICKETS_PER_PLAYER;
  }
};