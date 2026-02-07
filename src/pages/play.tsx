import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { eventService, Event } from "@/services/eventService";
import ticketService from "@/services/ticketService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, Ticket } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { OnboardingModal } from "@/components/OnboardingModal";
import {
  shouldShowOnboarding,
  markOnboardingShown,
  hideOnboardingPermanently,
} from "@/lib/onboardingHelper";
import { RegistrationModal } from "@/components/RegistrationModal";
import { hasPlayerProfile, getPlayerId } from "@/lib/playerHelper";
import { resolveVenue, storeVenue } from "@/lib/venueHelper";
import { cn } from "@/lib/utils";

// Get stored free tickets for a specific event
function getStoredFreeTickets(eventId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const key = `ps_free_tickets_${eventId}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Store free ticket for a specific event
function storeFreeTicket(eventId: string, serial: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = `ps_free_tickets_${eventId}`;
    const tickets = getStoredFreeTickets(eventId);
    if (!tickets.includes(serial)) {
      tickets.push(serial);
      localStorage.setItem(key, JSON.stringify(tickets));
    }
  } catch (err) {
    console.error("[Play] Failed to store free ticket:", err);
  }
}

// SELF-HEAL: Clear old event context
function clearOldEventContext(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("ps_last_event_id");
    localStorage.removeItem("ps_selected_event_id");
    console.log("[Play] 🔄 Cleared old event context for self-heal");
  } catch (err) {
    console.error("[Play] Failed to clear old context:", err);
  }
}

export default function PlayPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [freeTicketCount, setFreeTicketCount] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [healingInProgress, setHealingInProgress] = useState(false);
  
  // Registration state
  const [showRegistration, setShowRegistration] = useState(false);
  
  // CRITICAL: Onboarding state must be SEPARATE from event loading
  const [showOnboarding, setShowOnboarding] = useState(false);
  const didCheckOnboarding = useRef(false); // Prevent multiple checks

  // Venue state
  const [venueSlug, setVenueSlug] = useState<string | null>(null);
  const [venueResolutionAttempt, setVenueResolutionAttempt] = useState(0);
  
  // DEBUG: Show venue resolution state (TEMPORARY - remove after bug is fixed)
  const [showDebug] = useState(true);

  const MAX_FREE_TICKETS = ticketService.getMaxFreeTickets();
  const MAX_RETRY_ATTEMPTS = 2;
  const MAX_VENUE_RESOLUTION_ATTEMPTS = 3;

  // CRITICAL: Check onboarding ONCE on mount, INDEPENDENT of event loading
  useEffect(() => {
    // Prevent multiple executions
    if (didCheckOnboarding.current) {
      console.log("[Play] ⏭️ Onboarding already checked, skipping");
      return;
    }

    console.log("[Play] 🔍 Checking if onboarding should show (first time only)");
    didCheckOnboarding.current = true;

    const shouldShow = shouldShowOnboarding();
    console.log("[Play] 📋 Should show onboarding:", shouldShow);

    if (shouldShow) {
      console.log("[Play] ✅ Setting onboarding visible");
      setShowOnboarding(true);
      markOnboardingShown();
    } else {
      console.log("[Play] ⏭️ Onboarding skipped (hidden or shown recently)");
    }
  }, []); // Empty deps = run ONCE on mount only

  // Handle onboarding dismiss (ONLY way to close it)
  const handleOnboardingDismiss = (dontShowAgain: boolean) => {
    console.log("[Play] 🎯 Onboarding dismissed by user. Don't show again:", dontShowAgain);
    
    if (dontShowAgain) {
      hideOnboardingPermanently();
      console.log("[Play] 🔒 Onboarding hidden permanently");
    }
    
    setShowOnboarding(false);
    console.log("[Play] ✅ Onboarding modal closed");
  };

  // SELF-HEAL: Load active event with automatic retry and context clearing
  const loadActiveEvent = async (isRetry = false) => {
    setLoading(true);
    
    try {
      console.log("[Play] 🔍 Loading active event", isRetry ? `(retry ${retryAttempt + 1}/${MAX_RETRY_ATTEMPTS})` : "");
      
      // CRITICAL: Use venueSlug state directly (must be set before this function is called)
      const venue = venueSlug;
      
      // DEBUG LOGGING
      console.log("[Play] 🏢 Venue check:", {
        venueSlugState: venueSlug,
        queryVenue: router.query.venue,
        routerIsReady: router.isReady,
        usingVenue: venue
      });
      
      if (!venue) {
        console.log("[Play] ⚠️ No venue in state - user needs to scan QR code");
        setActiveEvent(null);
        setLoading(false);
        setHealingInProgress(false);
        return;
      }
      
      console.log("[Play] 🎯 Fetching ACTIVE event for venue:", venue);
      
      // CRITICAL: STRICT filter by venue_slug - NO FALLBACK to other venues
      console.log("[Play] 📡 DB Query:", {
        table: "events",
        filters: {
          status: "active",
          venue_slug: venue
        },
        limit: 1
      });
      
      const { data: events, error } = await supabase
        .from("events")
        .select("*")
        .eq("status", "active")
        .eq("venue_slug", venue)
        .limit(1);

      if (error) {
        console.error("[Play] ❌ Error fetching active event for venue:", error);
        throw error;
      }

      const event = events && events.length > 0 ? (events[0] as unknown as Event) : null;

      if (!event) {
        console.log("[Play] ℹ️ No active event found for venue:", venue);
        setActiveEvent(null);
        setLoading(false);
        setHealingInProgress(false);
        return;
      }

      console.log("[Play] ✅ Active event found for venue:", {
        venue,
        id: event.id,
        name: event.name,
        status: event.status,
        event_venue_slug: event.venue_slug
      });
      
      // CRITICAL VALIDATION: Ensure loaded event matches venue slug
      if (event.venue_slug !== venue) {
        console.error("[Play] 🚨 VENUE MISMATCH!", {
          expectedVenue: venue,
          loadedEventVenue: event.venue_slug,
          eventName: event.name,
          eventId: event.id
        });
        
        toast({
          title: "⚠️ Greška u venue-u",
          description: `Očekivan venue "${venue}", ali je učitan event za "${event.venue_slug}".`,
          variant: "destructive",
          duration: 10000
        });
        
        setActiveEvent(null);
        setLoading(false);
        setHealingInProgress(false);
        return;
      }
      
      // ADDITIONAL VALIDATION: If URL has venue query param, it must match
      const queryVenue = router.query.venue;
      if (queryVenue && typeof queryVenue === "string" && queryVenue.trim()) {
        const normalizedQuery = queryVenue.trim().toLowerCase();
        if (event.venue_slug !== normalizedQuery) {
          console.error("[Play] 🚨 URL VENUE MISMATCH!", {
            urlQueryParam: normalizedQuery,
            loadedEventVenue: event.venue_slug,
            eventName: event.name,
            eventId: event.id
          });
          
          toast({
            title: "⚠️ Greška u venue-u",
            description: `URL traži "${normalizedQuery}", ali je učitan event za "${event.venue_slug}". Molimo osvježite stranicu.`,
            variant: "destructive",
            duration: 10000
          });
          
          setActiveEvent(null);
          setLoading(false);
          setHealingInProgress(false);
          return;
        } else {
          console.log("[Play] ✅ URL venue validation passed:", {
            urlQueryParam: normalizedQuery,
            loadedEventVenue: event.venue_slug,
            match: true
          });
        }
      }
      
      setActiveEvent(event);

      // Check ticket limit for this ACTIVE event ONLY
      const storedTickets = getStoredFreeTickets(event.id);
      setFreeTicketCount(storedTickets.length);
      setLimitReached(storedTickets.length >= MAX_FREE_TICKETS);

      console.log("[Play] 📊 Tickets for active event:", {
        count: storedTickets.length,
        limit: MAX_FREE_TICKETS,
        eventId: event.id
      });

      // Success - reset retry counter
      setRetryAttempt(0);
      setHealingInProgress(false);

    } catch (error) {
      console.error("[Play] ❌ Failed to load active event:", error);
      
      // SELF-HEAL: Retry with context clear
      if (!isRetry && retryAttempt < MAX_RETRY_ATTEMPTS) {
        console.log("[Play] 🔄 Attempting self-heal: clearing old context and retrying...");
        setHealingInProgress(true);
        clearOldEventContext();
        setRetryAttempt(prev => prev + 1);
        
        toast({
          title: "🔄 Prebacivanje na aktivni event...",
          description: "Trenutak...",
          duration: 2000
        });
        
        setTimeout(() => loadActiveEvent(true), 800);
        return;
      }
      
      // Final fallback
      console.error("[Play] ❌ Self-heal failed after retries");
      setHealingInProgress(false);
      toast({
        title: "Privremeni problem",
        description: "Pokušaj osvježiti stranicu. Ako problem traje, kontaktiraj podršku.",
        variant: "destructive",
        duration: 5000
      });
    } finally {
      if (!isRetry || retryAttempt >= MAX_RETRY_ATTEMPTS) {
        setLoading(false);
      }
    }
  };

  // Load event on mount (SEPARATE from onboarding)
  useEffect(() => {
    // CRITICAL: Wait for router.isReady before resolving venue
    if (!router.isReady) {
      console.log("[Play] ⏳ Router not ready yet, waiting...");
      return;
    }
    
    console.log("[Play] ✅ Router ready, resolving venue...");
    console.log("[Play] 🌐 Full router state:", {
      isReady: router.isReady,
      query: router.query,
      pathname: router.pathname,
      asPath: router.asPath
    });
    
    // CRITICAL: Query param MUST have absolute priority
    const queryVenue = router.query.venue;
    let resolved: string | null = null;
    
    if (queryVenue && typeof queryVenue === "string" && queryVenue.trim()) {
      // Query param exists and is not empty - USE IT (absolute priority)
      resolved = queryVenue.trim().toLowerCase();
      console.log("[Play] ✅ Using venue from QUERY (absolute priority):", resolved);
      
      // Store as new fallback
      storeVenue(resolved);
    } else {
      // No query param - use localStorage fallback
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("ps_venue");
        if (stored && stored.trim()) {
          resolved = stored.trim().toLowerCase();
          console.log("[Play] ✅ Using venue from LOCALSTORAGE (fallback):", resolved);
        }
      }
    }
    
    console.log("[Play] 🏢 Venue resolution result:", {
      queryVenue: router.query.venue,
      storedVenue: typeof window !== "undefined" ? localStorage.getItem("ps_venue") : null,
      resolvedVenue: resolved,
      routerIsReady: router.isReady
    });
    
    if (resolved) {
      setVenueSlug(resolved);
      console.log("[Play] 🎯 Set venueSlug state to:", resolved);
    } else {
      console.log("[Play] ⚠️ No venue resolved");
      setVenueSlug(null);
    }
  }, [router.isReady, router.query.venue]); // Re-run when router becomes ready or venue changes

  // SEPARATE useEffect: Load event ONLY when venueSlug is set
  useEffect(() => {
    if (venueSlug) {
      console.log("[Play] 🔄 venueSlug changed to:", venueSlug, "- loading active event");
      loadActiveEvent();
    } else {
      console.log("[Play] ⏭️ venueSlug is null, skipping loadActiveEvent");
      setActiveEvent(null);
      setLoading(false);
    }
  }, [venueSlug]); // Trigger ONLY when venueSlug changes

  // Core logic to generate ticket
  const executeTicketCreation = async (playerId?: string) => {
    if (!activeEvent) return;

    setCreating(true);
    
    try {
      console.log("[Play] 🎫 Creating free ticket for event:", activeEvent.id, "PlayerID:", playerId);
      
      // STEP 1: Create ticket in database and WAIT for response
      // playerId will be passed if coming from registration, or fetched inside helper if already exists
      const ticket = await ticketService.createFreeTicket(activeEvent.id, playerId);
      
      console.log("[Play] ✅ Ticket created successfully:", {
        serial: ticket.serial_number,
        ticket_id: ticket.id,
        event_id: activeEvent.id,
        player_id: ticket.player_id
      });

      // STEP 2: Store in localStorage for this event
      storeFreeTicket(activeEvent.id, ticket.serial_number);

      // STEP 3: Show success message
      toast({
        title: "✅ Tiket kreiran!",
        description: `Tvoj tiket: ${ticket.serial_number}`,
        duration: 2000
      });

      // STEP 4: Set redirecting state
      setRedirecting(true);
      setCreating(false);

      // STEP 5: Delayed redirect (mobile-friendly)
      setTimeout(() => {
        console.log("[Play] 🔄 Redirecting to player with ticket:", ticket.serial_number);
        router.push(`/player?ticket=${ticket.serial_number}`);
      }, 300);

    } catch (error) {
      console.error("[Play] ❌ Failed to create free ticket:", error);
      
      setCreating(false);
      setRedirecting(false);
      
      // Check if it's a limit error
      if (error instanceof Error && error.message.includes("FREE_LIMIT_REACHED")) {
        toast({
          title: "Dosegnut limit",
          description: `Imaš maksimalno ${MAX_FREE_TICKETS} besplatna tiketa u promo fazi.`,
          variant: "destructive",
          duration: 4000
        });
        setLimitReached(true);
        loadActiveEvent();
      } else {
        // SELF-HEAL: Maybe event changed, retry loading
        console.log("[Play] 🔄 Ticket creation failed, checking if event changed...");
        clearOldEventContext();
        loadActiveEvent(true);
        
        toast({
          title: "Greška pri izradi tiketa",
          description: "Provjeravam aktivan event...",
          variant: "destructive",
          duration: 3000
        });
      }
    }
  };

  // Handle "Get Ticket" click
  const handleGetFreeTicket = () => {
    if (!activeEvent) {
      toast({
        title: "Nema aktivnog eventa",
        description: "Trenutno nema aktivnog eventa. Pokušaj kasnije.",
        variant: "destructive"
      });
      return;
    }
    
    if (limitReached) return;

    // CHECK REGISTRATION FIRST
    if (hasPlayerProfile()) {
      // User has profile, proceed directly
      console.log("[Play] 👤 User has profile, proceeding to ticket creation");
      executeTicketCreation();
    } else {
      // User needs to register
      console.log("[Play] 👤 New user, showing registration modal");
      setShowRegistration(true);
    }
  };

  const handleRegistrationSuccess = (data: {
    userId: string;
    sessionId: string;
    tickets: any[];
    totalTickets: number;
  }) => {
    console.log("[Play] ✅ Registration successful & tickets claimed:", data);
    setShowRegistration(false);
    
    // Store all claimed tickets in localStorage for this event
    if (activeEvent && data.tickets && data.tickets.length > 0) {
      data.tickets.forEach((ticket: any) => {
        storeFreeTicket(activeEvent.id, ticket.serial_number);
      });
      
      toast({
        title: "✅ Tiketi uspješno preuzeti!",
        description: `Preuzeto ${data.tickets.length} tiketa. Sretno!`,
        duration: 3000
      });
      
      // Redirect to player page with the first ticket (or just event context)
      setRedirecting(true);
      setTimeout(() => {
        router.push(`/player?ticket=${data.tickets[0].serial_number}`);
      }, 500);
    } else {
      // Fallback if no tickets returned (e.g. limit reached already)
      toast({
        title: "Registracija uspješna",
        description: "Provjerite svoje tikete.",
        duration: 2000
      });
      handleOpenMyTickets();
    }
  };

  // Handle "Open my tickets" button with delayed redirect
  const handleOpenMyTickets = () => {
    if (!activeEvent) {
      toast({
        title: "Nema aktivnog eventa",
        description: "Trenutno nema aktivnog eventa.",
        variant: "destructive"
      });
      return;
    }
    
    // CRITICAL: Only show tickets for THIS event (prevents mixing venues)
    const storedTickets = getStoredFreeTickets(activeEvent.id);
    
    console.log("[Play] 🎫 Opening my tickets:", {
      eventId: activeEvent.id,
      eventName: activeEvent.name,
      venue: activeEvent.venue_slug,
      ticketCount: storedTickets.length
    });
    
    if (storedTickets.length > 0) {
      console.log("[Play] 🔄 Redirecting to player with event:", activeEvent.id);
      
      setRedirecting(true);
      
      setTimeout(() => {
        // Pass both event and venue to ensure correct context
        router.push(`/player?event=${activeEvent.id}&venue=${activeEvent.venue_slug}`);
      }, 200);
    } else {
      toast({
        title: "Nemaš tikete",
        description: "Nisi kreirao ni jedan tiket za ovaj event.",
        variant: "destructive"
      });
    }
  };

  return (
    <>
      <SEO
        title="Preuzmi tiket - Pitalica Skitalica"
        description="Skeniraj QR i preuzmi besplatni tiket za aktivni event!"
      />
      
      {/* DEBUG OVERLAY - TEMPORARY (remove after bug is fixed) */}
      {showDebug && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-100 dark:bg-yellow-900 border-b-2 border-yellow-400 p-2 text-xs font-mono">
          <div className="max-w-6xl mx-auto space-y-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span className="font-bold">🔍 DEBUG:</span>
              <span>query={String(router.query.venue || "null")}</span>
              <span>resolved={venueSlug || "null"}</span>
              <span>stored={typeof window !== "undefined" ? localStorage.getItem("ps_venue") || "null" : "null"}</span>
              <span>isReady={String(router.isReady)}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span className="font-bold">📋 EVENT:</span>
              <span>id={activeEvent?.id?.slice(0, 8) || "null"}</span>
              <span>name={activeEvent?.name || "null"}</span>
              <span>venue={activeEvent?.venue_slug || "null"}</span>
            </div>
          </div>
        </div>
      )}
      
      <div className={cn(
        "min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400",
        showDebug && "pt-24" // Add padding when debug overlay is visible
      )}>
        <Card className="w-full max-w-md shadow-2xl">
          <CardHeader className="text-center space-y-2">
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              PITALICA SKITALICA
            </CardTitle>
            <CardDescription className="text-lg">
              Preuzmi besplatni tiket
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading || healingInProgress ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-purple-600" />
                <p className="text-muted-foreground">
                  {healingInProgress ? "Prebacivanje na aktivni event..." : "Učitavam..."}
                </p>
              </div>
            ) : !venueSlug ? (
              <>
                <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 text-center space-y-4">
                  <p className="text-lg font-semibold text-yellow-900 dark:text-yellow-100">
                    📱 Odaberi kafić
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Skeniraj QR kod na svom stolu da bi preuzeo/la tiket.
                  </p>
                </div>
              </>
            ) : activeEvent ? (
              <>
                <div className="space-y-2 text-center">
                  <p className="text-sm text-muted-foreground">Aktivni event:</p>
                  <p className="text-xl font-bold text-foreground">{activeEvent.name}</p>
                </div>

                {limitReached ? (
                  <div className="space-y-4">
                    <div className="bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-lg p-4 text-center">
                      <Ticket className="h-8 w-8 mx-auto mb-2 text-orange-600" />
                      <p className="font-semibold text-orange-900 dark:text-orange-100">
                        Imaš maksimalno {MAX_FREE_TICKETS} tiketa za ovaj event.
                      </p>
                      <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                        ({freeTicketCount}/{MAX_FREE_TICKETS} besplatna tiketa u promo fazi)
                      </p>
                    </div>
                    <Button
                      onClick={handleOpenMyTickets}
                      disabled={redirecting}
                      className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                      size="lg"
                    >
                      {redirecting ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Otvaranje...
                        </>
                      ) : (
                        <>
                          <Ticket className="mr-2 h-5 w-5" />
                          Otvori moje tikete
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {freeTicketCount > 0 && (
                      <p className="text-sm text-center text-muted-foreground">
                        Imaš {freeTicketCount}/{MAX_FREE_TICKETS} besplatna tiketa
                      </p>
                    )}
                    <Button
                      onClick={handleGetFreeTicket}
                      disabled={creating || redirecting}
                      className="w-full h-16 text-xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 shadow-lg"
                      size="lg"
                    >
                      {redirecting ? (
                        <>
                          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                          Preusmjeravanje...
                        </>
                      ) : creating ? (
                        <>
                          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                          Izrađujem tiket...
                        </>
                      ) : (
                        <>
                          <Ticket className="mr-2 h-6 w-6" />
                          Preuzmi tiket (FREE)
                        </>
                      )}
                    </Button>
                    {freeTicketCount > 0 && (
                      <Button
                        onClick={handleOpenMyTickets}
                        disabled={redirecting}
                        variant="outline"
                        className="w-full"
                        size="lg"
                      >
                        {redirecting ? (
                          <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Otvaranje...
                          </>
                        ) : (
                          `Vidi sve moje tikete (${freeTicketCount})`
                        )}
                      </Button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 text-center space-y-4">
                  <p className="text-lg font-semibold text-yellow-900 dark:text-yellow-100">
                    ⏳ Nema aktivnog eventa za ovaj kafić.
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Molimo pričekajte da event započne.
                  </p>
                </div>
                <Button
                  onClick={() => loadActiveEvent()}
                  variant="outline"
                  className="w-full"
                  size="lg"
                >
                  <RefreshCw className="mr-2 h-5 w-5" />
                  Osvježi
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Onboarding Modal - Separate from registration */}
      <OnboardingModal
        open={showOnboarding}
        onOpenChange={(open) => {
          if (!open) {
            console.log("[Play] ⚠️ Unexpected modal close attempt blocked");
          }
        }}
        onDismiss={handleOnboardingDismiss}
      />

      {/* Registration Modal - Shows only if needed */}
      <RegistrationModal
        open={showRegistration}
        eventId={activeEvent?.id || ""} 
        onSuccess={handleRegistrationSuccess}
        onCancel={() => setShowRegistration(false)}
      />
    </>
  );
}