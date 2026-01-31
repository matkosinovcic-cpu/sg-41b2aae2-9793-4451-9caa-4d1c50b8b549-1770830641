import { supabase } from "@/integrations/supabase/client";

export interface Ticket {
  id: string;
  serial_number: string;
  event_id: string;
  is_winner: boolean;
  created_at: string;
}

export interface TicketQuestion {
  id: string;
  ticket_id: string;
  question_number: number;
}

/**
 * Generate a unique ticket serial number
 * Format: TYYYYMMDD-XXXX (e.g., T20260131-0001)
 */
const generateTicketSerial = async (eventId: string): Promise<string> => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `T${dateStr}`;

  // Find the highest serial number for today
  const { data: existingTickets } = await supabase
    .from("tickets")
    .select("serial_number")
    .eq("event_id", eventId)
    .like("serial_number", `${prefix}%`)
    .order("serial_number", { ascending: false })
    .limit(1);

  let nextNumber = 1;
  if (existingTickets && existingTickets.length > 0) {
    const lastSerial = existingTickets[0].serial_number;
    const lastNumber = parseInt(lastSerial.split("-")[1], 10);
    nextNumber = lastNumber + 1;
  }

  return `${prefix}-${nextNumber.toString().padStart(4, "0")}`;
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
   */
  async createFreeTicket(eventId: string): Promise<Ticket> {
    try {
      // Generate serial number
      const serialNumber = await generateTicketSerial(eventId);

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

      if (ticketError) throw ticketError;
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
      });

      return ticket;
    } catch (error) {
      console.error("[TicketService] ❌ Failed to create free ticket:", error);
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
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // Not found
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error("[TicketService] ❌ Failed to get ticket:", error);
      throw error;
    }
  },
};