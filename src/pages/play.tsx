import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { getPlayer } from "@/services/playerService";
import * as eventService from "@/services/eventService";
import * as ticketService from "@/services/ticketService";
import * as venueService from "@/services/venueService";
import { RegistrationModal } from "@/components/RegistrationModal";
import { OnboardingModal } from "@/components/OnboardingModal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, CheckCircle, XCircle, Clock, Ticket as TicketIcon } from "lucide-react";
import type { Event } from "@/services/eventService";

interface Ticket {
  id: string;
  serial_number: string;
  ticket_numbers: number[];
  event_id: string;
  venue_id: string;
}

interface EventQuestion {
  id: string;
  question_id: string;
  question_number: number;
  question_text?: string;
  correct_answer?: boolean;
  is_drawn?: boolean;
}

export default function PlayPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [myTicket, setMyTicket] = useState<Ticket | null>(null);
  const [myAnswer, setMyAnswer] = useState<boolean | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [showRegistration, setShowRegistration] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const soundRef = useRef<HTMLAudioElement | null>(null);

  // Debug state
  const [debugInfo, setDebugInfo] = useState<{
    queryVenue?: string;
    queryEventId?: string;
    resolvedVenueId?: string;
    resolvedVenueName?: string;
    resolvedVenueSlug?: string;
    resolvedEventId?: string;
    resolvedEventName?: string;
    resolvedEventVenueId?: string;
    selectionReason?: string;
    sqlQuery?: string;
    venueMismatch?: { expected: string; actual: string };
  }>({});

  const [venueSlug, setVenueSlug] = useState<string | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueName, setVenueName] = useState<string | null>(null);
  const [resolvedEventId, setResolvedEventId] = useState<string | null>(null);
  const [resolvedEventName, setResolvedEventName] = useState<string | null>(null);
  const [rpcCalled, setRpcCalled] = useState<string | null>(null);
  const [rpcResultCount, setRpcResultCount] = useState<number | null>(null);

  const isDebugMode = router.query.debug === "1";

  // Load event based on priority: eventId → venue → error
  const loadEvent = async () => {
    setLoading(true);
    setError(null);

    try {
      const queryEventId = router.query.eventId as string | undefined;
      const queryVenue = router.query.venue as string | undefined;

      console.log("[PLAY] 🎯 Loading event with params:", { queryEventId, queryVenue });

      // Update debug info
      setDebugInfo(prev => ({
        ...prev,
        queryEventId,
        queryVenue
      }));

      // PRIORITY A: Direct Event ID
      if (queryEventId) {
        console.log("[PLAY] 📍 PRIORITY A: Using direct eventId:", queryEventId);
        
        const event = await eventService.eventService.getEvent(queryEventId);
        if (!event) {
          setError(`Event ne postoji: ${queryEventId}`);
          setLoading(false);
          return;
        }

        // Load venue info
        if (event.venue_id) {
          const venue = await venueService.getVenueById(event.venue_id);
          setActiveEvent({
            ...event,
            venue_name: venue?.name,
            venue_slug: venue?.slug
          });

          setDebugInfo(prev => ({
            ...prev,
            resolvedVenueId: venue?.id,
            resolvedVenueName: venue?.name,
            resolvedVenueSlug: venue?.slug,
            resolvedEventId: event.id,
            resolvedEventName: event.name,
            resolvedEventVenueId: event.venue_id,
            selectionReason: "Direct eventId parameter",
            sqlQuery: `SELECT * FROM events WHERE id = '${queryEventId}'`
          }));

          // Check venue mismatch
          if (queryVenue && venue?.slug !== queryVenue) {
            setDebugInfo(prev => ({
              ...prev,
              venueMismatch: { expected: queryVenue, actual: venue?.slug || "" }
            }));
          }
        } else {
          setActiveEvent(event);
          setDebugInfo(prev => ({
            ...prev,
            resolvedEventId: event.id,
            resolvedEventName: event.name,
            selectionReason: "Direct eventId parameter (no venue)",
            sqlQuery: `SELECT * FROM events WHERE id = '${queryEventId}'`
          }));
        }

        setLoading(false);
        return;
      }

      // PRIORITY B: Venue Slug (PLAYER mode - KRITIČNO!)
      else if (queryVenue) {
        console.log(`[PLAY] 🎯 VENUE ROUTING: Query param venue="${queryVenue}"`);
        setVenueSlug(queryVenue);
        
        const venue = await venueService.getVenueBySlug(queryVenue);
        if (!venue) {
          setError(`Venue ne postoji: ${queryVenue}`);
          setLoading(false);
          return;
        }
        
        console.log(`[PLAY] ✅ Resolved venue:`, { id: venue.id, name: venue.name, slug: venue.slug });
        setVenueId(venue.id);
        setVenueName(venue.name);
        
        const event = await eventService.eventService.getActiveEvent(venue.id);
        if (!event) {
          setError(`Nema aktivnog eventa za venue: ${venue.name}`);
          setLoading(false);
          return;
        }
        
        console.log(`[PLAY] ✅ Resolved event:`, { id: event.id, name: event.name, venue_id: event.venue_id });
        setResolvedEventId(event.id);
        setResolvedEventName(event.name);
        setActiveEvent(event);
      }

      // PRIORITY C: Error - no params provided
      setError("Missing venue parameter. Dodaj ?venue=boiler ili ?venue=ludababa u URL.");
      setLoading(false);

    } catch (err) {
      console.error("[PLAY] ❌ Failed to load event:", err);
      setError("Greška pri učitavanju eventa. Pokušaj ponovno.");
      setActiveEvent(null);
      setLoading(false);
    }
  };

  // Load event on mount and when query changes
  useEffect(() => {
    if (router.isReady) {
      loadEvent();
    }
  }, [router.isReady, router.query.eventId, router.query.venue]);

  // Poll for event updates
  useEffect(() => {
    if (!activeEvent) return;

    let mounted = true;
    const interval = setInterval(async () => {
      try {
        const updated = await eventService.eventService.getEvent(activeEvent.id);
        if (!mounted || !updated) return;

        if (updated.current_question_number !== activeEvent.current_question_number) {
          setActiveEvent(updated);
          const question = await eventService.eventService.getQuestionForNumber(activeEvent.id, updated.current_question_number);
          setCurrentQuestion(question);
          setMyAnswer(null);
          if (soundRef.current) soundRef.current.play();
        }
      } catch (err) {
        console.error("[PLAY] ❌ Error polling event:", err);
      }
    }, 2000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [activeEvent]);

  // Load current question
  useEffect(() => {
    if (!activeEvent?.current_question_number) return;

    const loadQuestion = async () => {
      try {
        const question = await eventService.eventService.getQuestionForNumber(
          activeEvent.id,
          activeEvent.current_question_number
        );
        setCurrentQuestion(question);
      } catch (err) {
        console.error("[PLAY] ❌ Error loading question:", err);
      }
    };
    loadQuestion();
  }, [activeEvent?.current_question_number]);

  // Timer countdown
  useEffect(() => {
    if (!activeEvent?.question_open_until) {
      setTimeRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const end = new Date(activeEvent.question_open_until).getTime();
      const remaining = Math.max(0, Math.floor((end - now) / 1000));
      setTimeRemaining(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [activeEvent?.question_open_until]);

  // Load my ticket
  useEffect(() => {
    const loadMyTicket = async () => {
      if (!activeEvent?.id) return;

      try {
        const player = getPlayer();
        if (!player?.id) return;

        const ticketId = localStorage.getItem(`ps_ticket_${activeEvent.id}`);
        if (ticketId) {
          const ticket = await ticketService.getTicket(ticketId);
          if (ticket) {
            // Transform DB format to local format
            const ticketNumbers = Array.isArray(ticket.ticket_questions)
              ? ticket.ticket_questions.map(q => q.question_number).sort((a, b) => a - b)
              : [];

            setMyTicket({
              id: ticket.id,
              serial_number: ticket.serial_number,
              ticket_numbers: ticketNumbers,
              event_id: ticket.event_id,
              venue_id: ticket.venue_id || activeEvent.venue_id || ""
            });
          }
        }
      } catch (err) {
        console.error("[PLAY] ❌ Error loading ticket:", err);
      }
    };
    loadMyTicket();
  }, [activeEvent?.id]);

  // Check onboarding
  useEffect(() => {
    const dismissed = localStorage.getItem("ps_onboarding_dismissed");
    if (!dismissed && !hasOnboarded) {
      setShowOnboarding(true);
    }
  }, []);

  const handleAnswer = async (answer: boolean) => {
    if (!myTicket || !currentQuestion || timeRemaining <= 0) return;

    setMyAnswer(answer);

    try {
      // TODO: Submit answer to backend
      console.log("[PLAY] 📝 Answer submitted:", { answer, question: currentQuestion.question_number });
    } catch (err) {
      console.error("[PLAY] ❌ Failed to submit answer:", err);
    }
  };

  const handleClaimTicket = async () => {
    const player = getPlayer();
    if (!player) {
      setShowRegistration(true);
      return;
    }

    if (!activeEvent) {
      alert("Nema aktivnog eventa");
      return;
    }

    try {
      console.log("[PLAY] 🎫 Claiming ticket for event:", activeEvent.id, "venue:", activeEvent.venue_id);

      const result = await ticketService.createFreeTicket(
        activeEvent.id,
        activeEvent.venue_id || ""
      );

      console.log("[PLAY] ✅ Ticket claimed:", result);

      // Save ticket ID to localStorage
      localStorage.setItem(`ps_ticket_${activeEvent.id}`, result.id);

      setMyTicket({
        id: result.id,
        serial_number: result.serial_number, // Fix: use serial_number instead of serial
        ticket_numbers: result.ticket_numbers,
        event_id: result.event_id,
        venue_id: result.venue_id
      });

      alert(`Tiket preuzet! Serial: ${result.serial_number}`);
    } catch (err) {
      console.error("[PLAY] ❌ Failed to claim ticket:", err);
      alert(`Greška: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const fetchTicketData = async (tId: string) => {
    try {
      const ticketData = await ticketService.getTicketWithAnswers(tId);
      if (ticketData) {
        setMyTicket(ticketData as any);
      }
    } catch (error) {
      console.error("[PLAY] Error fetching ticket:", error);
    }
  };

  const onTicketClaimed = (ticket: Ticket) => {
    console.log("[PLAY] ✅ Ticket claimed successfully:", ticket);
    
    // Track RPC call for debug panel
    setRpcCalled("claim_free_tickets_v3 or legacy");
    setRpcResultCount(1);
    
    setShowRegistration(false);
    // Cast to any to avoid strict type mismatch if backend type differs slightly
    setMyTicket(ticket as any);
    
    // Subscribe to real-time updates for this ticket
    if (ticket.id) {
      const channel = supabase
        .channel(`ticket:${ticket.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "answers",
            filter: `ticket_id=eq.${ticket.id}`
          },
          (payload) => {
            console.log("[PLAY] Real-time answer update:", payload);
            fetchTicketData(ticket.id);
          }
        )
        .subscribe();

      return () => {
        channel.unsubscribe();
      };
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-6 max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-2">Greška</h2>
          <p className="text-gray-700">{error}</p>
        </Card>
      </div>
    );
  }

  if (!activeEvent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-6 max-w-md">
          <h2 className="text-xl font-bold mb-2">Nema aktivnog eventa</h2>
          <p className="text-gray-700">Trenutno nema aktivnih događaja.</p>
        </Card>
      </div>
    );
  }

  const isAnswerLocked = timeRemaining <= 0;
  const hasAnsweredCurrentQuestion = myAnswer !== null;

  return (
    <>
      <SEO
        title={`${activeEvent.name} - Igraj`}
        description="Igraj uživo quiz na svom mobitelu"
      />

      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white">
        {isDebugMode && (
          <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-100 border-b-4 border-yellow-400 p-4 shadow-lg">
            <div className="max-w-4xl mx-auto">
              <h3 className="font-bold text-lg mb-2">🐛 DEBUG MODE</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                {/* URL & Query Params */}
                <div>
                  <h4 className="font-semibold mb-1">URL & Query Params:</h4>
                  <pre className="bg-white p-2 rounded overflow-auto text-xs">
                    {JSON.stringify({ venue: debugInfo.queryVenue, eventId: debugInfo.queryEventId, debug: "1" }, null, 2)}
                  </pre>
                </div>

                {/* Venue Resolution */}
                <div>
                  <h4 className="font-semibold mb-1">Venue Resolution:</h4>
                  <pre className="bg-white p-2 rounded overflow-auto text-xs">
                    {JSON.stringify({ 
                      venueSlug: debugInfo.resolvedVenueSlug, 
                      venueId: debugInfo.resolvedVenueId, 
                      venueName: debugInfo.resolvedVenueName 
                    }, null, 2)}
                  </pre>
                </div>

                {/* Event Resolution */}
                <div>
                  <h4 className="font-semibold mb-1">Event Resolution:</h4>
                  <pre className="bg-white p-2 rounded overflow-auto text-xs">
                    {JSON.stringify({ 
                      resolvedEventId, 
                      resolvedEventName,
                      eventVenueId: activeEvent?.venue_id
                    }, null, 2)}
                  </pre>
                </div>

                {/* RPC Info */}
                <div>
                  <h4 className="font-semibold mb-1">RPC Claim Info:</h4>
                  <pre className="bg-white p-2 rounded overflow-auto text-xs">
                    {JSON.stringify({ 
                      rpcCalled: rpcCalled || "N/A", 
                      rpcResultCount: rpcResultCount ?? "N/A" 
                    }, null, 2)}
                  </pre>
                </div>

                {/* Validation */}
                <div className="md:col-span-2">
                  <h4 className="font-semibold mb-1">Validation:</h4>
                  <div className="bg-white p-2 rounded text-xs">
                    {venueId && activeEvent?.venue_id === venueId ? (
                      <p className="text-green-700">✅ PASS: Event venue_id matches resolved venue_id</p>
                    ) : (
                      <p className="text-red-700">❌ FAIL: Venue mismatch! Event venue_id: {activeEvent?.venue_id}, Resolved venue_id: {venueId}</p>
                    )}
                  </div>
                </div>

                {/* Full Event Data */}
                <div className="md:col-span-2">
                  <details>
                    <summary className="cursor-pointer font-semibold">Event Data (Full)</summary>
                    <pre className="bg-white p-2 rounded overflow-auto text-xs mt-2">
                      {JSON.stringify(activeEvent, null, 2)}
                    </pre>
                  </details>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* BUG DETECTION BANNER */}
        {debugInfo.venueMismatch && (
          <div className="bg-red-600 text-white p-4 text-center font-bold border-b-4 border-red-800">
            🚨 BUG DETECTED: Venue routing nije ispravan! Expected "{debugInfo.venueMismatch.expected}" but got "{debugInfo.venueMismatch.actual}"
          </div>
        )}

        {/* Header */}
        <div className="bg-black/30 backdrop-blur-sm p-4 border-b border-white/20">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{activeEvent.name}</h1>
              <p className="text-sm text-white/70">
                Venue: {activeEvent.venue_name || activeEvent.venue_slug || "N/A"} | 
                Status: {activeEvent.status} | 
                Pitanje: {activeEvent.current_question_number}/90
              </p>
            </div>
            {myTicket && (
              <div className="text-right">
                <p className="text-xs text-white/70">Moj tiket</p>
                <p className="font-mono font-bold">{myTicket.serial_number}</p>
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {/* Current Question */}
          {currentQuestion && (
            <Card className="p-6 bg-white/10 backdrop-blur-md border-white/20">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm text-white/70 mb-1">Pitanje #{currentQuestion.question_number}</p>
                  <p className="text-2xl font-bold">{currentQuestion.question_text}</p>
                </div>
                {timeRemaining > 0 ? (
                  <div className="flex items-center gap-2 text-yellow-400">
                    <Clock className="w-5 h-5" />
                    <span className="text-3xl font-bold font-mono">{timeRemaining}s</span>
                  </div>
                ) : (
                  <div className="text-red-400 font-bold">ZAKLJUČANO</div>
                )}
              </div>

              {/* Answer Buttons */}
              {myTicket && myTicket.ticket_numbers.includes(currentQuestion.question_number) ? (
                <div className="flex gap-4">
                  <Button
                    onClick={() => handleAnswer(true)}
                    disabled={isAnswerLocked || hasAnsweredCurrentQuestion}
                    className={`flex-1 h-20 text-2xl font-bold ${
                      myAnswer === true ? "bg-green-600" : "bg-green-500 hover:bg-green-600"
                    }`}
                  >
                    <CheckCircle className="w-8 h-8 mr-2" />
                    DA
                  </Button>
                  <Button
                    onClick={() => handleAnswer(false)}
                    disabled={isAnswerLocked || hasAnsweredCurrentQuestion}
                    className={`flex-1 h-20 text-2xl font-bold ${
                      myAnswer === false ? "bg-red-600" : "bg-red-500 hover:bg-red-600"
                    }`}
                  >
                    <XCircle className="w-8 h-8 mr-2" />
                    NE
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8 text-white/70">
                  <p className="text-lg">Ovo pitanje nije na tvom tiketu</p>
                </div>
              )}
            </Card>
          )}

          {/* My Ticket */}
          {myTicket ? (
            <Card className="p-6 bg-white/10 backdrop-blur-md border-white/20">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <TicketIcon className="w-5 h-5" />
                Moj Tiket: {myTicket.serial_number}
              </h3>
              <div className="grid grid-cols-5 gap-2">
                {myTicket.ticket_numbers.map((num) => {
                  const isDrawn = currentQuestion && num <= currentQuestion.question_number;
                  const isCurrent = currentQuestion && num === currentQuestion.question_number;
                  
                  return (
                    <div
                      key={num}
                      className={`
                        aspect-square rounded-lg flex items-center justify-center font-bold text-xl
                        ${isCurrent ? "bg-yellow-500 text-black animate-pulse" : ""}
                        ${isDrawn && !isCurrent ? "bg-green-600" : ""}
                        ${!isDrawn ? "bg-white/20" : ""}
                      `}
                    >
                      {num}
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : (
            <Card className="p-6 bg-white/10 backdrop-blur-md border-white/20 text-center">
              <p className="text-lg mb-4">Nemaš tiket za ovaj event</p>
              <Button
                onClick={handleClaimTicket}
                size="lg"
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                <TicketIcon className="w-5 h-5 mr-2" />
                Preuzmi Tiket (FREE)
              </Button>
            </Card>
          )}
        </div>

        {/* Sound effect */}
        <audio ref={soundRef} src="/sounds/question-start.mp3" preload="auto" />
      </div>

      {/* MODALS */}
      <RegistrationModal
        open={showRegistration}
        eventId={activeEvent?.id || ""}
        venueId={activeEvent?.venue_id || ""}
        onSuccess={() => {
          setShowRegistration(false);
          handleClaimTicket();
        }}
        onCancel={() => setShowRegistration(false)}
      />

      <OnboardingModal
        open={showOnboarding}
        onDismiss={() => {
          localStorage.setItem("ps_onboarding_dismissed", "true");
          setShowOnboarding(false);
          setHasOnboarded(true);
        }}
      />
    </>
  );
}