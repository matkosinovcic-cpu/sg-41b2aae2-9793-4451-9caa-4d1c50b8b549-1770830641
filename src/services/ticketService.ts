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

function generateTicketNumbers(): { question_number: number }[] {
  const numbers: number[] = [];
  while (numbers.length < 15) {
    const num = Math.floor(Math.random() * 90) + 1;
    if (!numbers.includes(num)) {
      numbers.push(num);
    }
  }
  return numbers.map(n => ({ question_number: n }));
}

/**
 * Generate a cryptographically secure unique serial number for a ticket
 */
function generateUniqueSerial(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  
  // Use crypto.getRandomValues for secure random generation
  const randomBytes = new Uint8Array(4);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(randomBytes);
  } else {
    // Fallback for server-side (should not happen in browser)
    for (let i = 0; i < randomBytes.length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  
  const randomPart = Array.from(randomBytes)
    .map(b => b.toString(36).toUpperCase())
    .join("")
    .slice(0, 8);
  
  return `T${timestamp}${randomPart}`;
}

/**
 * Create a single ticket with retry logic for unique serial number conflicts
 */
async function createSingleTicketWithRetry(
  eventId: string,
  sessionId: string,
  maxRetries: number = 5
): Promise<{ id: string; serial_number: string }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const serialNumber = generateUniqueSerial();
      
      // Generate 15 unique random numbers for the ticket
      const numbers: number[] = [];
      while (numbers.length < 15) {
        const num = Math.floor(Math.random() * 90) + 1;
        if (!numbers.includes(num)) {
          numbers.push(num);
        }
      }
      
      // Insert ticket
      const { data: ticket, error: ticketError } = await supabase
        .from("tickets")
        .insert({
          serial_number: serialNumber,
          event_id: eventId,
          session_id: sessionId,
          is_winner: false,
        })
        .select("id, serial_number")
        .single();
      
      if (ticketError) {
        // Check for unique constraint violation (duplicate serial)
        if (ticketError.code === "23505" && attempt < maxRetries - 1) {
          console.warn(`Serial collision on attempt ${attempt + 1}, retrying...`);
          continue; // Retry with new serial
        }
        throw ticketError;
      }
      
      if (!ticket) {
        throw new Error("Failed to create ticket");
      }
      
      // Insert ticket questions
      const ticketQuestions = numbers.map(num => ({
        ticket_id: ticket.id,
        question_number: num,
      }));
      
      const { error: questionsError } = await supabase
        .from("ticket_questions")
        .insert(ticketQuestions);
      
      if (questionsError) {
        // Rollback: delete the ticket if questions failed
        await supabase.from("tickets").delete().eq("id", ticket.id);
        throw questionsError;
      }
      
      return ticket;
      
    } catch (error) {
      if (attempt === maxRetries - 1) {
        throw error; // Last attempt failed, propagate error
      }
      // Continue to next attempt
    }
  }
  
  throw new Error("Failed to create ticket after maximum retries");
}

/**
 * TEST PHASE: Create multiple free tickets for a player
 * Maximum 4 tickets per player per event
 */
export async function createFreeTicketsForPlayer(
  eventId: string,
  sessionId: string,
  requestedCount: number
): Promise<{ created: number; tickets: Array<{ id: string; serial_number: string }> }> {
  // 1. Get existing tickets for this session + event
  const { data: existingTickets, error: fetchError } = await supabase
    .from("tickets")
    .select("id")
    .match({ session_id: sessionId, event_id: eventId });
  
  if (fetchError) {
    console.error("Error fetching existing tickets:", fetchError);
    throw fetchError;
  }
  
  const existing = existingTickets?.length || 0;
  const MAX_FREE_TICKETS = 4;
  const remaining = Math.max(0, MAX_FREE_TICKETS - existing);
  const toCreate = Math.min(requestedCount, remaining);
  
  if (toCreate <= 0) {
    return { created: 0, tickets: [] };
  }
  
  // 2. Create toCreate tickets with retry logic
  const createdTickets: Array<{ id: string; serial_number: string }> = [];
  
  for (let i = 0; i < toCreate; i++) {
    try {
      const ticket = await createSingleTicketWithRetry(eventId, sessionId);
      createdTickets.push(ticket);
    } catch (error) {
      console.error(`Failed to create ticket ${i + 1}/${toCreate}:`, error);
      // Continue creating remaining tickets even if one fails
    }
  }
  
  return { created: createdTickets.length, tickets: createdTickets };
}

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
        const ticketQuestions = questionNumbers.map((item) => ({
          ticket_id: ticket.id,
          question_number: item.question_number,
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

  createFreeTicketsForPlayer,
};