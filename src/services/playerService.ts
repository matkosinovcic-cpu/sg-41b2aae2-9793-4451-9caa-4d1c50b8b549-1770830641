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

export function getPlayer() {
  if (typeof window === "undefined") return null;
  const playerJson = localStorage.getItem("player_data");
  return playerJson ? JSON.parse(playerJson) : null;
}

const playerService = {
  createPlayer,
  getPlayerById,
  checkEmailExists,
};

export default playerService;