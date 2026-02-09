import { useState, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RegistrationModal } from "@/components/RegistrationModal";
import { Ticket } from "@/services/ticketService";
import { Event } from "@/services/eventService";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

interface MyTicket {
  id: string;
  serial_number: string;
  ticket_numbers: number[];
  venue_id: string;
  event_id: string;
}

interface Stats {
  answered: number;
  correct: number;
  total: number;
}

export default function PlayPage() {
  const router = useRouter();
  const { venue: queryVenue, event: queryEvent, debug } = router.query;

  // Debug mode
  const isDebug = debug === "1";

  // State
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [myTicket, setMyTicket] = useState<MyTicket | null>(null);
  const [drawnNumbers, setDrawnNumbers] = useState<number[]>([]);
  const [stats, setStats] = useState<Stats>({ answered: 0, correct: 0, total: 15 });
  const [isRegistrationOpen, setIsRegistrationOpen] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);

  // Debug state
  const [venueSlug, setVenueSlug] = useState<string | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [resolvedEventId, setResolvedEventId] = useState<string | null>(null);
  const [resolvedEventName, setResolvedEventName] = useState<string | null>(null);
  const [rpcCalled, setRpcCalled] = useState<string | null>(null);
  const [rpcResultCount, setRpcResultCount] = useState<number | null>(null);

  // Load active event
  useEffect(() => {
    if (!router.isReady) return;

    const loadData = async () => {
      try {
        const venueParam = router.query.venue as string;
        
        // DEBUG: Update venue param
        if (showDebug) {
          setDebugInfo(prev => ({ ...prev, urlVenueParam: venueParam || null }));
        }

        if (!venueParam) {
          setVenueSlug(null);
          setLoading(false);
          return;
        }

        setVenueSlug(venueParam);

        // Resolve venue_id
        const { data: venue } = await supabase
          .from("venues")
          .select("id, name")
          .eq("slug", venueParam)
          .single();

        if (showDebug) {
          setDebugInfo(prev => ({
            ...prev,
            resolvedVenueId: venue?.id || null,
            resolvedVenueName: venue?.name || null
          }));
        }

        if (!venue) {
          setLoading(false);
          return;
        }

        // Get active event
        const { data: event } = await supabase
          .from("events")
          .select("*")
          .eq("venue_id", venue.id)
          .eq("status", "active")
          .single();

        if (showDebug) {
          setDebugInfo(prev => ({
            ...prev,
            resolvedEventId: event?.id || null,
            resolvedEventName: event?.name || null
          }));
        }

        if (event) {
          setActiveEvent(event as any);
        }

      } catch (error) {
        console.error("[PLAY] Load error:", error);
        if (showDebug) {
          setDebugInfo(prev => ({ ...prev, lastError: error }));
        }
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [router.isReady, router.query.venue, showDebug]);

  // Load my ticket
  useEffect(() => {
    const loadTicket = async () => {
      if (!activeEvent) return;

      try {
        const storedTicketId = localStorage.getItem(`ps_ticket_${activeEvent.id}`);
        if (!storedTicketId) return;

        const { data: ticketData, error: ticketError } = await supabase
          .from("tickets")
          .select("*")
          .eq("id", storedTicketId)
          .single();

        if (ticketError) {
          if (ticketError.code !== "PGRST116") {
            console.error("[PLAY] Error loading ticket:", ticketError);
          }
          return;
        }

        if (ticketData) {
          // Transform DB ticket to local MyTicket format
          // Note: ticket_numbers comes from DB as number[]
          const transformedTicket: MyTicket = {
            id: ticketData.id,
            serial_number: ticketData.serial_number,
            ticket_numbers: ticketData.ticket_numbers || [],
            venue_id: ticketData.venue_id,
            event_id: ticketData.event_id
          };

          setMyTicket(transformedTicket);
          setTicket(ticketData);
        }
      } catch (error) {
        console.error("[PLAY] Failed to load ticket:", error);
      }
    };

    loadTicket();
  }, [activeEvent]);

  // Stats loading (simplified - removed ticket_questions references)
  useEffect(() => {
    if (ticket) {
      // Mock stats for now to prevent build errors
      setStats({
        answered: 0,
        correct: 0,
        total: 15,
      });
    }
  }, [ticket]);

  useEffect(() => {
    if (!activeEvent) return;

    const channel = supabase
      .channel(`event_${activeEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "drawn_numbers",
          filter: `event_id=eq.${activeEvent.id}`,
        },
        (payload) => {
          console.log("[PLAY] 🎲 Drawn number update:", payload);
          loadDrawnNumbers();
        }
      )
      .subscribe();

    loadDrawnNumbers();

    return () => {
      channel.unsubscribe();
    };
  }, [activeEvent]);

  const loadDrawnNumbers = async () => {
    if (!activeEvent) return;

    try {
      // Cast table name to any to avoid type errors if table is missing in generated types
      const { data, error } = await supabase
        .from("drawn_numbers" as any)
        .select("number")
        .eq("event_id", activeEvent.id)
        .order("drawn_at", { ascending: true });

      if (error) {
        console.error("[PLAY] Error loading drawn numbers:", error);
        return;
      }
      
      // Cast data to expected shape
      const numbers = (data as any[]).map((d) => d.number);
      setDrawnNumbers(numbers);
    } catch (error) {
      console.error("[PLAY] Failed to load drawn numbers:", error);
    }
  };

  const onTicketClaimed = (data: { email: string; nickname: string; tickets: any[] }) => {
    const result = data.tickets[0]; // Get first ticket from array
    
    console.log("[PLAY] ✅ Ticket claimed successfully via RPC:", {
      ticketId: result.id,
      serial: result.serial_number,
      eventId: result.event_id,
      venueId: result.venue_id,
      rpc: rpcCalled
    });

    setRpcResultCount((prev) => (prev || 0) + 1);

    // Save ticket ID to localStorage
    localStorage.setItem(`ps_ticket_${activeEvent?.id}`, result.id);

    // Transform to MyTicket format
    const transformedTicket: MyTicket = {
      id: result.id,
      serial_number: result.serial_number,
      ticket_numbers: result.ticket_numbers || [],
      venue_id: result.venue_id,
      event_id: result.event_id
    };

    setMyTicket(transformedTicket);
    setTicket(result);
    setIsRegistrationOpen(false);

    alert(`Tiket preuzet! Serial: ${result.serial_number}`);
  };

  const handleClaimTicket = async (email: string, nickname: string) => {
    if (!activeEvent) throw new Error("No active event");

    // DEBUG: Set RPC status to pending
    if (showDebug) {
      setDebugInfo(prev => ({
        ...prev,
        rpcCalled: "claim_free_tickets_v3",
        rpcParams: {
          p_event_id: activeEvent.id,
          p_venue_id: activeEvent.venue_id,
          p_email: email,
          p_nickname: nickname,
          p_limit: 1
        },
        rpcStatus: "pending"
      }));
    }

    try {
      console.log("🚀 [PLAY] Calling claim_free_tickets_v3 RPC...");
      // Call RPC
      const { data, error } = await supabase.rpc("claim_free_tickets_v3", {
        p_event_id: activeEvent.id,
        p_venue_id: activeEvent.venue_id || "",
        p_email: email,
        p_nickname: nickname,
        p_limit: 1
      });

      if (error) {
        // THIS IS THE CRITICAL LOGGING POINT FOR THE USER
        console.error("❌ [PLAY] CLAIM_TICKETS_ERROR - FULL DIAGNOSTIC:", {
          message: error?.message || "Unknown error",
          details: error?.details || null,
          hint: error?.hint || null,
          code: error?.code || null,
          raw: error
        });

        if (showDebug) {
          setDebugInfo(prev => ({
            ...prev,
            rpcStatus: "error",
            lastError: {
              message: error.message,
              details: error.details,
              hint: error.hint,
              code: error.code
            }
          }));
        }

        throw error;
      }

      // DEBUG: Success
      if (showDebug) {
        setDebugInfo(prev => ({
          ...prev,
          rpcStatus: "success",
          ticketsCreatedCount: data?.tickets?.length || 0,
          playerCreated: !!data?.player_id,
          playerId: data?.player_id || null
        }));
      }

      console.log("✅ [PLAY] Tickets claimed:", data);
      return data;

    } catch (err) {
      console.error("❌ [PLAY] handleClaimTicket failed:", err);
      throw err;
    }
  };

  if (!activeEvent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Učitavanje...</h1>
          <p className="text-muted-foreground">Molimo pričekajte</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Igraj - {activeEvent.name}</title>
      </Head>

      {isDebug && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-100 border-b-2 border-yellow-400 p-3 text-xs font-mono overflow-x-auto">
          <div className="max-w-6xl mx-auto">
            <p className="font-bold text-lg mb-2">🔍 DEBUG PANEL</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="font-semibold">URL & Venue:</p>
                <p>venue (param): {debugInfo.urlVenueParam || "null"}</p>
                <p>venue_id: {debugInfo.resolvedVenueId?.slice(0, 8) || "null"}</p>
                <p>venue_name: {debugInfo.resolvedVenueName || "null"}</p>
              </div>
              <div>
                <p className="font-semibold">Event:</p>
                <p>event_id: {debugInfo.resolvedEventId?.slice(0, 8) || "null"}</p>
                <p>event_name: {debugInfo.resolvedEventName || "null"}</p>
              </div>
              <div>
                <p className="font-semibold">RPC Call:</p>
                <p>rpc_called: {debugInfo.rpcCalled || "none"}</p>
                <p>rpc_status: <span className={debugInfo.rpcStatus === "success" ? "text-green-600" : debugInfo.rpcStatus === "error" ? "text-red-600" : ""}>{debugInfo.rpcStatus || "none"}</span></p>
                <p>tickets_created: {debugInfo.ticketsCreatedCount}</p>
              </div>
              <div>
                <p className="font-semibold">Player:</p>
                <p>player_created: {debugInfo.playerCreated ? "✅" : "❌"}</p>
                <p>player_id: {debugInfo.playerId?.slice(0, 8) || "null"}</p>
                <p>fallback_used: {debugInfo.fallbackUsed ? "✅" : "❌"}</p>
              </div>
            </div>
            {debugInfo.rpcParams && (
              <div className="mt-2">
                <p className="font-semibold">RPC Params:</p>
                <pre className="bg-white p-2 rounded text-xs overflow-x-auto">{JSON.stringify(debugInfo.rpcParams, null, 2)}</pre>
              </div>
            )}
            {debugInfo.lastError && (
              <div className="mt-2">
                <p className="font-semibold text-red-600">Last Error:</p>
                <pre className="bg-red-50 p-2 rounded text-xs overflow-x-auto">{JSON.stringify(debugInfo.lastError, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={`min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-pink-800 p-4 ${isDebug ? "pt-32" : ""}`}>
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-2">{activeEvent.name}</h1>
            <p className="text-purple-200">{activeEvent.venue_slug?.toUpperCase()}</p>
          </div>

          {/* My Ticket or Registration */}
          {myTicket ? (
            <Card className="p-6 mb-6 bg-white/95 backdrop-blur">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-bold">Tvoj Tiket</h2>
                  <p className="text-sm text-muted-foreground">Serial: {myTicket.serial_number}</p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Napredak</div>
                  <div className="text-lg font-bold">
                    {stats.answered}/{stats.total}
                  </div>
                  <div className="text-xs text-green-600">
                    ✓ {stats.correct} točnih
                  </div>
                </div>
              </div>

              {/* Ticket Numbers Grid */}
              <div className="grid grid-cols-5 gap-2">
                {myTicket.ticket_numbers.map((num, idx) => {
                  const isDrawn = drawnNumbers.includes(num);
                  return (
                    <div
                      key={idx}
                      className={`
                        aspect-square flex items-center justify-center rounded-lg font-bold text-lg
                        transition-all duration-300
                        ${
                          isDrawn
                            ? "bg-green-500 text-white scale-110 shadow-lg"
                            : "bg-gray-100 text-gray-700"
                        }
                      `}
                    >
                      {num}
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : (
            <Card className="p-8 mb-6 text-center bg-white/95 backdrop-blur">
              <h2 className="text-2xl font-bold mb-4">Preuzmi Tiket</h2>
              <p className="text-muted-foreground mb-6">
                Nemaš tiket za ovaj event. Klikni dolje da dobiješ svoj besplatni tiket!
              </p>
              <Button
                size="lg"
                onClick={() => setIsRegistrationOpen(true)}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              >
                🎟️ Preuzmi Tiket
              </Button>
            </Card>
          )}

          {/* Drawn Numbers */}
          <Card className="p-6 bg-white/95 backdrop-blur">
            <h2 className="text-2xl font-bold mb-4">Izvučeni Brojevi</h2>
            {drawnNumbers.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Još nema izvučenih brojeva...
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {drawnNumbers.map((num, idx) => (
                  <div
                    key={idx}
                    className="w-12 h-12 flex items-center justify-center bg-purple-600 text-white font-bold rounded-lg shadow-md"
                  >
                    {num}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Registration Modal */}
      <RegistrationModal
        open={isRegistrationOpen}
        onOpenChange={setIsRegistrationOpen}
        onCancel={() => setIsRegistrationOpen(false)}
        onSuccess={async (email, nickname) => {
          try {
            const result = await handleClaimTicket(email, nickname);
            
            // Save ticket ID to localStorage
            if (result?.tickets?.[0]) {
              localStorage.setItem(`ps_ticket_${activeEvent?.id}`, result.tickets[0].id);
              
               // Transform to MyTicket format
              const transformedTicket: MyTicket = {
                id: result.tickets[0].id,
                serial_number: result.tickets[0].serial_number,
                ticket_numbers: result.tickets[0].ticket_numbers || [],
                venue_id: result.tickets[0].venue_id,
                event_id: result.tickets[0].event_id
              };
              setMyTicket(transformedTicket);
              setTicket(result.tickets[0]);
              
              setIsRegistrationOpen(false);
              alert(`Tiket preuzet! Serial: ${result.tickets[0].serial_number}`);
            }
          } catch (error) {
            // Error is already logged in handleClaimTicket
            // Rethrow so RegistrationModal can show it in UI
            throw error;
          }
        }}
        eventId={activeEvent.id}
        venueId={activeEvent.venue_id || ""}
      />
    </>
  );
}