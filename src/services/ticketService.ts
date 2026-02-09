import { supabase } from "@/integrations/supabase/client";
import { getPlayer, createPlayer } from "./playerService";

export interface Ticket {
  id: string;
  serial_number: string;
  ticket_numbers: number[]; // Now backed by real DB column
  event_id: string;
  venue_id: string;
  player_id?: string;
}

/**
 * Creates/Claims a free ticket using a fallback strategy:
 * 1. Try v3 (Explicit event_id + venue_id)
 * 2. Fallback to v1/legacy (Implicit)
 */
export async function createFreeTicket(
  eventId: string, 
  venueId: string,
  email?: string,
  nickname?: string
): Promise<Ticket> {
  const playerEmail = email || localStorage.getItem("playerEmail");
  const playerNickname = nickname || localStorage.getItem("playerNickname");

  if (!playerEmail || !playerNickname) {
    throw new Error("Nedostaju podaci o igraču (email/nadimak).");
  }

  console.log(`[TicketService] 🎫 Attempting claim for ${playerEmail} at venue ${venueId}`);

  try {
    // STRATEGY 1: Call claim_free_tickets_v3 (Explicit)
    console.log("[TicketService] 🔄 Trying strategy A: claim_free_tickets_v3");
    
    const { data: v3Data, error: v3Error } = await supabase.rpc("claim_free_tickets_v3", {
      p_event_id: eventId,
      p_venue_id: venueId,
      p_email: playerEmail,
      p_nickname: playerNickname,
      p_limit: 1
    });

    if (v3Error) {
      console.warn("[TicketService] ⚠️ Strategy A failed:", v3Error);
      
      // Check if function doesn't exist to decide if we should retry
      // But user requested fallback on error, so we proceed to strategy B
      throw v3Error; 
    }

    // Cast to any to avoid TS errors with Json type
    const v3Result = v3Data as any;

    if (v3Result && v3Result.tickets && v3Result.tickets.length > 0) {
      console.log("[TicketService] ✅ Strategy A success!");
      return v3Result.tickets[0];
    }
    
    throw new Error("Strategy A returned no tickets");

  } catch (err: any) {
    console.warn("[TicketService] ⚠️ Fallback to Strategy B due to:", err.message);

    // STRATEGY 2: Legacy fallback (claim_free_tickets)
    // This usually relies on finding the "first active event"
    console.log("[TicketService] 🔄 Trying strategy B: claim_free_tickets (Legacy)");
    
    const { data: v1Data, error: v1Error } = await supabase.rpc("claim_free_tickets", {
      p_email: playerEmail,
      p_limit: 1,
      p_nickname: playerNickname
    });

    if (v1Error) {
      console.error("[TicketService] ❌ All strategies failed.");
      // Throw the ORIGINAL error if possible, or the new one
      throw v1Error;
    }

    // Cast to any to avoid TS errors with Json type
    const v1Result = v1Data as any;

    if (v1Result && v1Result.tickets && v1Result.tickets.length > 0) {
      console.log("[TicketService] ✅ Strategy B success (Legacy)");
      return v1Result.tickets[0];
    }

    throw new Error("No tickets available (All strategies failed).");
  }
}

// Add legacy alias for compatibility
export async function getTicket(id: string) {
  const { data, error } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("[TicketService] Error fetching ticket:", error);
    return null;
  }
  return data;
}

export async function getTicketWithAnswers(ticketId: string) {
  const { data, error } = await supabase
    .from("tickets")
    .select(`
      *,
      answers (*)
    `)
    .eq("id", ticketId)
    .single();

  if (error) {
    console.error("[TicketService] Error fetching ticket with answers:", error);
    throw error;
  }

  return data;
}

export async function getTicketBySerial(serial: string) {
  const { data, error } = await supabase
    .from("tickets")
    .select(`
      *,
      ticket_questions (
        question_number
      )
    `)
    .eq("serial_number", serial)
    .single();

  if (error) {
    console.error("[TicketService] Error fetching ticket by serial:", error);
    return null;
  }

  return data;
}