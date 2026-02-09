import { useState, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RegistrationModal } from "@/components/RegistrationModal";
import { Ticket, createFreeTicket } from "@/services/ticketService";
import { Event, eventService } from "@/services/eventService";
import { getVenueBySlug } from "@/services/venueService";

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
    const loadEvent = async () => {
      try {
        let event: Event | null = null;

        // PRIORITY A: Event ID (ADMIN mode)
        if (queryEvent && typeof queryEvent === "string") {
          console.log("[PLAY] 🔍 Loading event by ID:", queryEvent);
          event = await eventService.getEventById(queryEvent);
          if (event) {
            setActiveEvent(event);
            setResolvedEventId(event.id);
            setResolvedEventName(event.name);
          }
        }
        // PRIORITY B: Venue Slug (PLAYER mode - KRITIČNO!)
        else if (queryVenue && typeof queryVenue === "string") {
          console.log("[PLAY] 🏢 Loading event by venue slug:", queryVenue);
          setVenueSlug(queryVenue);

          // 1. Resolve venue_id by slug
          const venue = await getVenueBySlug(queryVenue);
          if (!venue) {
            console.error("[PLAY] ❌ Venue not found:", queryVenue);
            return;
          }

          setVenueId(venue.id);
          console.log("[PLAY] ✅ Venue resolved:", { slug: queryVenue, id: venue.id });

          // 2. Get ACTIVE event for this venue
          const { data: events, error } = await supabase
            .from("events")
            .select("*")
            .eq("venue_id", venue.id)
            .eq("status", "active")
            .limit(1)
            .single();

          if (error || !events) {
            console.error("[PLAY] ❌ No active event for venue:", queryVenue, error);
            return;
          }

          event = events as unknown as Event; // Cast to Event to fix status type mismatch
          setResolvedEventId(event.id);
          setResolvedEventName(event.name);
          setActiveEvent(event);
        }
        // FALLBACK: Global active event (DEPRECATED)
        else {
          console.log("[PLAY] 🌍 Loading global active event (fallback)");
          // This fallback needs a venue_id parameter - skip if not available
          // event = await eventService.getActiveEvent();
          console.warn("[PLAY] No venue specified, cannot load event");
        }
      } catch (error) {
        console.error("[PLAY] Failed to load event:", error);
      }
    };

    loadEvent();
  }, [queryVenue, queryEvent]);

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
    if (!activeEvent) {
      throw new Error("No active event");
    }

    // Use the createFreeTicket service which handles RPC fallback
    const result = await createFreeTicket(activeEvent.id, activeEvent.venue_id || "", email, nickname);
    
    // Track which RPC was used (for debug panel)
    setRpcCalled("claim_free_tickets_v3"); // The service tries v3 first
    
    return result;
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
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-100 border-b-2 border-yellow-400 p-4">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-sm">🔧 DEBUG MODE</h3>
              <button
                onClick={() => router.push(router.pathname)}
                className="text-xs px-2 py-1 bg-yellow-200 rounded hover:bg-yellow-300"
              >
                Exit Debug
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div>
                <strong>Venue Slug:</strong> {venueSlug || "N/A"}
              </div>
              <div>
                <strong>Venue ID:</strong> {venueId?.slice(0, 8) || "N/A"}...
              </div>
              <div>
                <strong>Event ID:</strong> {resolvedEventId?.slice(0, 8) || "N/A"}...
              </div>
              <div>
                <strong>Event Name:</strong> {resolvedEventName || "N/A"}
              </div>
              <div>
                <strong>RPC Called:</strong> {rpcCalled || "none"}
              </div>
              <div>
                <strong>Tickets Claimed:</strong> {rpcResultCount || 0}
              </div>
              <div className="col-span-2">
                <details className="cursor-pointer">
                  <summary className="font-semibold">Full Event Data</summary>
                  <pre className="mt-2 p-2 bg-white rounded text-[10px] overflow-auto max-h-40">
                    {JSON.stringify(activeEvent, null, 2)}
                  </pre>
                </details>
              </div>
            </div>
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
        onCancel={() => setIsRegistrationOpen(false)}
        onSuccess={onTicketClaimed}
        eventId={activeEvent.id}
        venueId={activeEvent.venue_id || ""}
      />
    </>
  );
}