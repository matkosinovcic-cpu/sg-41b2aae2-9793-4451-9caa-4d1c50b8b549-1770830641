import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { supabase } from "@/integrations/supabase/client";
import { eventService, type Event } from "@/services/eventService";
import ticketService from "@/services/ticketService";
import { answerService } from "@/services/answerService";
import { getVenueBySlug } from "@/services/venueService";
import { Button } from "@/components/ui/button";
import { RegistrationModal } from "@/components/RegistrationModal";
import { OnboardingModal } from "@/components/OnboardingModal";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, XCircle, Clock, Trophy, Loader2 } from "lucide-react";

// Debug info interface
interface DebugInfo {
  timestamp: string;
  url: string;
  queryParams: Record<string, string>;
  resolvedVenueSlug: string | null;
  resolvedVenueId: string | null;
  resolvedEventId: string | null;
  eventData: any;
  venueData: any;
  sqlQuery: string;
  sqlParams: any;
  fallbackTriggered: string | null;
  validationErrors: string[];
}

export default function Play() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [myTicket, setMyTicket] = useState<any>(null);
  const [myAnswers, setMyAnswers] = useState<Map<number, boolean>>(new Map());
  const [showRegistration, setShowRegistration] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [hasOnboarded, setHasOnboarded] = useState(false);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastThreeAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // DEBUG STATE
  const [debugMode, setDebugMode] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  // Initialize debug mode from query
  useEffect(() => {
    const debug = router.query.debug === "1" || router.query.debug === "true";
    setDebugMode(debug);
  }, [router.query.debug]);

  // Load event based on priority: eventId → venue → error
  const loadEvent = async () => {
    try {
      const debug: DebugInfo = {
        timestamp: new Date().toISOString(),
        url: typeof window !== "undefined" ? window.location.href : "SSR",
        queryParams: router.query as Record<string, string>,
        resolvedVenueSlug: null,
        resolvedVenueId: null,
        resolvedEventId: null,
        eventData: null,
        venueData: null,
        sqlQuery: "",
        sqlParams: {},
        fallbackTriggered: null,
        validationErrors: []
      };

      const { eventId: queryEventId, venue: queryVenue } = router.query;

      // PRIORITY A: Direct eventId
      if (queryEventId && typeof queryEventId === "string") {
        debug.resolvedEventId = queryEventId;
        debug.sqlQuery = "SELECT * FROM events WHERE id = $1";
        debug.sqlParams = { id: queryEventId };

        const event = await eventService.getEventById(queryEventId);
        
        if (!event) {
          debug.validationErrors.push(`Event not found: ${queryEventId}`);
          setDebugInfo(debug);
          setActiveEvent(null);
          setLoading(false);
          return;
        }

        debug.eventData = event;
        
        // Validate venue match if venue param also provided
        if (queryVenue && event.venue_slug !== queryVenue) {
          debug.validationErrors.push(
            `MISMATCH: URL has venue=${queryVenue} but event has venue_slug=${event.venue_slug}`
          );
        }

        setDebugInfo(debug);
        setActiveEvent(event);
        setLoading(false);
        return;
      }

      // PRIORITY B: Venue slug
      if (queryVenue && typeof queryVenue === "string") {
        debug.resolvedVenueSlug = queryVenue;

        // Get venue ID
        const venue = await getVenueBySlug(queryVenue);
        
        if (!venue) {
          debug.validationErrors.push(`Venue not found: ${queryVenue}`);
          debug.fallbackTriggered = `Unknown venue: ${queryVenue}`;
          setDebugInfo(debug);
          setActiveEvent(null);
          setLoading(false);
          return;
        }

        debug.resolvedVenueId = venue.id;
        debug.venueData = venue;
        debug.sqlQuery = "SELECT * FROM events WHERE venue_id = $1 AND status ILIKE 'active' ORDER BY created_at DESC LIMIT 1";
        debug.sqlParams = { venue_id: venue.id };

        // Get active event for this venue
        const event = await eventService.getActiveEvent(venue.id);

        if (!event) {
          debug.validationErrors.push(`No active event found for venue: ${queryVenue}`);
          debug.fallbackTriggered = `No active event for venue: ${queryVenue}`;
          setDebugInfo(debug);
          setActiveEvent(null);
          setLoading(false);
          return;
        }

        debug.resolvedEventId = event.id;
        debug.eventData = event;

        // Validate venue match
        if (event.venue_slug !== queryVenue) {
          debug.validationErrors.push(
            `BUG: getActiveEvent returned wrong venue! Expected: ${queryVenue}, Got: ${event.venue_slug}`
          );
        }

        setDebugInfo(debug);
        setActiveEvent(event);
        setLoading(false);
        return;
      }

      // PRIORITY C: No params = error
      debug.fallbackTriggered = "Missing both eventId and venue params";
      debug.validationErrors.push("URL mora sadržavati ?eventId=... ili ?venue=...");
      setDebugInfo(debug);
      setActiveEvent(null);
      setLoading(false);

    } catch (err) {
      console.error("Failed to load event:", err);
      setDebugInfo(prev => prev ? {
        ...prev,
        validationErrors: [...prev.validationErrors, `Exception: ${err}`]
      } : null);
      setActiveEvent(null);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (router.isReady) {
      loadEvent();
    }
  }, [router.isReady, router.query]);

  // Subscribe to current question
  useEffect(() => {
    if (!activeEvent?.id) return;

    const channel = supabase
      .channel(`event:${activeEvent.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "events",
          filter: `id=eq.${activeEvent.id}`,
        },
        async (payload) => {
          if (payload.new && typeof payload.new === "object") {
            const updated = payload.new as any;
            
            setActiveEvent((prev) =>
              prev ? { ...prev, ...updated } : null
            );

            if (updated.current_question_number) {
              const question = await eventService.getQuestionForNumber(
                activeEvent.id,
                updated.current_question_number
              );
              setCurrentQuestion(question);

              if (questionAudioRef.current) {
                questionAudioRef.current.currentTime = 0;
                questionAudioRef.current.play().catch(() => {});
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [activeEvent?.id]);

  // Timer logic
  useEffect(() => {
    if (!activeEvent?.question_open_until) {
      setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const now = new Date().getTime();
      const deadline = new Date(activeEvent.question_open_until).getTime();
      const diff = Math.max(0, Math.ceil((deadline - now) / 1000));
      setTimeLeft(diff);

      if (diff <= 3 && diff > 0) {
        if (lastThreeAudioRef.current) {
          lastThreeAudioRef.current.currentTime = 0;
          lastThreeAudioRef.current.play().catch(() => {});
        }
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);

    return () => clearInterval(interval);
  }, [activeEvent?.question_open_until]);

  // Load my ticket
  useEffect(() => {
    const loadMyTicket = async () => {
      if (!activeEvent?.id) return;

      const serialNumber = localStorage.getItem("my_ticket_serial");
      if (!serialNumber) return;

      const ticket = await ticketService.getTicketBySerial(serialNumber);
      if (ticket && ticket.event_id === activeEvent.id) {
        setMyTicket(ticket);

        // Load answers from answerService - using session approach
        const sessionId = localStorage.getItem("ps_session_id");
        if (sessionId) {
          const answers = await answerService.getSessionAnswers(sessionId);
          const answerMap = new Map<number, boolean>();
          answers.forEach((a) => {
            if (a.ticket_id === serialNumber) {
              answerMap.set(a.question_number, a.answer_yesno === "YES");
            }
          });
          setMyAnswers(answerMap);
        }
      }
    };

    loadMyTicket();
  }, [activeEvent?.id]);

  // Check onboarding
  useEffect(() => {
    const onboarded = localStorage.getItem("has_onboarded") === "true";
    setHasOnboarded(onboarded);
    if (!onboarded && !loading && activeEvent) {
      setShowOnboarding(true);
    }
  }, [loading, activeEvent]);

  const handleAnswer = async (answer: boolean) => {
    if (!myTicket || !currentQuestion || timeLeft === null || timeLeft <= 0) return;

    try {
      const sessionId = localStorage.getItem("ps_session_id");
      if (!sessionId) {
        console.error("No session ID found");
        return;
      }

      await answerService.submitAnswer(
        sessionId,
        activeEvent!.id,
        currentQuestion.question_number,
        answer ? "YES" : "NO",
        myTicket.serial_number
      );

      setMyAnswers((prev) => new Map(prev).set(currentQuestion.question_number, answer));
    } catch (err) {
      console.error("Failed to submit answer:", err);
    }
  };

  const handleRegistrationSuccess = () => {
    setRegistrationSuccess(true);
    setShowRegistration(false);
    loadEvent();
  };

  const handleOnboardingComplete = () => {
    localStorage.setItem("has_onboarded", "true");
    setHasOnboarded(true);
    setShowOnboarding(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900">
        <Loader2 className="w-12 h-12 animate-spin text-white" />
      </div>
    );
  }

  // Error state - missing params
  if (!activeEvent && debugInfo?.fallbackTriggered) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 p-4">
        <Card className="max-w-md w-full p-6 text-center space-y-4">
          <AlertCircle className="w-16 h-16 mx-auto text-red-500" />
          <h1 className="text-2xl font-bold">Neispravan Link</h1>
          <p className="text-gray-600">
            {debugInfo.validationErrors[0] || "Link mora sadržavati event ID ili venue parametar"}
          </p>
          <p className="text-sm text-gray-500">
            Skeniraj QR kod sa eventa ili koristi link koji ti je poslan.
          </p>
          
          {debugMode && debugInfo && (
            <div className="mt-6 p-4 bg-gray-100 rounded text-left text-xs space-y-2">
              <div className="font-bold text-red-600">🐛 DEBUG INFO</div>
              <div><strong>URL:</strong> {debugInfo.url}</div>
              <div><strong>Query params:</strong> {JSON.stringify(debugInfo.queryParams)}</div>
              <div><strong>Fallback triggered:</strong> {debugInfo.fallbackTriggered}</div>
              <div><strong>Errors:</strong> {debugInfo.validationErrors.join(", ")}</div>
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (!activeEvent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 p-4">
        <Card className="max-w-md w-full p-6 text-center">
          <AlertCircle className="w-16 h-16 mx-auto text-red-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Event Nije Pronađen</h1>
          <p className="text-gray-600">Provjerite link ili kontaktirajte organizatora.</p>
        </Card>
      </div>
    );
  }

  const isQuestionOpen = timeLeft !== null && timeLeft > 0;
  const hasAnswered = currentQuestion ? myAnswers.has(currentQuestion.question_number) : false;

  return (
    <>
      <SEO
        title={`${activeEvent.name} - Igraj`}
        description="Odgovori na pitanja i osvoji nagrade!"
      />

      <audio ref={questionAudioRef} src="/sounds/question.mp3" preload="auto" />
      <audio ref={lastThreeAudioRef} src="/sounds/tick.mp3" preload="auto" />

      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900">
        {/* DEBUG PANEL - only visible with ?debug=1 */}
        {debugMode && debugInfo && (
          <div className="bg-yellow-100 border-4 border-yellow-500 p-4 text-xs font-mono space-y-2 overflow-auto">
            <div className="font-bold text-lg text-yellow-900">🐛 DEBUG PANEL</div>
            
            {debugInfo.validationErrors.length > 0 && (
              <div className="bg-red-100 border-2 border-red-500 p-3 rounded">
                <div className="font-bold text-red-700 mb-2">⚠️ VALIDATION ERRORS:</div>
                {debugInfo.validationErrors.map((err, i) => (
                  <div key={i} className="text-red-600">• {err}</div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div><strong>Timestamp:</strong></div>
              <div>{debugInfo.timestamp}</div>

              <div><strong>URL:</strong></div>
              <div className="break-all">{debugInfo.url}</div>

              <div><strong>Query Params:</strong></div>
              <div>{JSON.stringify(debugInfo.queryParams)}</div>

              <div><strong>Resolved Venue Slug:</strong></div>
              <div className="font-bold text-blue-600">{debugInfo.resolvedVenueSlug || "N/A"}</div>

              <div><strong>Resolved Venue ID:</strong></div>
              <div>{debugInfo.resolvedVenueId || "N/A"}</div>

              <div><strong>Resolved Event ID:</strong></div>
              <div className="font-bold text-green-600">{debugInfo.resolvedEventId || "N/A"}</div>

              <div><strong>SQL Query:</strong></div>
              <div className="break-all">{debugInfo.sqlQuery}</div>

              <div><strong>SQL Params:</strong></div>
              <div>{JSON.stringify(debugInfo.sqlParams)}</div>

              <div><strong>Fallback Triggered:</strong></div>
              <div className="text-red-600">{debugInfo.fallbackTriggered || "NO"}</div>
            </div>

            {debugInfo.venueData && (
              <div className="bg-blue-50 p-2 rounded">
                <div className="font-bold">Venue Data:</div>
                <pre>{JSON.stringify(debugInfo.venueData, null, 2)}</pre>
              </div>
            )}

            {debugInfo.eventData && (
              <div className="bg-green-50 p-2 rounded">
                <div className="font-bold">Event Data:</div>
                <pre>{JSON.stringify(debugInfo.eventData, null, 2)}</pre>
              </div>
            )}

            {/* SELF-TEST VALIDATION */}
            {debugInfo.queryParams.venue && debugInfo.eventData && (
              <div className="bg-purple-50 p-3 rounded border-2 border-purple-500">
                <div className="font-bold text-purple-700 mb-2">🧪 SELF-TEST VALIDATION:</div>
                <div className="space-y-1">
                  <div>
                    <strong>Expected venue:</strong> {debugInfo.queryParams.venue}
                  </div>
                  <div>
                    <strong>Actual venue:</strong> {debugInfo.eventData.venue_slug}
                  </div>
                  <div>
                    <strong>Match:</strong>{" "}
                    {debugInfo.queryParams.venue === debugInfo.eventData.venue_slug ? (
                      <span className="text-green-600 font-bold">✅ PASS</span>
                    ) : (
                      <span className="text-red-600 font-bold">❌ FAIL - BUG DETECTED!</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* BUG BANNER - show if venue mismatch detected */}
        {debugInfo?.validationErrors.some(e => e.includes("BUG") || e.includes("MISMATCH")) && (
          <div className="bg-red-600 text-white p-4 text-center font-bold text-lg">
            🚨 BUG DETECTED: Venue Mismatch! Check debug panel above.
          </div>
        )}

        {/* Header */}
        <div className="bg-black/20 backdrop-blur-sm border-b border-white/10 p-4">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold text-white mb-1">
              {activeEvent.venue_name || "Unknown Venue"}
            </h1>
            <p className="text-lg text-white/80">{activeEvent.name}</p>
            <p className="text-xs text-white/50 mt-1">
              Event: {activeEvent.id} | Venue: {activeEvent.venue_id}
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto p-4 space-y-6">
          {/* Registration prompt */}
          {!myTicket && (
            <Card className="p-6 text-center space-y-4">
              <h2 className="text-2xl font-bold">Dobrodošli!</h2>
              <p className="text-gray-600">
                Registrirajte se kako biste dobili svoju karticu i mogli igrati.
              </p>
              <Button
                size="lg"
                onClick={() => setShowRegistration(true)}
                className="w-full max-w-xs"
              >
                Registriraj se
              </Button>
            </Card>
          )}

          {/* Current Question */}
          {myTicket && currentQuestion && (
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-lg px-4 py-2">
                  Pitanje #{currentQuestion.question_number}
                </Badge>
                {timeLeft !== null && (
                  <div className={`text-3xl font-bold ${timeLeft <= 3 ? "text-red-500 animate-pulse" : "text-blue-600"}`}>
                    <Clock className="inline w-8 h-8 mr-2" />
                    {timeLeft}s
                  </div>
                )}
              </div>

              <h2 className="text-2xl font-bold text-center py-4">
                {currentQuestion.question_text}
              </h2>

              {hasAnswered ? (
                <Alert>
                  <CheckCircle2 className="h-5 w-5" />
                  <AlertDescription>
                    Odgovorili ste:{" "}
                    <strong>
                      {myAnswers.get(currentQuestion.question_number) ? "DA" : "NE"}
                    </strong>
                  </AlertDescription>
                </Alert>
              ) : isQuestionOpen ? (
                <div className="grid grid-cols-2 gap-4">
                  <Button
                    size="lg"
                    className="h-24 text-2xl bg-green-600 hover:bg-green-700"
                    onClick={() => handleAnswer(true)}
                  >
                    DA
                  </Button>
                  <Button
                    size="lg"
                    className="h-24 text-2xl bg-red-600 hover:bg-red-700"
                    onClick={() => handleAnswer(false)}
                  >
                    NE
                  </Button>
                </div>
              ) : (
                <Alert variant="destructive">
                  <XCircle className="h-5 w-5" />
                  <AlertDescription>Vrijeme za odgovor je isteklo</AlertDescription>
                </Alert>
              )}
            </Card>
          )}

          {/* My Ticket */}
          {myTicket && (
            <Card className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">Moja Kartica</h3>
                <Badge variant="outline">#{myTicket.serial_number}</Badge>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {myTicket.ticket_questions?.map((tq: any, idx: number) => {
                  const num = tq.question_number;
                  const isDrawn = activeEvent.drawn_numbers?.includes(num) || false;
                  return (
                    <div
                      key={idx}
                      className={`aspect-square flex items-center justify-center rounded-lg text-xl font-bold border-2 ${
                        isDrawn
                          ? "bg-green-100 border-green-500 text-green-700"
                          : "bg-white border-gray-300"
                      }`}
                    >
                      {num}
                    </div>
                  );
                })}
              </div>

              {myTicket.is_winner && (
                <Alert className="bg-yellow-100 border-yellow-500">
                  <Trophy className="h-5 w-5 text-yellow-600" />
                  <AlertDescription className="text-yellow-800 font-bold">
                    🎉 Čestitamo! Vaša kartica je pobjednička!
                  </AlertDescription>
                </Alert>
              )}
            </Card>
          )}

          {/* Event Status */}
          {!currentQuestion && myTicket && (
            <Card className="p-6 text-center text-gray-600">
              <p>Čeka se sljedeće pitanje...</p>
            </Card>
          )}
        </div>
      </div>

      <RegistrationModal
        open={showRegistration}
        eventId={activeEvent?.id || ""}
        venueId={activeEvent?.venue_id || ""}
        onSuccess={handleRegistrationSuccess}
        onCancel={() => setShowRegistration(false)}
      />

      <OnboardingModal
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
        onDismiss={(dontShowAgain) => {
          if (dontShowAgain) {
            localStorage.setItem("has_onboarded", "true");
          }
          setShowOnboarding(false);
          setHasOnboarded(true);
        }}
      />
    </>
  );
}