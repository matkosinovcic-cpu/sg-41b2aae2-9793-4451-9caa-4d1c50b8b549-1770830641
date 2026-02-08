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
import { hasPlayerProfile } from "@/lib/playerHelper";
import { getVenueId } from "@/lib/venueHelper";
import { cn } from "@/lib/utils";
import { MapPin, Hash } from "lucide-react";

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

export default function PlayPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [freeTicketCount, setFreeTicketCount] = useState(0);
  const [limitReached, setLimitReached] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Registration state
  const [showRegistration, setShowRegistration] = useState(false);
  
  // CRITICAL: Onboarding state must be SEPARATE from event loading
  const [showOnboarding, setShowOnboarding] = useState(false);
  const didCheckOnboarding = useRef(false);

  const MAX_FREE_TICKETS = ticketService.getMaxFreeTickets();

  // CRITICAL: Check onboarding ONCE on mount, INDEPENDENT of event loading
  useEffect(() => {
    if (didCheckOnboarding.current) return;

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
  }, []);

  // Handle onboarding dismiss
  const handleOnboardingDismiss = (dontShowAgain: boolean) => {
    console.log("[Play] 🎯 Onboarding dismissed by user. Don't show again:", dontShowAgain);
    
    if (dontShowAgain) {
      hideOnboardingPermanently();
      console.log("[Play] 🔒 Onboarding hidden permanently");
    }
    
    setShowOnboarding(false);
    console.log("[Play] ✅ Onboarding modal closed");
  };

  // Load event based on priority: eventId → venue → error
  const loadEvent = async () => {
    setLoading(true);
    setErrorMessage(null);
    
    try {
      const { eventId: queryEventId, venue: queryVenue } = router.query;
      
      console.log("🔴🔴🔴 [Play] LOAD EVENT START 🔴🔴🔴");
      console.log("[Play] Router query object:", router.query);
      console.log("[Play] Query params extracted:", {
        eventId: queryEventId,
        venue: queryVenue,
        isReady: router.isReady
      });

      // PRIORITY A: Direct eventId param
      if (queryEventId && typeof queryEventId === "string") {
        console.log("🟢🟢🟢 [Play] PRIORITY A: Loading event by ID:", queryEventId);
        
        try {
          const event = await eventService.getEvent(queryEventId);
          
          console.log("✅✅✅ [Play] Event loaded by ID:", {
            id: event.id,
            name: event.name,
            venue_id: event.venue_id,
            venue_slug: event.venue_slug,
            status: event.status
          });
          
          setActiveEvent(event);
          
          // Check ticket limit for this event
          const storedTickets = getStoredFreeTickets(event.id);
          setFreeTicketCount(storedTickets.length);
          setLimitReached(storedTickets.length >= MAX_FREE_TICKETS);
          
          setLoading(false);
          return;
        } catch (err) {
          console.error("❌❌❌ [Play] Failed to load event by ID:", err);
          setErrorMessage(`Event ${queryEventId} ne postoji ili nije dostupan.`);
          setActiveEvent(null);
          setLoading(false);
          return;
        }
      }

      // PRIORITY B: Venue param → find active event for that venue
      if (queryVenue && typeof queryVenue === "string") {
        const venueSlug = queryVenue.trim().toLowerCase();
        console.log("🟡🟡🟡 [Play] PRIORITY B: Loading active event for venue:", venueSlug);
        
        try {
          // Get venue UUID from slug
          const venueId = await getVenueId(venueSlug);
          console.log("🏢🏢🏢 [Play] Venue ID resolved:", venueId);
          
          // Get active event for this venue
          const event = await eventService.getActiveEvent(venueId);
          
          console.log("✅✅✅ [Play] Active event found for venue:", {
            id: event.id,
            name: event.name,
            venue_slug: event.venue_slug,
            venue_id: event.venue_id,
            status: event.status
          });
          
          // Validate venue match
          if (event.venue_id !== venueId) {
            console.error("🚨🚨🚨 [Play] VENUE MISMATCH!", {
              expectedVenueId: venueId,
              loadedEventVenueId: event.venue_id,
              loadedEventName: event.name,
              loadedEventVenueSlug: event.venue_slug
            });
            
            toast({
              title: "⚠️ Greška u venue-u",
              description: `Event ${event.name} nije vezan za ${venueSlug}. Očekivani venue: ${event.venue_slug}`,
              variant: "destructive",
              duration: 10000
            });
            
            setActiveEvent(null);
            setLoading(false);
            return;
          }
          
          setActiveEvent(event);
          
          // Check ticket limit for this event
          const storedTickets = getStoredFreeTickets(event.id);
          setFreeTicketCount(storedTickets.length);
          setLimitReached(storedTickets.length >= MAX_FREE_TICKETS);
          
          setLoading(false);
          return;
        } catch (err) {
          console.error("❌❌❌ [Play] Failed to load venue/event:", err);
          
          if (err instanceof Error && err.message.includes("No active event found")) {
            setErrorMessage(`Trenutno nema aktivnog eventa za ${venueSlug}.`);
          } else if (err instanceof Error && err.message.includes("not found in database")) {
            setErrorMessage(`Venue "${venueSlug}" nije pronađen.`);
          } else {
            setErrorMessage("Greška pri učitavanju eventa.");
          }
          
          setActiveEvent(null);
          setLoading(false);
          return;
        }
      }

      // PRIORITY C: No params → show error
      console.log("⚪⚪⚪ [Play] PRIORITY C: No eventId or venue param");
      setErrorMessage(null); // Clear error - show QR scan message instead
      setActiveEvent(null);
      setLoading(false);

    } catch (error) {
      console.error("❌❌❌ [Play] Unexpected error in loadEvent:", error);
      setErrorMessage("Neočekivana greška. Pokušaj ponovno.");
      setActiveEvent(null);
      setLoading(false);
    }
  };

  // Load event when router is ready
  useEffect(() => {
    if (!router.isReady) {
      console.log("[Play] ⏳ Router not ready yet, waiting...");
      return;
    }
    
    console.log("[Play] ✅ Router ready, loading event...");
    loadEvent();
  }, [router.isReady, router.query.eventId, router.query.venue]);

  // Core logic to generate ticket
  const executeTicketCreation = async (playerId?: string) => {
    if (!activeEvent) return;

    setCreating(true);
    
    try {
      console.log("[Play] 🎫 Creating free ticket for event:", activeEvent.id, "PlayerID:", playerId);
      console.log("[Play] 🏢 Event details:", {
        id: activeEvent.id,
        name: activeEvent.name,
        venue_slug: activeEvent.venue_slug,
        venue_id: activeEvent.venue_id,
        status: activeEvent.status
      });
      
      // Create ticket - pass playerId if from registration, or let service fetch it
      const ticket = await ticketService.createFreeTicket(activeEvent.id, playerId);
      
      console.log("[Play] ✅ Ticket created successfully:", {
        serial: ticket.serial_number,
        ticket_id: ticket.id,
        event_id: activeEvent.id,
        player_id: ticket.player_id
      });

      // Store in localStorage for this event
      storeFreeTicket(activeEvent.id, ticket.serial_number);

      // Show success message
      toast({
        title: "✅ Tiket kreiran!",
        description: `Tvoj tiket: ${ticket.serial_number}`,
        duration: 2000
      });

      // Set redirecting state
      setRedirecting(true);
      setCreating(false);

      // Delayed redirect (mobile-friendly)
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
        loadEvent();
      } else {
        toast({
          title: "Greška pri izradi tiketa",
          description: error instanceof Error ? error.message : "Nepoznata greška",
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
      console.log("[Play] 👤 User has profile, proceeding to ticket creation");
      executeTicketCreation();
    } else {
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
      console.log("[Play] 💾 Storing tickets for event:", activeEvent.id);
      data.tickets.forEach((ticket: any) => {
        console.log("[Play] 💾 Storing ticket:", {
          serial: ticket.serial_number,
          eventId: activeEvent.id,
          venue: activeEvent.venue_slug
        });
        storeFreeTicket(activeEvent.id, ticket.serial_number);
      });
      
      toast({
        title: "✅ Tiketi uspješno preuzeti!",
        description: `Preuzeto ${data.tickets.length} tiketa. Sretno!`,
        duration: 3000
      });
      
      // Redirect to player page with the first ticket
      setRedirecting(true);
      setTimeout(() => {
        router.push(`/player?ticket=${data.tickets[0].serial_number}`);
      }, 500);
    } else {
      toast({
        title: "Registracija uspješna",
        description: "Provjerite svoje tikete.",
        duration: 2000
      });
      handleOpenMyTickets();
    }
  };

  // Handle "Open my tickets" button
  const handleOpenMyTickets = () => {
    if (!activeEvent) {
      toast({
        title: "Nema aktivnog eventa",
        description: "Trenutno nema aktivnog eventa.",
        variant: "destructive"
      });
      return;
    }
    
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
        router.push(`/player?ticket=${storedTickets[0]}`);
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
      
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400">
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
            
            {/* Debug Info - Show venue + event + eventId */}
            {activeEvent && (
              <div className="space-y-1 text-center pb-2 border-b border-border">
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
                  <MapPin className="w-4 h-4" />
                  Venue: <span className="text-foreground font-bold uppercase">{activeEvent.venue_slug}</span>
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  <Hash className="w-3 h-3 inline mr-1" />
                  {activeEvent.id.slice(0, 8)}...
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-purple-600" />
                <p className="text-muted-foreground">Učitavam...</p>
              </div>
            ) : errorMessage ? (
              <>
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center space-y-4">
                  <p className="text-lg font-semibold text-red-900 dark:text-red-100">
                    ⚠️ Greška
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {errorMessage}
                  </p>
                </div>
                <Button
                  onClick={loadEvent}
                  variant="outline"
                  className="w-full"
                  size="lg"
                >
                  <RefreshCw className="mr-2 h-5 w-5" />
                  Pokušaj ponovno
                </Button>
              </>
            ) : !activeEvent ? (
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
            ) : (
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
        venueId={activeEvent?.venue_id || ""}
        onSuccess={handleRegistrationSuccess}
        onCancel={() => setShowRegistration(false)}
      />
    </>
  );
}