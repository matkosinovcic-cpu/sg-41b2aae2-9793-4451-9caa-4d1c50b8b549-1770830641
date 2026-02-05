/**
 * Player Service - Handles player profile operations
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Player = Database["public"]["Tables"]["players"]["Row"];
type PlayerInsert = Database["public"]["Tables"]["players"]["Insert"];

/**
 * Create a new player profile
 * Returns player_id (UUID)
 */
export async function createPlayer(
  nickname: string,
  email: string
): Promise<Player> {
  console.log("[PlayerService] Creating player:", { nickname, email });

  // Check if email already exists
  const { data: existing, error: checkError } = await supabase
    .from("players")
    .select("id, email")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  if (checkError) {
    console.error("[PlayerService] Error checking email:", checkError);
    throw new Error("Greška pri provjeri emaila");
  }

  if (existing) {
    console.log("[PlayerService] Email already exists, returning existing player");
    return existing as Player;
  }

  // Create new player
  const playerData: PlayerInsert = {
    nickname: nickname.trim(),
    email: email.toLowerCase().trim(),
  };

  const { data, error } = await supabase
    .from("players")
    .insert(playerData)
    .select()
    .single();

  if (error) {
    console.error("[PlayerService] Error creating player:", error);
    
    // Check for unique constraint violation (duplicate email)
    if (error.code === "23505") {
      throw new Error("Email je već registriran");
    }
    
    throw new Error("Greška pri izradi profila");
  }

  console.log("[PlayerService] Player created successfully:", data.id);
  return data as Player;
}

/**
 * Get player by ID
 */
export async function getPlayerById(playerId: string): Promise<Player | null> {
  console.log("[PlayerService] Getting player by ID:", playerId);

  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("id", playerId)
    .maybeSingle();

  if (error) {
    console.error("[PlayerService] Error getting player:", error);
    return null;
  }

  console.log("[PlayerService] Player found:", data?.id);
  return data as Player | null;
}

/**
 * Check if email exists
 */
export async function checkEmailExists(email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("players")
    .select("id")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  if (error) {
    console.error("[PlayerService] Error checking email:", error);
    return false;
  }

  return data !== null;
}

const playerService = {
  createPlayer,
  getPlayerById,
  checkEmailExists,
};

/**
 * Get the currently active event
 */
export async function getActiveEvent(): Promise<Database["public"]["Tables"]["events"]["Row"] | null> {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (error) {
    console.error("[PlayerService] Error fetching active event:", error);
    return null;
  }
  return data;
}

/**
 * Get tickets for a player in an event
 */
export async function getPlayerTickets(
  playerId: string,
  eventId: string
): Promise<Database["public"]["Tables"]["tickets"]["Row"][]> {
  const { data, error } = await supabase
    .from("tickets")
    .select("*")
    .eq("player_id", playerId)
    .eq("event_id", eventId);

  if (error) {
    console.error("[PlayerService] Error fetching tickets:", error);
    return [];
  }
  return data || [];
}

/**
 * Get answers for a specific ticket
 */
export async function getTicketAnswers(
  ticketId: string
): Promise<Database["public"]["Tables"]["answers"]["Row"][]> {
  const { data, error } = await supabase
    .from("answers")
    .select("*")
    .eq("ticket_id", ticketId);

  if (error) {
    // It's possible the answers table structure is different or we should use player_answers
    // Based on schema, we have 'answers' table with ticket_id
    console.error("[PlayerService] Error fetching answers:", error);
    return [];
  }
  return data || [];
}

/**
 * Get drawn numbers for an event (from drawn_numbers table if it exists, or event.drawn_numbers)
 * Based on schema, events table has drawn_numbers array column.
 * But schema analysis didn't show drawn_numbers TABLE, just event_questions table.
 * However, the error message in previous turn mentioned drawn_numbers type.
 * Let's check schema again... Ah, there is NO drawn_numbers table in the schema output!
 * But events table has drawn_numbers: integer[] column.
 * And there is event_questions table with drawn boolean.
 * We should return number[] from events table.
 */
export async function getDrawnNumbers(eventId: string): Promise<{ number: number }[]> {
  const { data, error } = await supabase
    .from("events")
    .select("drawn_numbers")
    .eq("id", eventId)
    .single();

  if (error) {
    console.error("[PlayerService] Error fetching drawn numbers:", error);
    return [];
  }
  
  // Transform integer[] to {number: number}[] to match expected type in player.tsx
  return (data?.drawn_numbers || []).map(num => ({ number: num }));
}

export default playerService;