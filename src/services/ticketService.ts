import { supabase } from "@/integrations/supabase/client";
import { generateTicketSerial } from "@/lib/utils";
import { v4 as uuidv4 } from 'uuid';
import { getPlayerId } from "@/lib/playerHelper";

export interface Ticket {
  id: string;
  event_id: string;
  serial_number: string;
  status: 'active' | 'used' | 'expired';
  created_at: string;
  session_id: string;
  player_id?: string; // Added field
}

export interface TicketQuestion {
  id: string;
  ticket_id: string;
  question_number: number;
}

const MAX_FREE_TICKETS_PER_PLAYER = 4;

/**
 * Creates a free ticket for an event
 * @param eventId The event ID
 * @param playerId Optional player ID if registered
 * @returns The created ticket
 */
export async function createFreeTicket(eventId: string, playerId?: string): Promise<Ticket> {
  console.log("[TicketService] Creating free ticket for event:", eventId);

  // 1. Get or create a session ID (fingerprint)
  let sessionId = localStorage.getItem("ps_session_id");
  if (!sessionId) {
    sessionId = uuidv4();
    localStorage.setItem("ps_session_id", sessionId);
  }

  // 2. Resolve player_id if not provided
  const resolvedPlayerId = playerId || getPlayerId();

  // 3. Generate unique serial
  const serialNumber = generateTicketSerial();

  // 4. Create ticket in database
  const { data, error } = await supabase
    .from("tickets")
    .insert({
      event_id: eventId,
      serial_number: serialNumber,
      status: "active",
      session_id: sessionId,
      player_id: resolvedPlayerId, // Link to player profile
    })
    .select()
    .single();

  if (error) {
    console.error("[TicketService] Error creating ticket:", error);
    
    // Check for limit reached error (from database trigger or constraint if exists)
    if (error.message.includes("limit")) {
      throw new Error("FREE_LIMIT_REACHED");
    }
    
    throw error;
  }

  console.log("[TicketService] Ticket created:", data.serial_number);
  return data as Ticket;
}

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

/**
 * Get free tickets count for current player and event from localStorage
 */
const getFreeTicketsCount = (eventId: string): number => {
  if (typeof window === "undefined") return 0;
  try {
    const key = `ps_free_tickets_${eventId}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored).length : 0;
  } catch {
    return 0;
  }
};

/**
 * Store free ticket serial in localStorage
 */
const storeFreeTicket = (eventId: string, serial: string): void => {
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
};

export const ticketService = {
  /**
   * Create a free ticket for the given event
   * Returns the created ticket with its serial number
   * Handles duplicate serial numbers with automatic retry (max 5 attempts)
   * ENFORCES MAX 4 FREE TICKETS PER PLAYER
   */
  async createFreeTicket(eventId: string): Promise<Ticket> {
    const playerId = getPlayerId();
    const freeTicketsCount = getFreeTicketsCount(eventId);
    
    console.log("[TicketService] 🎫 Creating free ticket:", {
      playerId,
      eventId,
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
        const serialNumber = generateUniqueSerial();

        // Create ticket
        const { data: ticket, error: ticketError } = await supabase
          .from("tickets")
          .insert({
            serial_number: serialNumber,
            event_id: eventId,
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
          questions: questionNumbers,
          attempt,
          freeTicketsCount: freeTicketsCount + 1
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