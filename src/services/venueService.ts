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
  try {
    console.log(`[VenueService] 🔍 Fetching venue by slug: "${slug}"`);
    
    const { data, error } = await supabase
      .from("venues")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error) {
      console.error("[VenueService] ❌ Error fetching venue by slug:", error);
      return null;
    }

    if (!data) {
      console.error("[VenueService] ❌ No venue found for slug:", slug);
      return null;
    }

    console.log("[VenueService] ✅ Found venue:", {
      id: data.id,
      name: data.name,
      slug: data.slug
    });

    return data;
  } catch (err) {
    console.error("[VenueService] ❌ Exception fetching venue by slug:", err);
    return null;
  }
}