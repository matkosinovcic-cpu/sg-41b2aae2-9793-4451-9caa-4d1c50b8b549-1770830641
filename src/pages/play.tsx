import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { eventService, Event } from "@/services/eventService";
import { ticketService } from "@/services/ticketService";
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
  const [showOnboarding, setShowOnboarding] = useState(false);

  const MAX_FREE_TICKETS = ticketService.getMaxFreeTickets();
  const MAX_RETRY_ATTEMPTS = 2;

  // Check if onboarding should be shown on mount
  useEffect(() => {
    const shouldShow = shouldShowOnboarding();
    if (shouldShow) {
      setShowOnboarding(true);
      markOnboardingShown();
    }
  }, []);

  const handleOnboardingDismiss = (dontShowAgain: boolean) => {
    if (dontShowAgain) {
      hideOnboardingPermanently();
    }
    setShowOnboarding(false);
  };

  // SELF-HEAL: Load active event with automatic retry and context clearing
  const loadActiveEvent = async (isRetry = false) => {
    setLoading(true);
    
    try {
      console.log("[Play] 🔍 Loading active event", isRetry ? `(retry ${retryAttempt + 1}/${MAX_RETRY_ATTEMPTS})` : "");
      
      // CRITICAL: Always fetch ACTIVE event (no .single() crash)
      const { data: events, error } = await supabase
        .from("events")
        .select("*")
        .eq("status", "active")
        .limit(1);

      if (error) {
        console.error("[Play] ❌ Error fetching active event:", error);
        throw error;
      }

      const event = events && events.length > 0 ? (events[0] as unknown as Event) : null;

      if (!event) {
        console.log("[Play] ℹ️ No active event found");
        setActiveEvent(null);
        setLoading(false);
        setHealingInProgress(false);
        return;
      }

      console.log("[Play] ✅ Active event found:", {
        id: event.id,
        name: event.name,
        status: event.status
      });
      
      setActiveEvent(event);

      // Check ticket limit for this ACTIVE event
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
        
        // Show healing toast
        toast({
          title: "🔄 Prebacivanje na aktivni event...",
          description: "Trenutak...",
          duration: 2000
        });
        
        setTimeout(() => loadActiveEvent(true), 800);
        return;
      }
      
      // Final fallback: show user-friendly error but don't crash
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

  useEffect(() => {
    loadActiveEvent();
  }, []);

  // Handle free ticket creation with mobile-friendly delayed redirect
  const handleGetFreeTicket = async () => {
    if (!activeEvent) {
      toast({
        title: "Nema aktivnog eventa",
        description: "Trenutno nema aktivnog eventa. Pokušaj kasnije.",
        variant: "destructive"
      });
      return;
    }
    
    if (limitReached) return;

    setCreating(true);
    
    try {
      console.log("[Play] 🎫 Creating free ticket for event:", activeEvent.id);
      
      // STEP 1: Create ticket in database and WAIT for response
      const ticket = await ticketService.createFreeTicket(activeEvent.id);
      
      console.log("[Play] ✅ Ticket created successfully:", {
        serial: ticket.serial_number,
        ticket_id: ticket.id,
        event_id: activeEvent.id
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
    
    const storedTickets = getStoredFreeTickets(activeEvent.id);
    
    if (storedTickets.length > 0) {
      console.log("[Play] 🔄 Opening player with stored tickets for event:", activeEvent.id);
      
      setRedirecting(true);
      
      setTimeout(() => {
        router.push(`/player?event=${activeEvent.id}`);
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
            {loading || healingInProgress ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-purple-600" />
                <p className="text-muted-foreground">
                  {healingInProgress ? "Prebacivanje na aktivni event..." : "Učitavam..."}
                </p>
              </div>
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
                    ⏳ Trenutno nema aktivnog eventa.
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

      {/* Onboarding Modal */}
      <OnboardingModal
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
        onDismiss={handleOnboardingDismiss}
      />
    </>
  );
}