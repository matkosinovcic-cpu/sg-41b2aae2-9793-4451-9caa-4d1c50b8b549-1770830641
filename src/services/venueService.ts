import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Venue = Database["public"]["Tables"]["venues"]["Row"];

export async function getVenues() {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .order("name");

  if (error) {
    console.error("[VENUE SERVICE] Error fetching venues:", error);
    return [];
  }

  return data;
}

export async function getVenueById(id: string) {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("[VENUE SERVICE] Error fetching venue by ID:", error);
    return null;
  }
  return data;
}

export async function getVenueBySlug(slug: string) {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error) {
    console.error("[VENUE SERVICE] Error fetching venue by slug:", error);
    return null;
  }
  return data;
}