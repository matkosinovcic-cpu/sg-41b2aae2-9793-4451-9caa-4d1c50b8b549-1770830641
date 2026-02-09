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
    console.log("=== [TicketService] CLAIM FREE TICKETS START ===");
    
    const rpcName = "claim_free_tickets";
    const payload = {
      p_email: email,
      p_nickname: nickname,
      p_limit: 1
    };

    console.log("[TicketService] Calling RPC:", rpcName);
    console.log("[TicketService] Payload:", JSON.stringify(payload, null, 2));

    try {
      const { data: rawData, error } = await supabase.rpc(rpcName, payload);
      const data = rawData as any;

      if (error) {
        console.error("[TicketService] ❌ RPC Error:", {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }

      console.log("[TicketService] ✅ RPC Success:", {
        success: data?.success,
        tickets_created: data?.tickets_created,
        event_id: data?.event_id,
        venue_id: data?.venue_id,
        player_id: data?.player_id
      });

      // Log first 2 tickets preview
      if (data?.tickets && Array.isArray(data.tickets)) {
        const preview = data.tickets.slice(0, 2).map((t: any) => ({
          id: t.id,
          serial: t.serial_number,
          has_numbers: Array.isArray(t.ticket_numbers) && t.ticket_numbers.length > 0,
          numbers_count: t.numbers_count || (Array.isArray(t.ticket_numbers) ? t.ticket_numbers.length : 0)
        }));
        console.log("[TicketService] First 2 tickets preview:", preview);
      }

      console.log("=== [TicketService] CLAIM FREE TICKETS END ===");

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
    
    console.log("[ticketService] getTicket result:", {
      id: data.id,
      serial: data.serial_number,
      has_numbers: Array.isArray(data.ticket_numbers),
      numbers_count: data.ticket_numbers?.length || 0,
      numbers_preview: data.ticket_numbers?.slice(0, 5) || []
    });
    
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