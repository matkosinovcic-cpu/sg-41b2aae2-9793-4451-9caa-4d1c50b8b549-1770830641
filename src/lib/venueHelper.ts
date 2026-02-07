/**
 * Venue Helper
 * 
 * Utilities for managing venue context across the application.
 * Handles venue resolution from URL parameters and localStorage persistence.
 */

const VENUE_STORAGE_KEY = "ps_venue";

/**
 * Resolve venue slug from URL parameter or localStorage
 * 
 * Priority:
 * 1. URL query parameter (if provided)
 * 2. localStorage (if no URL parameter)
 * 3. null (if neither exists)
 * 
 * @param queryVenue - Venue slug from URL query parameter
 * @returns Resolved venue slug or null
 */
export function resolveVenue(queryVenue: string | string[] | undefined): string | null {
  // Handle array case (Next.js can pass query params as arrays)
  const venueFromQuery = Array.isArray(queryVenue) ? queryVenue[0] : queryVenue;

  if (venueFromQuery && typeof venueFromQuery === "string" && venueFromQuery.trim()) {
    const resolved = venueFromQuery.trim().toLowerCase();
    console.log("[VENUE HELPER] Resolved venue from query:", resolved);
    return resolved;
  }

  // Fallback to localStorage
  if (typeof window !== "undefined") {
    const storedVenue = localStorage.getItem(VENUE_STORAGE_KEY);
    if (storedVenue && storedVenue.trim()) {
      console.log("[VENUE HELPER] Resolved venue from localStorage:", storedVenue);
      return storedVenue.trim().toLowerCase();
    }
  }

  console.log("[VENUE HELPER] No venue resolved (query and localStorage empty)");
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
    console.log("[VENUE HELPER] Stored venue in localStorage:", normalized);
  }
}

/**
 * Clear stored venue from localStorage
 */
export function clearVenue(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(VENUE_STORAGE_KEY);
    console.log("[VENUE HELPER] Cleared venue from localStorage");
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