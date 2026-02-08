import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type Venue = Tables<"venues">;

/**
 * Get venue by slug
 */
export async function getVenueBySlug(slug: string): Promise<Venue | null> {
  console.log("[VENUE SERVICE] getVenueBySlug:", slug);
  
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("[VENUE SERVICE] Error fetching venue:", error);
    return null;
  }

  console.log("[VENUE SERVICE] Venue found:", data);
  return data;
}

/**
 * Get or create venue by slug
 * If venue doesn't exist, creates it with name = nameFallback or slug
 */
export async function getOrCreateVenue(
  slug: string,
  nameFallback?: string
): Promise<Venue | null> {
  console.log("[VENUE SERVICE] getOrCreateVenue:", { slug, nameFallback });

  // Try to get existing venue
  const venue = await getVenueBySlug(slug);
  
  if (venue) {
    console.log("[VENUE SERVICE] Venue already exists:", venue);
    return venue;
  }

  // Create new venue
  const venueName = nameFallback || slug;
  console.log("[VENUE SERVICE] Creating new venue:", { slug, name: venueName });

  const { data, error } = await supabase
    .from("venues")
    .insert({
      slug,
      name: venueName,
    })
    .select()
    .single();

  if (error) {
    console.error("[VENUE SERVICE] Error creating venue:", error);
    return null;
  }

  console.log("[VENUE SERVICE] Venue created successfully:", data);
  return data;
}

/**
 * Get all venues
 */
export async function getAllVenues(): Promise<Venue[]> {
  console.log("[VENUE SERVICE] getAllVenues");

  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .order("name");

  if (error) {
    console.error("[VENUE SERVICE] Error fetching venues:", error);
    return [];
  }

  console.log("[VENUE SERVICE] Venues fetched:", data?.length || 0);
  return data || [];
}

/**
 * Get venue by ID
 */
export async function getVenueById(id: string): Promise<Venue | null> {
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[VENUE SERVICE] Error fetching venue by ID:", error);
    return null;
  }
  return data;
}