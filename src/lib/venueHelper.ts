/**
 * Venue Helper
 * 
 * Utilities for managing venue context across the application.
 * Handles venue resolution from URL parameters and localStorage persistence.
 */

import { supabase } from "@/integrations/supabase/client";

const VENUE_STORAGE_KEY = "ps_venue";

/**
 * Resolve venue slug from URL parameter or localStorage
 * 
 * Priority:
 * 1. URL query parameter (if provided and not empty)
 * 2. localStorage (ONLY if query is not provided at all - i.e., no ?venue= in URL)
 * 3. null (if neither exists)
 * 
 * @param queryVenue - Venue slug from URL query parameter
 * @returns Resolved venue slug or null
 */
export function resolveVenue(queryVenue: string | string[] | undefined): string | null {
  // Handle array case (Next.js can pass query params as arrays)
  const venueFromQuery = Array.isArray(queryVenue) ? queryVenue[0] : queryVenue;

  console.log("[VENUE HELPER] 🔍 Resolving venue:", {
    queryVenue: venueFromQuery,
    queryType: typeof venueFromQuery,
    queryTrimmed: venueFromQuery?.trim(),
    isUndefined: venueFromQuery === undefined,
    isEmpty: venueFromQuery === "",
    isNull: venueFromQuery === null
  });

  // CRITICAL: If query param EXISTS (not undefined), it MUST win - even if empty string
  // Only fall back to localStorage if query param is COMPLETELY MISSING (undefined)
  if (venueFromQuery !== undefined) {
    // Query param exists (could be empty string, which means "no venue in URL")
    if (typeof venueFromQuery === "string" && venueFromQuery.trim()) {
      const resolved = venueFromQuery.trim().toLowerCase();
      console.log("[VENUE HELPER] ✅ Resolved venue from QUERY:", resolved);
      return resolved;
    } else {
      // Query param exists but is empty - user explicitly set ?venue= with no value
      console.log("[VENUE HELPER] ⚠️ Query param is empty string - treating as 'no venue'");
      return null;
    }
  }

  // ONLY fall back to localStorage if query param is UNDEFINED (not in URL at all)
  console.log("[VENUE HELPER] 🔄 Query param undefined, checking localStorage as fallback");
  
  if (typeof window !== "undefined") {
    const storedVenue = localStorage.getItem(VENUE_STORAGE_KEY);
    console.log("[VENUE HELPER] 💾 localStorage value:", storedVenue);
    
    if (storedVenue && storedVenue.trim()) {
      const resolved = storedVenue.trim().toLowerCase();
      console.log("[VENUE HELPER] ✅ Resolved venue from LOCALSTORAGE:", resolved);
      return resolved;
    }
  }

  console.log("[VENUE HELPER] ❌ No venue resolved (query and localStorage empty)");
  return null;
}

/**
 * Store venue slug in localStorage
 * 
 * @param venue - Venue slug to store
 */
export function storeVenue(venue: string): void {
  if (typeof window !== "undefined" && venue && venue.trim()) {
    const normalized = venue.trim().toLowerCase();
    localStorage.setItem(VENUE_STORAGE_KEY, normalized);
    console.log("[VENUE HELPER] 💾 Stored venue in localStorage:", normalized);
  }
}

/**
 * Clear stored venue from localStorage
 */
export function clearVenue(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(VENUE_STORAGE_KEY);
    console.log("[VENUE HELPER] 🗑️ Cleared venue from localStorage");
  }
}

/**
 * Get currently stored venue from localStorage
 * 
 * @returns Stored venue slug or null
 */
export function getStoredVenue(): string | null {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(VENUE_STORAGE_KEY);
    return stored && stored.trim() ? stored.trim().toLowerCase() : null;
  }
  return null;
}

/**
 * Get venue UUID from database by slug
 * @param slug - Venue slug ("boiler" or "ludababa")
 * @returns Promise<string> - Venue UUID
 * @throws Error if venue not found or database error
 */
export async function getVenueId(slug: string): Promise<string> {
  console.log("[VenueHelper] 🔍 Getting venue ID for slug:", slug);
  
  if (!slug || typeof slug !== "string") {
    throw new Error("Invalid venue slug provided");
  }
  
  const normalizedSlug = slug.trim().toLowerCase();
  
  try {
    const { data, error } = await supabase
      .from("venues")
      .select("id, name, slug")
      .eq("slug", normalizedSlug)
      .single();
    
    if (error) {
      console.error("[VenueHelper] ❌ Database error fetching venue:", error);
      throw new Error(`Failed to fetch venue: ${error.message}`);
    }
    
    if (!data) {
      console.error("[VenueHelper] ❌ Venue not found for slug:", normalizedSlug);
      throw new Error(`Venue "${normalizedSlug}" not found in database`);
    }
    
    console.log("[VenueHelper] ✅ Venue found:", {
      id: data.id,
      name: data.name,
      slug: data.slug
    });
    
    return data.id;
  } catch (err) {
    console.error("[VenueHelper] ❌ Error in getVenueId:", err);
    throw err;
  }
}