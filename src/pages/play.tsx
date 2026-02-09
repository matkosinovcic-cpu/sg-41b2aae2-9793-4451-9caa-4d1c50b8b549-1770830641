import { useState, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { eventService, Event } from "@/services/eventService";
import { ticketService } from "@/services/ticketService";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Ticket as TicketIcon, AlertCircle } from "lucide-react";
import { RegistrationModal } from "@/components/RegistrationModal";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export default function Play() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""); // Ensure this exists
  const [activeEvent, setActiveEvent] = useState<any>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [ticketClaimed, setTicketClaimed] = useState(false);
  const [ticket, setTicket] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  
  // Debug state
  const [debugInfo, setDebugInfo] = useState({
    venue_slug: "",
    venue_id: "",
    event_id: "",
    event_name: "",
    rpc_name: "",
    rpc_params: "",
    rpc_status: "",
    tickets_created_count: 0,
    player_id: "",
    last_error: null
  });

  useEffect(() => {
    // Check for debug param
    if (typeof window !== 'undefined') {
      setShowDebug(window.location.search.includes('debug=1'));
    }
  }, []);

  // Load active event on mount
  useEffect(() => {
    const loadActiveEvent = async () => {
      try {
        setLoading(true);
        
        // STEP 1: Check URL params
        const urlParams = new URLSearchParams(window.location.search);
        const eventIdParam = urlParams.get("eventId");
        const venueSlugParam = urlParams.get("venue");

        let resolvedEvent = null;
        let resolvePath = "";
        let venueInfo = { slug: "", id: "" };

        // STEP 2: Resolve event
        if (eventIdParam) {
          // Direct event ID provided
          console.log("[PLAY] Resolving by eventId:", eventIdParam);
          const { data: event } = await supabase
            .from("events")
            .select("*, venues(id, slug, name)")
            .eq("id", eventIdParam)
            .single();
          
          if (event && !event.name?.startsWith("GLOBAL")) {
            resolvedEvent = event;
            resolvePath = "eventId";
            if (event.venues) {
              venueInfo = { 
                slug: event.venues.slug || "", 
                id: event.venues.id || "" 
              };
            }
          }
        } else if (venueSlugParam) {
          // Venue slug provided - find active event for this venue
          console.log("[PLAY] Resolving by venue slug:", venueSlugParam);
          
          // Find venue
          const { data: venue } = await supabase
            .from("venues")
            .select("id, slug, name")
            .eq("slug", venueSlugParam)
            .single();

          if (venue) {
            venueInfo = { slug: venue.slug, id: venue.id };
            
            // Find active event for this venue (non-GLOBAL)
            const { data: event } = await supabase
              .from("events")
              .select("*")
              .eq("venue_id", venue.id)
              .eq("status", "active")
              .not("name", "like", "GLOBAL%")
              .order("created_at", { ascending: false })
              .limit(1)
              .single();

            if (event) {
              resolvedEvent = { ...event, venues: venue };
              resolvePath = "venue_active";
            }
          }
        } else {
          // NO params - find any active non-GLOBAL event (legacy single event mode)
          console.log("[PLAY] Resolving by active event (no params)");
          const { data: event } = await supabase
            .from("events")
            .select("*, venues(id, slug, name)")
            .eq("status", "active")
            .not("name", "like", "GLOBAL%")
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (event) {
            resolvedEvent = event;
            resolvePath = "active_event";
            if (event.venues) {
              venueInfo = { 
                slug: event.venues.slug || "", 
                id: event.venues.id || "" 
              };
            }
          }
        }

        // STEP 3: Handle result
        if (!resolvedEvent) {
          console.error("[PLAY] ❌ No active event found - resolvePath:", resolvePath);
          setError("Nema aktivnog kviza. Molimo pokušajte kasnije.");
          setLoading(false);
          return;
        }

        console.log("[PLAY] ✅ Event resolved:", {
          resolve_path: resolvePath,
          event_id: resolvedEvent.id,
          event_name: resolvedEvent.name,
          venue_slug: venueInfo.slug,
          venue_id: venueInfo.id
        });

        setActiveEvent(resolvedEvent);
        setError("");
      } catch (err: any) {
        console.error("[PLAY] Error loading event:", err);
        setError("Greška pri učitavanju kviza: " + (err.message || "Nepoznata greška"));
      } finally {
        setLoading(false);
      }
    };

    loadActiveEvent();
  }, []);

  const handleClaimTicket = async (email: string, nickname: string) => {
    if (!activeEvent) return;

    // Save user info
    localStorage.setItem("user_email", email);
    localStorage.setItem("user_nickname", nickname);

    // Update debug info
    setDebugInfo(prev => ({ 
      ...prev, 
      rpc_name: "claim_free_tickets", 
      rpc_params: JSON.stringify({ email, nickname, limit: 1 }) 
    }));

    try {
      // 1. Check existing tickets via localStorage (simple check)
      const existingTicket = localStorage.getItem(`ticket_${activeEvent.id}`);
      
      if (existingTicket) {
        setTicket(JSON.parse(existingTicket));
        setTicketClaimed(true);
        return;
      }

      // 2. Claim Ticket via Service (RPC)
      // Note: We use the simpler method that auto-finds active event
      const result = await ticketService.createFreeTicket(
        email, 
        nickname, 
        activeEvent.id // REQUIRED: Pass eventId
      );

      // Handle Result
      const responseData = result as any;
      const createdTickets = responseData.tickets || [];
      const ticket = createdTickets[0] || null;

      if (ticket) {
        // Save to localStorage
        localStorage.setItem(`ticket_${activeEvent.id}`, JSON.stringify(ticket));
        
        // Update State
        setTicket(ticket);
        setTicketClaimed(true);
        setRegistrationOpen(false);

        // Update Debug
        setDebugInfo(prev => ({ 
          ...prev, 
          rpc_status: "success",
          tickets_created_count: createdTickets.length,
          player_id: responseData.player_id
        }));

        toast({
          title: "Uspjeh!",
          description: "Tvoj tiket je spreman.",
        });

        // Redirect to player view
        router.push(`/player?ticket=${ticket.id}`);
      } else {
        throw new Error("No ticket returned from server");
      }

    } catch (err: any) {
      console.error("❌ [PLAY] handleClaimTicket failed:", err);
      
      setDebugInfo(prev => ({ 
        ...prev, 
        rpc_status: "error",
        last_error: err
      }));

      toast({
        title: "Greška",
        description: err.message || "Neuspješna registracija.",
        variant: "destructive",
      });
      
      throw err;
    }
  };

  const handleRegistrationSuccess = (data: any) => {
    console.log("Registration success:", data);
    setRegistrationOpen(false);
    
    // Check if we got tickets back
    const responseData = data as any;
    if (responseData && responseData.tickets && responseData.tickets.length > 0) {
      const ticket = responseData.tickets[0];
      setTicket(ticket);
      setTicketClaimed(true);
      
      // Save to local storage
      if (activeEvent) {
        localStorage.setItem(`ticket_${activeEvent.id}`, JSON.stringify(ticket));
      }
      
      // Redirect to player page
      router.push(`/player?ticket=${ticket.id}`);
    }
  };

  // Check if ticket is a winner (Client-side validation)
  const checkWinner = (ticketNumbers: number[], drawnNumbers: number[]) => {
    // GUARD: Ticket must have exactly 15 numbers
    if (!ticketNumbers || ticketNumbers.length !== 15) {
      console.warn("[PLAY] Winner Check Skipped: Ticket does not have 15 numbers", ticketNumbers);
      return false;
    }

    // GUARD: Drawn numbers must be enough to potentially win
    if (!drawnNumbers || drawnNumbers.length < 15) {
      return false;
    }

    // Check full match (Legacy logic: all 15 numbers must be drawn)
    const matches = ticketNumbers.filter(num => drawnNumbers.includes(num));
    const isWinner = matches.length === 15;
    
    if (isWinner) {
      console.log("[PLAY] 🏆 WINNER DETECTED! Full match:", matches);
    }
    
    return isWinner;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400">
        <Loader2 className="h-12 w-12 text-white animate-spin" />
      </div>
    );
  }

  if (!activeEvent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 p-4">
        <Card className="w-full max-w-md bg-white/90 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-center text-xl text-red-600 flex items-center justify-center gap-2">
              <AlertCircle className="h-6 w-6" />
              Nema aktivnog eventa
            </CardTitle>
            <CardDescription className="text-center">
              Trenutno nema aktivne igre. Molimo pokušajte kasnije.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <>
      <SEO title="Preuzmi Tiket - Pitalica Skitalica" />
      
      {showDebug && activeEvent && (
        <div className="fixed top-0 left-0 right-0 bg-black/95 text-white text-xs p-4 z-50 font-mono overflow-auto max-h-96">
          <div className="max-w-4xl mx-auto">
            <h3 className="text-yellow-400 font-bold mb-2">🔍 DEBUG PANEL - Play Page</h3>
            
            <div className="grid grid-cols-2 gap-4">
              {/* Event Resolution */}
              <div className="border border-gray-700 p-2 rounded">
                <div className="text-blue-400 font-bold mb-1">Event Resolution</div>
                <div>venue_slug: {router.query.venue || "N/A"}</div>
                <div>venue_id: {(activeEvent as any).venue_id || "N/A"}</div>
                <div>resolved_event_id: {activeEvent.id}</div>
                <div>event_name: {activeEvent.name}</div>
                <div>resolve_path: {router.query.eventId ? "eventId" : router.query.venue ? "venue_active" : "default_active"}</div>
              </div>

              {/* RPC Call Info */}
              <div className="border border-gray-700 p-2 rounded">
                <div className="text-green-400 font-bold mb-1">RPC Call Info</div>
                <div>rpc_called: {ticketClaimed ? "true" : "false"}</div>
                <div>rpc_name: claim_free_tickets</div>
                <div>rpc_status: {error ? "ERROR" : ticketClaimed ? "SUCCESS" : "PENDING"}</div>
                <div>tickets_created_count: {ticketClaimed ? "1" : "0"}</div>
              </div>

              {/* Ticket Numbers Source */}
              <div className="border border-gray-700 p-2 rounded">
                <div className="text-purple-400 font-bold mb-1">Ticket Numbers Source</div>
                <div>ticket_numbers_source: ticket_questions (DB table)</div>
                <div>expected_count: 15 unique numbers (1-90)</div>
                <div>storage: ticket_questions.question_number</div>
              </div>

              {/* Error Details */}
              {error && (
                <div className="border border-red-700 p-2 rounded">
                  <div className="text-red-400 font-bold mb-1">⚠️ Supabase Error</div>
                  <div>message: {error}</div>
                  {(error as any).code && <div>code: {(error as any).code}</div>}
                  {(error as any).details && <div>details: {(error as any).details}</div>}
                  {(error as any).hint && <div>hint: {(error as any).hint}</div>}
                </div>
              )}
            </div>

            <div className="mt-2 text-gray-400 text-[10px]">
              💡 This panel shows when ?debug=1 is in URL
            </div>
          </div>
        </div>
      )}

      <div className={cn("min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 p-4", showDebug && "pt-[420px]")}>
        <div className="max-w-md mx-auto space-y-8 pt-10">
          
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-extrabold text-white drop-shadow-md">
              PITALICA SKITALICA
            </h1>
            <p className="text-white/90 text-lg font-medium">
              {activeEvent.name}
            </p>
          </div>

          <Card className="bg-white/95 backdrop-blur shadow-xl border-0">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl text-purple-700">
                Preuzmi Svoj Tiket
              </CardTitle>
              <CardDescription>
                Sudjeluj u igri i osvoji nagrade!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-4">
              
              <div className="flex justify-center py-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-purple-500 blur-xl opacity-20 rounded-full"></div>
                  <TicketIcon className="w-24 h-24 text-purple-600 relative z-10" />
                </div>
              </div>

              {!ticketClaimed ? (
                <div className="space-y-4">
                  <Button 
                    size="lg" 
                    className="w-full text-lg font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-lg transform transition active:scale-95"
                    onClick={() => setRegistrationOpen(true)}
                  >
                    Registriraj se i preuzmi tiket
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    *Potrebna je samo email adresa
                  </p>
                </div>
              ) : (
                <div className="space-y-4 text-center">
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-green-700 font-medium">
                      ✅ Tiket uspješno preuzet!
                    </p>
                    <p className="text-sm text-green-600 mt-1">
                      Serijski broj: <span className="font-mono font-bold">{ticket?.serial_number}</span>
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    className="w-full border-purple-200 text-purple-700 hover:bg-purple-50"
                    onClick={() => router.push(`/player?ticket=${ticket?.id}`)}
                  >
                    Otvori moj tiket
                  </Button>
                </div>
              )}

            </CardContent>
          </Card>
          
          <div className="text-center text-white/60 text-sm">
            &copy; 2026 Pitalica Skitalica
          </div>
        </div>
      </div>

      {showDebug && (
        <div className="fixed bottom-0 left-0 right-0 bg-black/90 text-white p-2 text-xs z-50 border-t border-white/20">
          <div className="flex justify-between items-center">
            <div>
              <span className="font-bold">Build Info:</span> 
              {" "}Commit: {process.env.GIT_COMMIT?.substring(0, 7) || "local"}
              {" | "}Build: {new Date(process.env.BUILD_TIME || Date.now()).toLocaleString()}
            </div>
            <div>
              <span className="font-bold">Supabase:</span> 
              {" "}...{process.env.NEXT_PUBLIC_SUPABASE_URL?.split(".")[0].slice(-6) || "N/A"}
              {" | "}ENV: {process.env.ENV_NAME || "dev"}
            </div>
          </div>
        </div>
      )}

      <RegistrationModal
        open={registrationOpen}
        onOpenChange={setRegistrationOpen}
        onSuccess={handleRegistrationSuccess}
        eventId={activeEvent.id}
        venueId={(activeEvent as any).venue_id || ""}
      />
    </>
  );
}