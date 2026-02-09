import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import * as eventService from "@/services/eventService";
import * as venueService from "@/services/venueService";
import * as ticketService from "@/services/ticketService";
import * as answerService from "@/services/answerService";
import { getPlayer } from "@/services/playerService";
import { RegistrationModal } from "@/components/RegistrationModal";
import { OnboardingModal } from "@/components/OnboardingModal";
import { AlertCircle, CheckCircle2, XCircle, Clock, Trophy, Loader2 } from "lucide-react";

// Types
interface Event {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  draw_mode: "standalone" | "global" | "manual" | "auto" | "scheduled";
  current_question_number: number;
  question_timer_seconds: number;
  venue_id?: string;
  venue_name?: string;
  venue_slug?: string;
}

interface Ticket {
  id: string;
  serial_number: string;
  ticket_numbers: number[];
}

interface DebugInfo {
  timestamp: string;
  url: string;
  queryParams: any;
  resolvedVenueSlug: string;
  resolvedVenueId: string;
  resolvedEventId: string;
  sqlQuery: string;
  sqlParams: any;
  eventData: any;
  venueData: any;
  errors: string[];
  fallbackTriggered: boolean;
}

export default function PlayPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [myTicket, setMyTicket] = useState<Ticket | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<any | null>(null);
  const [timer, setTimer] = useState<number>(0);
  const [showRegistration, setShowRegistration] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [venueMismatch, setVenueMismatch] = useState<{ expected: string; actual: string } | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const [claimingTicket, setClaimingTicket] = useState(false);
  const [myAnswers, setMyAnswers] = useState<Record<number, boolean>>({});

  const questionAudioRef = useRef<HTMLAudioElement | null>(null);

  // Load event based on priority: eventId → venue → error
  const loadEvent = async () => {
    if (!router.isReady) return;

    setLoading(true);
    setError(null);
    setVenueMismatch(null);

    const startTime = Date.now();
    let sqlQuery = "";
    let sqlParams: Record<string, unknown> = {};
    let resolvedVenueSlug = "";
    let resolvedVenueId = "";
    let resolvedEventId = "";

    try {
      const queryEventId = router.query.eventId as string | undefined;
      const queryVenue = router.query.venue as string | undefined;
      const isDebug = router.query.debug === "1";

      setDebugInfo({
        timestamp: new Date().toISOString(),
        url: window.location.href,
        queryParams: { eventId: queryEventId, venue: queryVenue, debug: isDebug },
        resolvedVenueSlug: "",
        resolvedVenueId: "",
        resolvedEventId: "",
        sqlQuery: "",
        sqlParams: {},
        eventData: null,
        venueData: null,
        errors: [],
        fallbackTriggered: false
      });

      // PRIORITY A: Direct eventId (bypass venue lookup)
      if (queryEventId && typeof queryEventId === "string") {
        console.log("[Play] 🎯 Priority A: Direct eventId =", queryEventId);
        
        sqlQuery = "SELECT * FROM events WHERE id = $1";
        sqlParams = { id: queryEventId };
        resolvedEventId = queryEventId;

        const event = await eventService.eventService.getEvent(queryEventId);
        if (!event) {
          throw new Error("Event sa ID-om " + queryEventId + " nije pronađen.");
        }

        // Get venue data
        if (event.venue_id) {
          const venue = await venueService.getVenueById(event.venue_id);
          if (venue) {
            resolvedVenueSlug = venue.slug || "";
            resolvedVenueId = venue.id;
            event.venue_name = venue.name;
            event.venue_slug = venue.slug;
          }
        }

        setActiveEvent(event);
        setDebugInfo(prev => ({
          ...prev!,
          resolvedEventId,
          resolvedVenueSlug,
          resolvedVenueId,
          sqlQuery,
          sqlParams,
          eventData: event,
          venueData: event.venue_id ? venueService.getVenueById(event.venue_id) : null
        }));
        setLoading(false);
        return;
      }

      // PRIORITY B: Venue slug
      if (queryVenue && typeof queryVenue === "string") {
        console.log("[Play] 🎯 Priority B: venue slug =", queryVenue);
        
        resolvedVenueSlug = queryVenue;

        // Step 1: Get venue by slug
        const venue = await venueService.getVenueBySlug(queryVenue);
        if (!venue) {
          setError(`Venue "${queryVenue}" nije pronađen u bazi.`);
          setDebugInfo(prev => ({
            ...prev!,
            errors: [...(prev?.errors || []), `Venue slug "${queryVenue}" not found in venues table`]
          }));
          setLoading(false);
          return;
        }

        resolvedVenueId = venue.id;
        console.log("[Play] ✅ Venue found:", venue.name, "| ID:", venue.id);

        // Step 2: Get ACTIVE event for this venue
        sqlQuery = "SELECT * FROM events WHERE venue_id = $1 AND status ILIKE 'active' ORDER BY created_at DESC LIMIT 1";
        sqlParams = { venue_id: venue.id };

        const event = await eventService.eventService.getActiveEvent(venue.id);
        if (!event) {
          setError(`Nema aktivnog eventa za venue: ${venue.name}`);
          setDebugInfo(prev => ({
            ...prev!,
            resolvedVenueSlug,
            resolvedVenueId,
            sqlQuery,
            sqlParams,
            venueData: venue,
            errors: [...(prev?.errors || []), `No ACTIVE event found for venue_id=${venue.id}`]
          }));
          setLoading(false);
          return;
        }

        resolvedEventId = event.id;
        console.log("[Play] ✅ Active event found:", event.name, "| ID:", event.id);

        // Validate venue match
        if (event.venue_slug && event.venue_slug !== queryVenue) {
          console.warn("[Play] ⚠️ VENUE MISMATCH!");
          setVenueMismatch({ expected: queryVenue, actual: event.venue_slug });
        }

        setActiveEvent(event);
        setDebugInfo({
          timestamp: new Date().toISOString(),
          url: window.location.href,
          queryParams: { eventId: queryEventId, venue: queryVenue, debug: isDebug },
          resolvedVenueSlug,
          resolvedVenueId,
          resolvedEventId,
          sqlQuery,
          sqlParams,
          eventData: event,
          venueData: venue,
          errors: [],
          fallbackTriggered: false
        });
        setLoading(false);
        return;
      }

      // PRIORITY C: No params - show error
      setError("Missing required parameter: eventId or venue");
      setDebugInfo(prev => ({
        ...prev!,
        errors: [...(prev?.errors || []), "No eventId or venue provided in URL"]
      }));
      setLoading(false);
    } catch (err) {
      console.error("[Play] ❌ Error loading event:", err);
      setError("Greška pri učitavanju eventa. Pokušaj ponovno.");
      setActiveEvent(null);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (router.isReady) {
      loadEvent();
    }
  }, [router.isReady, router.query.venue, router.query.eventId]);

  // Handle ticket claiming
  const handleClaimTicket = async () => {
    if (!activeEvent?.id || !activeEvent?.venue_id) {
      alert("Event nije ispravno učitan (nedostaje ID ili Venue ID). Refreshaj stranicu.");
      return;
    }

    const player = getPlayer();
    if (!player) {
      setShowRegistration(true);
      return;
    }

    try {
      setClaimingTicket(true);
      const ticket = await ticketService.createFreeTicket(activeEvent.id, activeEvent.venue_id);
      setMyTicket(ticket);
      // Refresh user data or show success
      alert("Uspješno si preuzeo tiket!");
    } catch (err: any) {
      console.error("Failed to claim ticket:", err);
      alert(err.message || "Greška pri preuzimanju tiketa. Pokušaj ponovno.");
    } finally {
      setClaimingTicket(false);
    }
  };

  // Poll for question updates
  useEffect(() => {
    if (!activeEvent?.id) return;

    let mounted = true;
    const interval = setInterval(async () => {
      try {
        const updated = await eventService.eventService.getEvent(activeEvent.id);
        if (updated && mounted) {
           // Update event status/question number only
           if (updated.current_question_number !== activeEvent.current_question_number) {
              const question = await eventService.eventService.getQuestionForNumber(activeEvent.id, updated.current_question_number);
              setCurrentQuestion(question);
              // Play sound if question changed
              if (questionAudioRef.current) {
                questionAudioRef.current.play().catch(() => {});
              }
           }
           // Update other fields if needed, but keep it minimal to avoid re-renders
           setActiveEvent(prev => prev ? { ...prev, ...updated } : updated);
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 3000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [activeEvent?.id]);

  // Load my ticket
  useEffect(() => {
    const loadMyTicket = async () => {
      if (activeEvent?.id) {
        try {
          // Check if player has a ticket by checking localStorage or session
          const player = getPlayer();
          if (player?.ticketId) {
            const ticket = await ticketService.getTicket(player.ticketId);
            if (ticket && ticket.event_id === activeEvent.id) {
              setMyTicket(ticket);
            }
          }
        } catch (err) {
          console.error("Error loading ticket:", err);
        }
      }
    };
    loadMyTicket();
  }, [activeEvent?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white">
        <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
      </div>
    );
  }

  const isDebug = router.query.debug === "1";

  return (
    <>
      <SEO 
        title={activeEvent ? `${activeEvent.name}` : "Pitalica Skitalica"} 
        description="Pridruži se igri uživo!" 
      />
      
      <div className="min-h-screen bg-black text-white font-sans flex flex-col items-center p-4">
        {/* AUDIO ELEMENT */}
        <audio ref={questionAudioRef} src="/sounds/question_start.mp3" preload="auto" />

        {/* 🚨 BUG BANNER */}
        {venueMismatch && (
          <div className="w-full max-w-md bg-red-600 text-white p-4 mb-4 rounded-lg animate-pulse shadow-lg border-2 border-red-400">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <AlertCircle /> 🚨 BUG DETECTED: Venue Mismatch!
            </h3>
            <p className="mt-1">URL Venue: <strong>{venueMismatch.expected}</strong></p>
            <p>DB Venue: <strong>{venueMismatch.actual}</strong></p>
            <p className="text-sm mt-2 opacity-80">
              The player loaded an event that belongs to a different venue than requested.
            </p>
          </div>
        )}

        {/* 🟡 DEBUG PANEL */}
        {isDebug && debugInfo && (
          <div className="w-full max-w-md bg-yellow-100 text-black p-2 mb-4 rounded text-xs font-mono border-2 border-yellow-500 overflow-x-auto">
            <p><strong>🕒 Time:</strong> {debugInfo.timestamp}</p>
            <p><strong>🔗 URL:</strong> {debugInfo.url}</p>
            <p><strong>🔍 Params:</strong> {JSON.stringify(debugInfo.queryParams)}</p>
            <div className="my-1 border-t border-yellow-300 pt-1">
              <p><strong>📍 Resolved Venue Slug:</strong> {debugInfo.resolvedVenueSlug || "N/A"}</p>
              <p><strong>🆔 Resolved Venue ID:</strong> {debugInfo.resolvedVenueId || "N/A"}</p>
              <p><strong>🆔 Resolved Event ID:</strong> {debugInfo.resolvedEventId || "N/A"}</p>
            </div>
            <div className="my-1 border-t border-yellow-300 pt-1">
              <p><strong>📅 Event Data:</strong> {debugInfo.eventData?.name}</p>
              <p><strong>🏢 Venue Data:</strong> {debugInfo.venueData?.name}</p>
            </div>
            <div className="my-1 border-t border-yellow-300 pt-1">
              <p><strong>📜 SQL Query:</strong> {debugInfo.sqlQuery}</p>
            </div>
            {/* SELF TEST VALIDATION */}
            <div className={`mt-2 p-1 text-center font-bold text-white rounded ${venueMismatch ? 'bg-red-600' : 'bg-green-600'}`}>
              TEST STATUS: {venueMismatch ? "❌ FAIL" : "✅ PASS"}
            </div>
          </div>
        )}

        {/* ERROR SCREEN */}
        {error && (
          <div className="flex flex-col items-center justify-center h-[50vh] text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
            <h2 className="text-xl font-bold mb-2">Greška</h2>
            <p className="text-gray-400 max-w-xs">{error}</p>
            <button 
              onClick={() => router.reload()} 
              className="mt-6 px-6 py-2 bg-white text-black rounded-full font-bold"
            >
              Pokušaj ponovno
            </button>
          </div>
        )}

        {/* MAIN CONTENT */}
        {activeEvent && !error && (
          <div className="w-full max-w-md space-y-6">
            
            {/* HEADER */}
            <header className="text-center py-4 border-b border-white/10">
              <div className="text-brand-primary font-bold text-sm tracking-widest uppercase mb-1">
                {activeEvent.venue_name || activeEvent.venue_slug || "Pitalica"}
              </div>
              <h1 className="text-2xl font-black italic">{activeEvent.name}</h1>
              {isDebug && (
                <div className="text-[10px] text-gray-500 mt-1 font-mono">
                  Event: {activeEvent.id.slice(0, 8)}... | Venue: {activeEvent.venue_id?.slice(0, 8)}...
                </div>
              )}
            </header>

            {/* STATUS & TICKET */}
            <div className="bg-white/5 rounded-2xl p-6 border border-white/10 text-center">
              {myTicket ? (
                <div>
                  <div className="text-brand-secondary text-sm font-bold mb-2">MOJ TIKET</div>
                  <div className="text-4xl font-mono font-black tracking-wider text-white mb-2">
                    {myTicket.serial_number}
                  </div>
                  <div className="flex flex-wrap justify-center gap-1 mt-4">
                    {myTicket.ticket_numbers?.map((num) => (
                      <span key={num} className="inline-block w-8 h-8 leading-8 text-center bg-white/10 rounded-full text-xs font-bold">
                        {num}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-gray-400 mb-6">Još nemaš tiket za ovu igru.</p>
                  <button
                    onClick={handleClaimTicket}
                    disabled={claimingTicket}
                    className="w-full py-4 bg-brand-primary text-white font-bold rounded-xl text-lg hover:brightness-110 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {claimingTicket ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Generiranje...
                      </>
                    ) : (
                      "🎟️ Preuzmi BESPLATNI tiket"
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* LIVE QUESTION */}
            {currentQuestion ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center text-sm font-bold text-gray-400 px-2">
                  <span>Pitanje {activeEvent.current_question_number}</span>
                  <span className="flex items-center gap-1 text-brand-primary">
                    <Clock className="w-4 h-4" /> {timer}s
                  </span>
                </div>
                
                <div className="bg-white text-black p-6 rounded-2xl shadow-xl">
                  <h3 className="text-xl font-bold mb-6 leading-tight">{currentQuestion.text}</h3>
                  <div className="space-y-3">
                    {/* Render answers here */}
                    <div className="p-3 bg-gray-100 rounded-lg text-center text-sm font-mono text-gray-500">
                      Odgovori se prikazuju na glavnom ekranu
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-10 opacity-50">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                <p>Čekanje na iduće pitanje...</p>
              </div>
            )}

          </div>
        )}
      </div>

      {/* MODALS */}
      <RegistrationModal
        open={showRegistration}
        eventId={activeEvent?.id || ""}
        venueId={activeEvent?.venue_id || ""}
        onSuccess={() => {
          setShowRegistration(false);
          handleClaimTicket(); // Auto-retry claim after registration
        }}
        onCancel={() => setShowRegistration(false)}
      />
      
      <OnboardingModal
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
        onDismiss={(dontShowAgain) => {
          setShowOnboarding(false);
          setHasOnboarded(true);
          if (dontShowAgain) {
            localStorage.setItem("ps_onboarding_dismissed", "true");
          }
        }}
      />
    </>
  );
}