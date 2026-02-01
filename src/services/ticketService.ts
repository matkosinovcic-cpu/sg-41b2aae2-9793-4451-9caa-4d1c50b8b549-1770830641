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

export const ticketService = {
  /**
   * Create a free ticket for the given event
   * Returns the created ticket with its serial number
   * Handles duplicate serial numbers with automatic retry (max 5 attempts)
   */
  async createFreeTicket(eventId: string): Promise<Ticket> {
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

        console.log("[TicketService] ✅ Free ticket created:", {
          serial: serialNumber,
          event_id: eventId,
          questions: questionNumbers,
          attempt
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
        throw error;
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
};

export async function createFreeTicketsForPlayer(
  eventId: string,
  sessionId: string,
  requestedCount: number
): Promise<{ created: number; tickets: Array<{ id: string; serial_number: string }> }> {
  // 1. Get existing tickets for this session + event
  const { data: existingTickets, error: fetchError } = await supabase
    .from("tickets")
    .select("id")
    .eq("session_id", sessionId)
    .eq("event_id", eventId);
  
  if (fetchError) {
    console.error("Error fetching existing tickets:", fetchError);
    throw fetchError;
  }
}