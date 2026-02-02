import { SEO } from "@/components/SEO";
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { eventService, Event } from "@/services/eventService";
import { ticketService } from "@/services/ticketService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, Ticket } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

  const MAX_FREE_TICKETS = ticketService.getMaxFreeTickets();

  // Load active event and check ticket limit
  const loadActiveEvent = async () => {
    setLoading(true);
    try {
      const event = await eventService.getActiveEvent();
      setActiveEvent(event);

      if (event) {
        const storedTickets = getStoredFreeTickets(event.id);
        setFreeTicketCount(storedTickets.length);
        setLimitReached(storedTickets.length >= MAX_FREE_TICKETS);
      }
    } catch (error) {
      console.error("[Play] Failed to load active event:", error);
      toast({
        title: "Greška",
        description: "Greška pri učitavanju aktivnog eventa.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActiveEvent();
  }, []);

  // Handle free ticket creation with mobile-friendly delayed redirect
  const handleGetFreeTicket = async () => {
    if (!activeEvent) return;
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
      // Using setTimeout ensures navigation happens OUTSIDE the async block
      setTimeout(() => {
        console.log("[Play] 🔄 Redirecting to player with ticket:", ticket.serial_number);
        router.push(`/player?ticket=${ticket.serial_number}`);
      }, 300); // 300ms delay for mobile browsers

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
        // Reload to refresh state
        loadActiveEvent();
      } else {
        toast({
          title: "Greška",
          description: "Greška pri izradi tiketa. Pokušaj ponovno.",
          variant: "destructive",
          duration: 4000
        });
      }
    }
  };

  // Handle "Open my tickets" button with delayed redirect
  const handleOpenMyTickets = () => {
    if (!activeEvent) return;
    const storedTickets = getStoredFreeTickets(activeEvent.id);
    
    if (storedTickets.length > 0) {
      console.log("[Play] 🔄 Opening player with stored tickets for event:", activeEvent.id);
      
      setRedirecting(true);
      
      // Delayed redirect for mobile compatibility
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
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 className="h-12 w-12 animate-spin text-purple-600" />
                <p className="text-muted-foreground">Učitavam...</p>
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
                  onClick={loadActiveEvent}
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
    </>
  );
}