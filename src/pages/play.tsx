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
  const [drawnCount, setDrawnCount] = useState(0);
  
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
    console.log("[PlayPage] 🚀 Mount - detecting environment...");
    
    const hostname = window.location.hostname;
    const preview = 
      hostname.includes("softgen") ||
      hostname.includes("vercel.app") ||
      hostname.includes("localhost") ||
      hostname.includes("127.0.0.1");
    
    console.log("[PlayPage] 🌍 Environment:", {
      hostname,
      isPreview: preview
    });
    
    setIsPreview(preview);

    if (preview) {
      console.log("[PlayPage] 📋 Preview mode - loading session...");
      
      const session = getPreviewPlayerSession();
      
      if (session) {
        console.log("[PlayPage] ✅ Session restored:", {
          playerId: session.playerId ? session.playerId.slice(0, 8) + "..." : "N/A",
          nickname: session.nickname,
          email: session.email,
          ticketCount: session.ticketIds?.length || 0
        });
        
        setPlayerSession(session);
        setNickname(session.nickname);
        setEmail(session.email);
        
        console.log("[PlayPage] ✅ State updated with session data");
      } else {
        console.log("[PlayPage] ⚠️ No valid session found");
        console.log("[PlayPage] Opening onboarding modal...");
        setShowOnboarding(true);
      }
    } else {
      console.log("[PlayPage] 🌐 Production mode - using standard auth");
    }
  }, []);

  // 2. Load Event
  useEffect(() => {
    const loadEvent = async () => {
      try {
        const currentEvent = await eventService.getActiveEvent();
        if (currentEvent) {
          setEvent(currentEvent);
          
          // Fetch drawn count
          if (isPreview) {
            const { count, error } = await supabase
              .from("event_questions")
              .select("*", { count: "exact", head: true })
              .eq("event_id", currentEvent.id)
              .eq("drawn", true);
            
            if (!error && count !== null) {
              setDrawnCount(count);
              console.log("[PlayPage] ✅ Drawn count loaded:", count);
            }
          }
        }
      } catch (error) {
        console.error("Error loading event:", error);
      } finally {
        setEventLoading(false);
      }
    };
    loadEvent();
  }, [isPreview]);

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

  // 4. Load Player Stats (CRITICAL - fetch from DB after mount and after answers)
  useEffect(() => {
    if (!event || !isPreview || !playerSession) {
      console.log("[PlayPage] ⏭️ Skipping stats load:", {
        hasEvent: !!event,
        isPreview,
        hasPlayerSession: !!playerSession
      });
      return;
    }

    const loadPlayerStats = async () => {
      try {
        console.log("[PlayPage] 📊 Loading player stats from player_answers table...");
        console.log("[PlayPage] 🔍 Query params:", {
          eventId: event.id?.slice(0, 8),
          sessionId: playerSession.playerId?.slice(0, 8),
          ticketCount: ticket?.length || 0
        });

        // CRITICAL: Fetch all player_answers for this event and session
        const { data: answers, error } = await supabase
          .from("player_answers")
          .select("question_number, is_correct, ticket_id")
          .eq("event_id", event.id)
          .eq("session_id", playerSession.playerId);

        if (error) {
          console.error("[PlayPage] ❌ Stats load error:", {
            errorMessage: error.message,
            errorCode: error.code,
            errorDetails: error.details
          });
          return;
        }

        if (!answers || answers.length === 0) {
          console.log("[PlayPage] ℹ️ No answers yet in player_answers table");
          return;
        }

        console.log("[PlayPage] ✅ Loaded", answers.length, "answers from player_answers");
        console.log("[PlayPage] 📋 Sample answers:", answers.slice(0, 3));

        // Calculate global stats
        const correct = answers.filter(a => a.is_correct).length;
        const incorrect = answers.filter(a => !a.is_correct).length;
        const total = correct + incorrect;
        const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

        setGlobalStats({
          answered: total,
          correct,
          incorrect,
          accuracy
        });

        console.log("[PlayPage] ✅ Global stats calculated:", {
          total,
          correct,
          incorrect,
          accuracy
        });

        // Build playerAnswers map for coloring
        const answersMap: Record<number, boolean> = {};
        answers.forEach(a => {
          answersMap[a.question_number] = a.is_correct;
        });
        setPlayerAnswers(answersMap);

        console.log("[PlayPage] ✅ Player answers map built:", {
          questionsAnswered: Object.keys(answersMap).length,
          sampleMap: Object.entries(answersMap).slice(0, 3)
        });

        // Calculate per-ticket stats
        if (!ticket || ticket.length === 0) {
          console.log("[PlayPage] ⚠️ No tickets for per-ticket stats");
          return;
        }

        const ticketStatsMap: Record<string, any> = {};
        
        ticket.forEach(t => {
          // CRITICAL: Match by ticket serial_number (not id!)
          const ticketAnswers = answers.filter(a => a.ticket_id === t.serial_number);
          const tCorrect = ticketAnswers.filter(a => a.is_correct).length;
          const tIncorrect = ticketAnswers.filter(a => !a.is_correct).length;
          const tTotal = tCorrect + tIncorrect;
          
          ticketStatsMap[t.serial_number] = {
            answered: tTotal,
            correct: tCorrect,
            incorrect: tIncorrect,
            accuracy: tTotal > 0 ? Math.round((tCorrect / tTotal) * 100) : 0
          };
        });

        setTicketStats(ticketStatsMap);
        
        console.log("[PlayPage] ✅ Per-ticket stats calculated:", {
          ticketCount: ticket.length,
          stats: ticketStatsMap
        });

      } catch (error) {
        console.error("[PlayPage] ❌ Stats loading exception:", error);
      }
    };

    loadPlayerStats();
  }, [event, isPreview, playerSession, ticket]);

  // Subscribe to events table for real-time question updates
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

            // Only increment drawnCount if this is a NEW question (not same as current)
            const isNewQuestion = !currentQuestion || currentQuestion.question_number !== questionNumber;

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

              // Only increment drawnCount for NEW questions
              if (isNewQuestion) {
                setDrawnCount(prev => {
                  const newCount = prev + 1;
                  console.log("[PlayPage] 📊 Drawn count incremented:", newCount);
                  return newCount;
                });
              }

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
  }, [event, isPreview, currentQuestion]);

  // Subscribe to event_questions table for accurate drawn count tracking
  useEffect(() => {
    if (!event || !isPreview) return;

    console.log("[PlayPage] 📡 Subscribing to event_questions for drawn count");

    const channel = supabase
      .channel(`event_questions_drawn:${event.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "event_questions",
          filter: `event_id=eq.${event.id}`
        },
        async (payload) => {
          const updated = payload.new as any;
          
          // Only count if question was just marked as drawn
          if (updated.drawn && !payload.old?.drawn) {
            console.log("[PlayPage] 📊 New question drawn:", updated.question_number);
            
            // Refetch accurate count from DB
            const { count, error } = await supabase
              .from("event_questions")
              .select("*", { count: "exact", head: true })
              .eq("event_id", event.id)
              .eq("drawn", true);
            
            if (!error && count !== null) {
              console.log("[PlayPage] ✅ Drawn count synced from DB:", count);
              setDrawnCount(count);
            }
          }
        }
      )
      .subscribe((status) => {
        console.log("[PlayPage] event_questions subscription status:", status);
      });

    return () => {
      console.log("[PlayPage] 🔌 Unsubscribing from event_questions");
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
              console.log("[PlayPage] ✅ Question details loaded:", eventQuestion);
              setCurrentQuestion(eventQuestion as EventQuestion);
              setLastUpdateTime(Date.now());
              
              // Refetch accurate drawn count from DB
              const { count, error: countError } = await supabase
                .from("event_questions")
                .select("*", { count: "exact", head: true })
                .eq("event_id", event.id)
                .eq("drawn", true);
              
              if (!countError && count !== null) {
                console.log("[PlayPage] ✅ Drawn count synced:", count);
                setDrawnCount(count);
              }

              // Calculate time remaining
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
    console.log("[PlayPage] 🔍 SUBMIT START:", {
      isPreview,
      hasCurrentQuestion: !!currentQuestion,
      hasEvent: !!event,
      answerValue: answerYesNo ? "DA" : "NE",
      questionNumber: currentQuestion?.question_number,
      correctAnswer: currentQuestion?.questions?.correct_answer
    });

    if (!currentQuestion || !event) {
      console.log("[PlayPage] ❌ Missing required data");
      return;
    }

    // Variable to hold the resolved player ID
    let activePlayerId: string | undefined;

    if (isPreview) {
      console.log("[PlayPage] 🎭 Preview mode - validating session...");
      
      // CRITICAL: Re-read session from localStorage to ensure fresh data
      const session = getPreviewPlayerSession();
      
      console.log("[PlayPage] 🔍 Session validation:", {
        sessionExists: !!session,
        hasPlayerId: !!session?.playerId,
        playerIdValue: session?.playerId?.slice(0, 8) || "N/A",
        playerIdType: typeof session?.playerId,
        hasNickname: !!session?.nickname,
        hasEmail: !!session?.email,
        hasTicketIds: !!session?.ticketIds && session.ticketIds.length > 0
      });

      // CRITICAL: Validate playerId is valid UUID, not "N/A" string
      if (!session || !session.playerId || session.playerId === "N/A" || typeof session.playerId !== "string" || session.playerId.length < 36) {
        console.log("[PlayPage] ❌ Invalid session - playerId is not valid UUID:", session?.playerId);
        toast({
          title: "Greška",
          description: "Session nije ispravan. Molimo registrirajte se ponovo.",
          variant: "destructive"
        });
        setShowRegistration(true);
        return;
      }
      
      // Capture valid playerId for use in try/catch block
      activePlayerId = session.playerId;

      console.log("[PlayPage] ✅ Session validated - playerId is valid UUID");

      if (!ticket || ticket.length === 0) {
        console.log("[PlayPage] ❌ No tickets available");
        toast({
          title: "Greška",
          description: "Nema tiketa. Registriraj se ponovo.",
          variant: "destructive"
        });
        return;
      }

      console.log("[PlayPage] ✅ Tickets validated:", {
        ticketCount: ticket.length,
        firstTicketId: ticket[0].id?.slice(0, 8),
        firstTicketSerial: ticket[0].serial_number?.slice(-4)
      });
    } else {
      // Production guard
      console.log("[PlayPage] 🌐 Production mode - checking auth...");
      
      if (!email || !nickname) {
        console.log("[PlayPage] ❌ Not authenticated");
        toast({
          title: "Greška",
          description: "Molimo prijavite se prvo.",
          variant: "destructive"
        });
        return;
      }
    }

    // Disable buttons immediately
    setSubmittingAnswer(true);

    try {
      console.log("[PlayPage] 📤 Getting/creating DB session...");
      
      // CRITICAL: Use activePlayerId (if available) and event.id to get/create session
      const dbSession = await answerService.getOrCreateSession(activePlayerId, event.id);
      
      console.log("[PlayPage] ✅ DB Session obtained:", {
        sessionId: dbSession.id?.slice(0, 8),
        eventId: dbSession.event_id?.slice(0, 8)
      });

      const firstTicket = ticket[0];
      
      console.log("[PlayPage] 📤 Submitting answer to player_answers table:", {
        sessionId: dbSession.id.slice(0, 8),
        eventId: event.id.slice(0, 8),
        questionNumber: currentQuestion.question_number,
        answerYesNo: answerYesNo ? "YES" : "NO",
        ticketSerial: firstTicket.serial_number?.slice(-4),
        ticketId: firstTicket.id?.slice(0, 8)
      });

      // CRITICAL: answerService.submitAnswer() writes to player_answers table
      // with UPSERT (conflict on event_id, ticket_id, question_number)
      const result = await answerService.submitAnswer(
        dbSession.id,           // session_id (UUID)
        event.id,              // event_id (UUID)
        currentQuestion.question_number, // question_number (integer)
        answerYesNo ? "YES" : "NO",     // answer_yesno ('YES' or 'NO')
        firstTicket.serial_number       // ticket_id (text - serial number)
      );

      console.log("[PlayPage] ✅ Answer submitted successfully to player_answers:", {
        answerId: result.id?.slice(0, 8),
        isCorrect: result.is_correct,
        answerYesNo: result.answer_yesno
      });

      // Calculate correctness locally for immediate UI update
      const isCorrect = (answerYesNo ? "YES" : "NO") === 
        (currentQuestion.questions?.correct_answer ? "YES" : "NO");

      console.log("[PlayPage] 🎯 Correctness check:", {
        userAnswer: answerYesNo ? "YES" : "NO",
        correctAnswer: currentQuestion.questions?.correct_answer ? "YES" : "NO",
        isCorrect,
        dbIsCorrect: result.is_correct
      });

      // CRITICAL: Update playerAnswers map for immediate coloring
      // true = green (correct), false = red (incorrect)
      setPlayerAnswers(prev => ({
        ...prev,
        [currentQuestion.question_number]: isCorrect
      }));

      console.log("[PlayPage] ✅ Player answers map updated for question:", currentQuestion.question_number);

      // Update global stats immediately (optimistic)
      setGlobalStats(prev => {
        const newStats = {
          answered: prev.answered + 1,
          correct: prev.correct + (isCorrect ? 1 : 0),
          incorrect: prev.incorrect + (!isCorrect ? 1 : 0),
          accuracy: Math.round(
            ((prev.correct + (isCorrect ? 1 : 0)) / (prev.answered + 1)) * 100
          )
        };
        
        console.log("[PlayPage] ✅ Global stats updated:", newStats);
        return newStats;
      });

      // Show toast notification
      toast({
        title: isCorrect ? "Točno!" : "Netočno",
        description: isCorrect ? "Odlično! ✓" : "Pokušaj ponovo kod idućeg pitanja.",
        variant: isCorrect ? "default" : "destructive"
      });

      console.log("[PlayPage] ✅ SUBMIT COMPLETE - answer saved to player_answers table");

    } catch (error: any) {
      console.error("[PlayPage] ❌ Submit error:", {
        errorMessage: error.message,
        errorCode: error.code,
        errorDetails: error.details,
        errorHint: error.hint
      });
      
      // Show actual error message from Supabase (not generic "register")
      toast({
        title: "Greška pri slanju odgovora",
        description: error.message || "Molimo pokušajte ponovo.",
        variant: "destructive"
      });
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
            console.log("[PlayPage] 🎉 Registration successful!");
            console.log("[PlayPage] Registration result:", {
              hasPlayerId: !!result.player_id,
              playerIdType: typeof result.player_id,
              playerIdValue: result.player_id ? String(result.player_id).slice(0, 8) + "..." : "MISSING",
              nickname: result.nickname,
              email: result.email,
              ticketCount: result.tickets?.length || 0
            });
            
            // Ensure player_id is a string
            const playerId = typeof result.player_id === "string" 
              ? result.player_id 
              : result.player_id?.id || result.player_id?.toString() || "";
            
            console.log("[PlayPage] 🔍 Processed playerId:", {
              original: result.player_id,
              processed: playerId ? playerId.slice(0, 8) + "..." : "EMPTY"
            });
            
            if (!playerId) {
              console.error("[PlayPage] ❌ CRITICAL: No playerId in registration result!");
              toast({
                title: "Greška",
                description: "Registracija neuspješna - nedostaje player ID",
                variant: "destructive"
              });
              return;
            }
            
            const session: Omit<PreviewPlayerSession, "timestamp"> = {
              eventId: event?.id || "",
              playerId: playerId,
              nickname: result.nickname,
              email: result.email,
              ticketIds: result.tickets.map((t: any) => t.id)
            };
            
            console.log("[PlayPage] 💾 Saving session:", {
              eventId: session.eventId.slice(0, 8) + "...",
              playerId: session.playerId.slice(0, 8) + "...",
              nickname: session.nickname,
              ticketCount: session.ticketIds.length
            });
            
            setPreviewPlayerSession(session);
            const fullSession = { ...session, timestamp: Date.now() };
            setPlayerSession(fullSession);
            
            console.log("[PlayPage] ✅ Session saved and state updated");
            
            setNickname(result.nickname);
            setTicket(result.tickets);
            setShowRegistration(false);
            setShowOnboarding(false);
            
            console.log("[PlayPage] ✅ Registration flow complete");
            
            toast({ 
              title: "Dobrodošli!", 
              description: "Sretno u igri!" 
            });
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
          <span className="inline-block mx-2">
            <strong>PREVIEW MODE</strong>
          </span>
          <span className="inline-block mx-2">
            Player: {playerSession?.nickname || "N/A"}
          </span>
          <span className="inline-block mx-2">
            ID: {playerSession?.playerId ? playerSession.playerId.slice(0, 8) + "..." : "N/A"}
          </span>
          <span className="inline-block mx-2">
            Event: {event.id.slice(0, 8)}...
          </span>
          <span className="inline-block mx-2">
            Q: {currentQuestion?.question_number || 0}/90
          </span>
          <span className="inline-block mx-2">
            Drawn: {drawnCount}
          </span>
          <span className="inline-block mx-2">
            Tickets: {ticket?.length || 0}
          </span>
          <span className="inline-block mx-2">
            RT: {realtimeConnected ? "✓" : "✗"}
          </span>
          <span className="inline-block mx-2">
            LastQ: {currentQuestion?.question_id?.slice(0, 8) || "none"}
          </span>
          <span className="inline-block mx-2">
            Updated: {new Date(lastUpdateTime).toLocaleTimeString()}
          </span>
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

          {/* Global Stats */}
          {event && (
            <div className="mt-4 flex items-center gap-4 text-sm border-t border-white/20 pt-2">
              <div className="font-mono">Pitanje: <b>{drawnCount}/90</b></div>
              <div className="font-mono">T: <b className="text-green-300">{globalStats.correct}</b></div>
              <div className="font-mono">N: <b className="text-red-300">{globalStats.incorrect}</b></div>
              <div className="font-mono">%: <b>{globalStats.accuracy}%</b></div>
            </div>
          )}
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