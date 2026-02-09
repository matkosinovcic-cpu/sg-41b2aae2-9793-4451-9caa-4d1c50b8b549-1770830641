import { supabase } from "@/integrations/supabase/client";

export interface Ticket {
  id: string;
  serial_number: string;
  event_id: string;
  venue_id?: string;
  is_winner: boolean;
  ticket_numbers?: number[];
  ticket_questions?: any[];
  created_at: string;
}

export const ticketService = {
  // RPC Claim Function
  async claimFreeTickets(email: string, nickname: string) {
    console.log("=== [TicketService] claimFreeTickets START ===");
    console.log("[TicketService] Input:", { email, nickname });

    try {
      // Get active event
      const { data: event, error: eventError } = await supabase
        .from("events")
        .select("id, name, venue_id")
        .eq("status", "active")
        .single();

      if (eventError || !event) {
        console.error("[TicketService] No active event found:", eventError);
        throw new Error("No active event found");
      }

      console.log("[TicketService] Active event:", {
        event_id: event.id,
        event_name: event.name,
        venue_id: event.venue_id || "NULL"
      });

      const rpcName = "claim_free_tickets";
      const payload = {
        p_email: email,
        p_limit: 1,
        p_nickname: nickname
      };

      console.log("[TicketService] Calling RPC:", rpcName);
      console.log("[TicketService] RPC Payload:", JSON.stringify(payload, null, 2));

      const { data: rawData, error } = await supabase.rpc(rpcName, payload);
      const data = rawData as any;

      if (error) {
        console.error("[TicketService] RPC Error:", JSON.stringify(error, null, 2));
        throw error;
      }

      console.log("[TicketService] RPC Response:", {
        success: data?.success,
        tickets_created: data?.tickets_created || 0,
        has_tickets_array: Array.isArray(data?.tickets)
      });

      if (data?.tickets && Array.isArray(data.tickets)) {
        const first2 = data.tickets.slice(0, 2);
        console.log("[TicketService] First 2 tickets:", first2.map((t: any) => ({
          id: t.id,
          serial: t.serial_number,
          has_numbers: Array.isArray(t.ticket_numbers) && t.ticket_numbers.length > 0,
          numbers_count: t.ticket_numbers?.length || 0
        })));
      }

      console.log("=== [TicketService] claimFreeTickets END ===");
      return data;
    } catch (err: any) {
      console.error("[TicketService] Claim Error:", JSON.stringify(err, null, 2));
      throw err;
    }
  },

  // Added for compatibility with play.tsx
  getMaxFreeTickets() {
    return 1;
  },

  // Added for compatibility with play.tsx (legacy direct call, redirect to claim)
  async createFreeTicket(email: string, nickname: string, eventId: string) {
    return this.claimFreeTickets(email, nickname);
  },

  // Standard get ticket (needed for player.tsx)
  async getTicket(ticketId: string) {
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", ticketId)
      .single();
    
    if (error) throw error;
    return data as Ticket;
  },

  async getPlayerTickets(email: string, eventId: string) {
    const { data: player } = await supabase
      .from("players")
      .select("id")
      .eq("email", email)
      .single();

    if (!player) return [];

    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .eq("event_id", eventId)
      .eq("player_id", player.id);
    
    if (error) throw error;
    return data as Ticket[];
  }
};