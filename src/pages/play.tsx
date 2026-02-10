import { useRouter } from "next/router";
import { useEffect, useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, User } from "lucide-react";
import { SEO } from "@/components/SEO";
import { OnboardingModal } from "@/components/OnboardingModal";
import { RegistrationModal } from "@/components/RegistrationModal";
import { cn } from "@/lib/utils";
import { ticketService, type Ticket } from "@/services/ticketService";
import { eventService, type Event, type EventQuestion } from "@/services/eventService";
import { answerService } from "@/services/answerService";
import {
  getPreviewPlayerSession,
  setPreviewPlayerSession,
  type PreviewPlayerSession
} from "@/lib/previewSession";

export default function PlayPage() {
  const router = useRouter();
  const { toast } = useToast();
  
  // -- STATE --

  // Environment & Session
  const [isPreview, setIsPreview] = useState(false);
  const [playerSession, setPlayerSession] = useState<PreviewPlayerSession | null>(null);
  const [nickname, setNickname] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(Date.now());
  
  // Event & Questions
  const [event, setEvent] = useState<Event | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  
  // Tickets & Stats
  const [ticket, setTicket] = useState<Ticket[]>([]); // Array of tickets
  const [ticketStats, setTicketStats] = useState<Record<string, { 
    answered: number; 
    correct: number; 
    incorrect: number; 
    accuracy: number 
  }>>({});
  
  // Answers
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [playerAnswers, setPlayerAnswers] = useState<Record<number, boolean>>({});
  
  // Global stats (Header)
  const [globalStats, setGlobalStats] = useState({
    answered: 0,
    correct: 0,
    incorrect: 0,
    accuracy: 0
  });
  
  // Modals
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);

  // Refs
  const channelRef = useRef<any>(null);

  // -- EFFECTS --

  // 1. Detect Environment & Load Session
  useEffect(() => {
    const hostname = window.location.hostname;
    const preview = 
      hostname.includes("softgen") ||
      hostname.includes("vercel.app") ||
      hostname.includes("localhost") ||
      hostname.includes("127.0.0.1");
    setIsPreview(preview);

    if (preview) {
      const session = getPreviewPlayerSession();
      if (session) {
        console.log("[PlayPage] ✅ Session restored:", session.nickname);
        setPlayerSession(session);
        setNickname(session.nickname);
        setEmail(session.email);
      } else {
        console.log("[PlayPage] ⚠️ No session - showing onboarding");
        setShowOnboarding(true);
      }
    }
  }, []);

  // 2. Load Event
  useEffect(() => {
    const loadEvent = async () => {
      try {
        const currentEvent = await eventService.getActiveEvent();
        if (currentEvent) {
          setEvent(currentEvent);
        }
      } catch (error) {
        console.error("Error loading event:", error);
      } finally {
        setEventLoading(false);
      }
    };
    loadEvent();
  }, []);

  // 3. Load Tickets (Filtered by Player Session in Preview)
  useEffect(() => {
    if (!isPreview || !playerSession || !event) return;

    const loadTickets = async () => {
      try {
        console.log("[PlayPage] 📋 Loading tickets for:", playerSession.nickname);
        const ticketPromises = playerSession.ticketIds.map(id =>
          ticketService.getTicket(id).catch(() => null)
        );
        const loadedTickets = await Promise.all(ticketPromises);
        const validTickets = loadedTickets.filter(t => t !== null) as Ticket[];
        setTicket(validTickets);
        console.log("[PlayPage] ✅ Tickets loaded:", validTickets.length);
      } catch (error) {
        console.error("[PlayPage] ❌ Error loading tickets:", error);
      }
    };

    loadTickets();
  }, [isPreview, playerSession, event]);

  // 4. Realtime Subscription (Questions & Answers)
  useEffect(() => {
    if (!event || !isPreview) return;

    console.log("[PlayPage] 📡 Subscribing to events table for real-time sync");

    const channel = supabase
      .channel(`events:${event.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "events",
          filter: `id=eq.${event.id}`
        },
        async (payload) => {
          console.log("[PlayPage] 🔔 Event update received:", payload);
          setRealtimeConnected(true);

          const updatedEvent = payload.new as any;

          // Check if there's an active question
          if (
            updatedEvent.current_question_number &&
            updatedEvent.question_open_until
          ) {
            const questionNumber = updatedEvent.current_question_number;
            const openUntil = updatedEvent.question_open_until;

            console.log("[PlayPage] ✅ Active question detected:", {
              questionNumber,
              openUntil
            });

            // Fetch question details from event_questions
            const { data: eventQuestion, error: eqError } = await supabase
              .from("event_questions")
              .select(`
                id,
                event_id,
                question_number,
                question_id,
                drawn,
                drawn_at,
                questions (
                  id,
                  text,
                  correct_answer
                )
              `)
              .eq("event_id", event.id)
              .eq("question_number", questionNumber)
              .single();

            if (eqError) {
              console.error("[PlayPage] ❌ Failed to fetch question details:", eqError);
              return;
            }

            if (eventQuestion) {
              console.log("[PlayPage] ✅ Question details fetched:", eventQuestion);

              // Set current question
              setCurrentQuestion(eventQuestion as any);
              setLastUpdateTime(Date.now());

              // Calculate time remaining
              const now = Date.now();
              const openUntilMs = new Date(openUntil).getTime();
              const remaining = Math.max(0, Math.floor((openUntilMs - now) / 1000));
              
              console.log("[PlayPage] ⏱️ Time remaining:", remaining);
              setTimeRemaining(remaining);
            }
          } else {
            console.log("[PlayPage] ⚠️ No active question in event");
            setCurrentQuestion(null);
            setTimeRemaining(0);
          }
        }
      )
      .subscribe((status) => {
        console.log("[PlayPage] Realtime status:", status);
        setRealtimeConnected(status === "SUBSCRIBED");
      });

    return () => {
      console.log("[PlayPage] 🔌 Unsubscribing from events");
      supabase.removeChannel(channel);
    };
  }, [event, isPreview]);

  // Fallback polling for active question (Preview only)
  useEffect(() => {
    if (!event || !isPreview) return;

    let pollTimeout: NodeJS.Timeout;

    const pollActiveQuestion = async () => {
      try {
        console.log("[PlayPage] 🔄 Polling active question (fallback)");

        // Fetch current event state
        const { data: currentEvent, error: eventError } = await supabase
          .from("events")
          .select("current_question_number, question_open_until")
          .eq("id", event.id)
          .single();

        if (eventError) {
          console.error("[PlayPage] ❌ Polling error:", eventError);
          return;
        }

        if (
          currentEvent?.current_question_number &&
          currentEvent?.question_open_until
        ) {
          const questionNumber = currentEvent.current_question_number;

          // Only update if it's a different question
          if (currentQuestion?.question_number !== questionNumber) {
            console.log("[PlayPage] 🆕 New question detected via polling:", questionNumber);

            // Fetch question details
            const { data: eventQuestion, error: eqError } = await supabase
              .from("event_questions")
              .select(`
                id,
                event_id,
                question_number,
                question_id,
                drawn,
                drawn_at,
                questions (
                  id,
                  text,
                  correct_answer
                )
              `)
              .eq("event_id", event.id)
              .eq("question_number", questionNumber)
              .single();

            if (!eqError && eventQuestion) {
              setCurrentQuestion(eventQuestion as any);
              setLastUpdateTime(Date.now());

              const now = Date.now();
              const openUntilMs = new Date(currentEvent.question_open_until).getTime();
              const remaining = Math.max(0, Math.floor((openUntilMs - now) / 1000));
              setTimeRemaining(remaining);
            }
          }
        }
      } catch (error) {
        console.error("[PlayPage] ❌ Polling exception:", error);
      } finally {
        // Continue polling every 2 seconds
        pollTimeout = setTimeout(pollActiveQuestion, 2000);
      }
    };

    // Start polling after 2 seconds (give Realtime a chance first)
    const initialTimeout = setTimeout(() => {
      pollActiveQuestion();
    }, 2000);

    return () => {
      clearTimeout(initialTimeout);
      if (pollTimeout) clearTimeout(pollTimeout);
    };
  }, [event, isPreview, currentQuestion]);

  // 5. Countdown & Auto-Negative Logic
  useEffect(() => {
    if (timeRemaining <= 0) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        const next = Math.max(0, prev - 1);
        
        // CRITICAL: Auto-negative when timer hits 0
        if (next === 0 && currentQuestion && !playerAnswers[currentQuestion.question_number]) {
          console.log("[PlayPage] ⏰ Time expired! Submitting negative answer.");
          handleAutoNegative(currentQuestion.question_number);
        }
        
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeRemaining, currentQuestion, playerAnswers]);

  // -- HANDLERS --

  // Auto-submit 'NO' when time expires
  const handleAutoNegative = async (qNum: number) => {
    // Only locally update state to show red, prevent double submits
    // Logic: If user didn't answer, it counts as incorrect/NO locally
    setPlayerAnswers(prev => ({ ...prev, [qNum]: false })); // false = wrong/red
    
    // Update global stats (count as incorrect)
    setGlobalStats(prev => ({
      ...prev,
      answered: prev.answered + 1,
      incorrect: prev.incorrect + 1,
      accuracy: Math.round(
        (prev.correct / (prev.answered + 1)) * 100
      )
    }));
  };

  const handleAnswer = async (answerYesNo: boolean) => {
    if (!currentQuestion || !event) return;
    if (submittingAnswer) return;

    // Preview Session Check
    if (isPreview) {
      const session = getPreviewPlayerSession();
      if (!session || !session.playerId) {
        setShowRegistration(true); // Open registration, don't show error toast
        return;
      }
      if (!ticket || ticket.length === 0) {
        toast({ title: "Greška", description: "Nema listića.", variant: "destructive" });
        return;
      }
    }

    setSubmittingAnswer(true);

    try {
      // 1. Submit to DB
      const dbSession = await answerService.getOrCreateSession(event.id);
      const firstTicket = ticket[0]; // Use first ticket for submission context
      
      await answerService.submitAnswer(
        dbSession.id,
        event.id,
        currentQuestion.question_number,
        answerYesNo ? "YES" : "NO",
        firstTicket.serial_number
      );

      // 2. Optimistic Update
      const isCorrect = (answerYesNo ? "YES" : "NO") === 
        (currentQuestion.questions?.correct_answer ? "YES" : "NO");

      // Update player answers (for coloring)
      setPlayerAnswers(prev => ({
        ...prev,
        [currentQuestion.question_number]: isCorrect
      }));

      // Update per-ticket stats
      const newStats = { ...ticketStats };
      ticket.forEach(t => {
        const prev = newStats[t.serial_number] || { answered: 0, correct: 0, incorrect: 0, accuracy: 0 };
        const newCorrect = prev.correct + (isCorrect ? 1 : 0);
        const newAnswered = prev.answered + 1;
        newStats[t.serial_number] = {
          answered: newAnswered,
          correct: newCorrect,
          incorrect: prev.incorrect + (!isCorrect ? 1 : 0),
          accuracy: Math.round((newCorrect / newAnswered) * 100)
        };
      });
      setTicketStats(newStats);

      // Update global stats
      setGlobalStats(prev => ({
        answered: prev.answered + 1,
        correct: prev.correct + (isCorrect ? 1 : 0),
        incorrect: prev.incorrect + (!isCorrect ? 1 : 0),
        accuracy: Math.round(
          ((prev.correct + (isCorrect ? 1 : 0)) / (prev.answered + 1)) * 100
        )
      }));

      // Stop timer & UI feedback
      setTimeRemaining(0);
      toast({
        title: isCorrect ? "Točno!" : "Netočno",
        description: isCorrect ? "Odlično!" : "Više sreće idući put.",
        className: isCorrect ? "bg-green-600 text-white" : "bg-red-600 text-white"
      });

    } catch (error: any) {
      console.error("Submit error:", error);
      toast({ title: "Greška", description: "Neuspjelo slanje.", variant: "destructive" });
    } finally {
      setSubmittingAnswer(false);
    }
  };

  // -- RENDER --

  // 1. Loading State
  if (eventLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  // 2. PREVIEW GUARD: No Session -> Show Only Onboarding
  if (isPreview && !playerSession) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <SEO title="Igrač" description="Prijavite se" />
        <header className="bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg p-6">
          <div className="container mx-auto">
             <h1 className="text-3xl font-bold">PITALICA SKITALICA</h1>
             <p className="opacity-90 mt-1">Prijavite se za igru</p>
          </div>
        </header>
        
        <OnboardingModal
          open={showOnboarding}
          onOpenChange={setShowOnboarding}
          onDismiss={() => {
            setShowOnboarding(false);
            setShowRegistration(true);
          }}
        />
        
        <RegistrationModal
          open={showRegistration}
          onOpenChange={setShowRegistration}
          onSuccess={(result) => {
            const session: Omit<PreviewPlayerSession, "timestamp"> = {
              eventId: event?.id || "",
              playerId: result.player_id,
              nickname: result.nickname,
              email: result.email,
              ticketIds: result.tickets.map((t: any) => t.id)
            };
            setPreviewPlayerSession(session);
            setPlayerSession({ ...session, timestamp: Date.now() });
            setNickname(result.nickname);
            setTicket(result.tickets);
            setShowRegistration(false);
            setShowOnboarding(false);
            toast({ title: "Dobrodošli!", description: "Sretno u igri!" });
          }}
          eventId={event?.id || ""}
          venueId=""
        />
      </div>
    );
  }

  // 3. FULL UI (Session Exists)
  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      <SEO title="Igrač" />
      
      {/* PREVIEW DEBUG BANNER */}
      {isPreview && event && (
        <div className="bg-green-600 text-white text-center py-2 text-sm font-mono">
          <strong>PREVIEW MODE</strong> | 
          Player: {playerSession?.nickname} | 
          ID: {playerSession?.playerId?.slice(0, 8) || "N/A"} | 
          Event: {event.id.slice(0, 8)}... | 
          Q: {currentQuestion?.question_number || 0}/90 | 
          Drawn: {globalStats.answered} | 
          Tickets: {ticket?.length || 0} |
          RT: {realtimeConnected ? "✓" : "✗"} | 
          LastQ: {currentQuestion?.question_id?.slice(0, 8) || "none"} |
          Updated: {new Date(lastUpdateTime).toLocaleTimeString()}
        </div>
      )}

      {/* HEADER */}
      <header className="bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold hidden md:block">PITALICA SKITALICA</h1>
              <h1 className="text-xl font-bold md:hidden">PITALICA</h1>
              {event && <p className="text-xs opacity-90">{event.name}</p>}
            </div>
            
            <div className="flex items-center gap-3 bg-white/10 px-4 py-2 rounded-full">
              <User className="w-5 h-5" />
              <span className="font-semibold">{playerSession?.nickname || nickname || "Igrač"}</span>
            </div>
          </div>

          {/* GLOBAL STATS */}
          <div className="mt-4 flex flex-wrap gap-4 text-sm border-t border-white/20 pt-2">
            <div className="font-mono">Pitanje: <b>{currentQuestion?.question_number || 0}/90</b></div>
            <div className="font-mono">T: <b className="text-green-300">{globalStats.correct}</b></div>
            <div className="font-mono">N: <b className="text-red-300">{globalStats.incorrect}</b></div>
            <div className="font-mono">%: <b>{globalStats.accuracy}%</b></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 flex-grow">
        
        {/* ACTIVE QUESTION PANEL */}
        <section className="mb-8">
          {currentQuestion && timeRemaining > 0 ? (
            <div className="bg-white rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-6 text-white flex justify-between items-center">
                <h2 className="text-2xl font-bold">Pitanje {currentQuestion.question_number}</h2>
                <div className="text-4xl font-mono font-bold tabular-nums tracking-wider bg-white/20 px-4 py-2 rounded-lg">
                  {timeRemaining}s
                </div>
              </div>
              
              <div className="p-8 text-center">
                <p className="text-2xl font-medium text-gray-800 mb-8 leading-relaxed">
                  {currentQuestion.questions?.text || "Učitavanje pitanja..."}
                </p>
                
                <div className="grid grid-cols-2 gap-6 max-w-2xl mx-auto">
                  <button
                    onClick={() => handleAnswer(true)}
                    disabled={submittingAnswer}
                    className="py-6 rounded-xl bg-green-500 hover:bg-green-600 text-white text-xl font-bold transition-all transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    DA ✓
                  </button>
                  <button
                    onClick={() => handleAnswer(false)}
                    disabled={submittingAnswer}
                    className="py-6 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xl font-bold transition-all transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    NE ✗
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow p-8 text-center border-2 border-dashed border-gray-300">
              <Loader2 className="w-10 h-10 text-gray-400 animate-spin mx-auto mb-3" />
              <p className="text-xl text-gray-500 font-medium">Čekanje na iduće pitanje...</p>
            </div>
          )}
        </section>

        {/* TICKETS GRID (2x2) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {ticket.map((t) => {
            const stats = ticketStats[t.serial_number] || { answered: 0, correct: 0, incorrect: 0, accuracy: 0 };
            return (
              <div key={t.id} className="bg-white rounded-xl shadow-md overflow-hidden border border-gray-100">
                <div className="bg-gray-50 px-4 py-3 border-b flex justify-between items-center">
                  <span className="font-mono text-gray-500 text-xs">{t.serial_number}</span>
                  <div className="text-xs font-medium space-x-2">
                    <span className="text-green-600">T:{stats.correct}</span>
                    <span className="text-red-600">N:{stats.incorrect}</span>
                    <span>{stats.accuracy}%</span>
                  </div>
                </div>
                
                <div className="p-4">
                  <div className="grid grid-cols-5 gap-2">
                    {(t.ticket_numbers || []).map((num) => {
                      const isAnswered = playerAnswers[num] !== undefined;
                      const isCorrect = playerAnswers[num] === true;
                      
                      return (
                        <div
                          key={num}
                          className={cn(
                            "aspect-square flex items-center justify-center rounded-lg font-bold text-sm transition-colors duration-300 shadow-sm",
                            !isAnswered && "bg-gray-100 text-gray-400",
                            isAnswered && isCorrect && "bg-green-500 text-white ring-2 ring-green-200",
                            isAnswered && !isCorrect && "bg-red-500 text-white ring-2 ring-red-200"
                          )}
                        >
                          {num}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}