import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { eventService, Event, EventQuestion } from "@/services/eventService";
import { answerService, TicketDetailedResults, TicketStats } from "@/services/answerService";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gamepad2, Trophy, Clock } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface TicketData {
  id: string;
  serial_number: string;
  event_id: string;
  is_winner: boolean;
  ticket_questions: Array<{ question_number: number }>;
}

export default function TVScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [event, setEvent] = useState<Event | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [questionText, setQuestionText] = useState<string | null>(null);
  const [drawnNumbers, setDrawnNumbers] = useState<Set<number>>(new Set());
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [pollingActive, setPollingActive] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastDrawnNumberRef = useRef<number | null>(null);
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [detailedResults, setDetailedResults] = useState<Map<string, TicketDetailedResults>>(new Map());
  const [ticketStats, setTicketStats] = useState<TicketStats[]>([]);
  const [animatedCount, setAnimatedCount] = useState(0);

  useEffect(() => {
    // Initialize AudioContext with error handling
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log("[TV] ✅ AudioContext initialized");
    } catch (error) {
      console.warn("[TV] ⚠️ AudioContext initialization failed:", error);
    }

    // Load available events
    const initializeTV = async () => {
      try {
        console.log("[TV] 🚀 Initializing TV display...");
        await loadEvents();
        console.log("[TV] ✅ Events loaded successfully");
        
        // Priority 1: URL query param
        const urlEventId = router.query.eventId as string;
        
        // Priority 2: localStorage
        const storedEventId = localStorage.getItem("tv_event_id");
        
        const targetEventId = urlEventId || storedEventId;
        
        if (targetEventId) {
          console.log("[TV] 📌 Auto-selecting event:", targetEventId, "from", urlEventId ? "URL" : "localStorage");
          
          // Validate event exists before selecting
          const eventExists = await validateEventExists(targetEventId);
          if (eventExists) {
            setSelectedEventId(targetEventId);
          } else {
            console.warn("[TV] ⚠️ Event", targetEventId, "no longer exists, clearing and showing selection");
            localStorage.removeItem("tv_event_id");
            setSelectedEventId("");
          }
        } else {
          console.log("[TV] ℹ️ No stored event, user must select");
        }
      } catch (error) {
        console.error("[TV] ❌ Initialization failed:", error);
        setLoadingError("Failed to initialize TV display. Please refresh the page.");
      }
    };

    initializeTV();
  }, [router.query.eventId]);

  // Validate event exists in database
  const validateEventExists = async (eventId: string): Promise<boolean> => {
    try {
      const event = await eventService.getEvent(eventId);
      return !!event;
    } catch (error) {
      console.error("[TV] Event validation failed:", error);
      return false;
    }
  };

  // Save selected event to localStorage and URL
  useEffect(() => {
    if (selectedEventId) {
      localStorage.setItem("tv_event_id", selectedEventId);
      // Update URL without reload
      router.replace({ pathname: "/tv", query: { eventId: selectedEventId } }, undefined, { shallow: true });
    }
  }, [selectedEventId]);

  // Real-time subscriptions
  useEffect(() => {
    if (!selectedEventId) {
      return;
    }

    console.log("[TV] Setting up subscription for event:", selectedEventId);

    // Define async initialization function
    const initializeEventView = async () => {
      try {
        // Initial load - MUST complete before subscription
        await loadEventData();
        console.log("[TV] ✅ Initial data loaded, subscription will handle updates");
      } catch (error) {
        console.error("[TV] ❌ Failed to initialize event view:", error);
        // Error already handled by loadEventData
      }
    };

    // Start initialization
    initializeEventView();

    // Subscribe to event changes
    const eventSubscription = eventService.subscribeToEvent(selectedEventId, async (payload) => {
      console.log("[TV] Real-time event update received:", payload);
      const updatedEvent = payload.new;
      
      // ✅ CRITICAL: Always update drawn numbers set from event
      console.log("[TV] Updating drawn numbers:", updatedEvent.drawn_numbers?.length || 0);
      setDrawnNumbers(new Set(updatedEvent.drawn_numbers || []));
      
      // ✅ CRITICAL: Log winner detection
      if (updatedEvent.winner_ticket_id) {
        console.log("[TV] 🏆 WINNER DETECTED:", updatedEvent.winner_ticket_id);
      }
      
      // ✅ CRITICAL: Log status changes
      if (updatedEvent.status !== event?.status) {
        console.log("[TV] 📊 Status changed:", event?.status, "→", updatedEvent.status);
      }
      
      // Check if drawn number changed
      const numberChanged = updatedEvent.current_drawn_number !== lastDrawnNumberRef.current;
      
      if (numberChanged && updatedEvent.current_drawn_number) {
        console.log(`[TV] Number changed from ${lastDrawnNumberRef.current} to ${updatedEvent.current_drawn_number}`);
        playBeep('start');
        lastDrawnNumberRef.current = updatedEvent.current_drawn_number;
        await loadCurrentQuestion(updatedEvent.id, updatedEvent.current_drawn_number);
      }
      
      // ✅ CRITICAL: Always update event state
      setEvent(updatedEvent);
      console.log("[TV] Event state updated:", {
        status: updatedEvent.status,
        current_number: updatedEvent.current_drawn_number,
        drawn_count: updatedEvent.drawn_numbers?.length || 0,
        winner: updatedEvent.winner_ticket_id || "none"
      });
    });

    // Subscribe to tickets changes
    const ticketsSubscription = eventService.subscribeToTickets(selectedEventId, async (payload) => {
      console.log("[TV] Real-time tickets update received:", payload);
      const updatedTickets = payload.new;
      
      // ✅ CRITICAL: Always update tickets state
      setTickets(updatedTickets);
      console.log("[TV] Tickets state updated:", {
        count: updatedTickets.length,
        winners: updatedTickets.filter(t => t.is_winner).length
      });
    });

    console.log("[TV] Subscription active");

    return () => {
      console.log("[TV] Cleaning up subscription");
      eventSubscription.unsubscribe();
      ticketsSubscription.unsubscribe();
    };
  }, [selectedEventId]);

  // Timer countdown with sound effects
  useEffect(() => {
    if (!event?.question_open_until) {
      setTimeRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const deadline = new Date(event.question_open_until!).getTime();
      const remaining = Math.max(0, Math.floor((deadline - now) / 1000));
      
      // Play tick sound for last 3 seconds
      if (remaining <= 3 && remaining > 0 && remaining !== timeRemaining) {
        playBeep('tick');
      }
      
      if (remaining === 0 && timeRemaining > 0) {
        playBeep('end');
      }

      setTimeRemaining(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [event?.question_open_until, timeRemaining]);

  // Safari-safe fallback: Polling mechanism (every 2s for stability)
  useEffect(() => {
    if (!selectedEventId || !event) {
      setPollingActive(false);
      return;
    }

    // ✅ Stop polling if event is FINISHED
    if (event.status === "finished") {
      console.log("[TV-POLL] Event FINISHED, polling disabled");
      setPollingActive(false);
      return;
    }

    // ✅ Only poll ACTIVE events
    if (event.status !== "active") {
      console.log("[TV-POLL] Event not ACTIVE, polling disabled");
      setPollingActive(false);
      return;
    }

    console.log("[TV-POLL] Starting polling for ACTIVE event:", selectedEventId);
    setPollingActive(true);

    const pollInterval = setInterval(async () => {
      try {
        console.log("[TV-POLL] Fetching event state...");
        const updatedEvent = await eventService.getEvent(selectedEventId);
        
        if (!updatedEvent) {
          console.warn("[TV-POLL] Event not found, stopping polling");
          setPollingActive(false);
          clearInterval(pollInterval);
          return;
        }
        
        // ✅ Stop polling if event became FINISHED
        if (updatedEvent.status === "finished") {
          console.log("[TV-POLL] Event became FINISHED, stopping polling");
          setPollingActive(false);
          clearInterval(pollInterval);
        }
        
        // ✅ CRITICAL: Always update drawn numbers (fixes refresh bug)
        console.log("[TV-POLL] Updating drawn numbers:", updatedEvent.drawn_numbers?.length || 0);
        setDrawnNumbers(new Set(updatedEvent.drawn_numbers || []));
        
        // Check if drawn number changed
        const numberChanged = updatedEvent.current_drawn_number !== event.current_drawn_number;
        
        if (numberChanged && updatedEvent.current_drawn_number) {
          console.log(`[TV-POLL] ✅ Number changed: ${event.current_drawn_number} → ${updatedEvent.current_drawn_number}`);
          playBeep('start');
          lastDrawnNumberRef.current = updatedEvent.current_drawn_number;
          await loadCurrentQuestion(updatedEvent.id, updatedEvent.current_drawn_number);
        }

        // ✅ CRITICAL: Always update event state
        setEvent(updatedEvent);
        console.log("[TV-POLL] Event refreshed:", {
          status: updatedEvent.status,
          current_number: updatedEvent.current_drawn_number,
          drawn_count: updatedEvent.drawn_numbers?.length || 0
        });
        
      } catch (error) {
        console.error("[TV-POLL] Polling error:", error);
      }
    }, 2000); // ✅ 2s interval for stability

    return () => {
      console.log("[TV-POLL] Cleaning up polling");
      clearInterval(pollInterval);
      setPollingActive(false);
    };
  }, [selectedEventId, event?.id, event?.status, event?.current_drawn_number]);

  // Load statistics when event finishes
  useEffect(() => {
    if (event?.status === "finished") {
      loadStats();
    }
  }, [event?.status]);

  // Load tickets when event finishes
  useEffect(() => {
    if (event?.status === "finished") {
      loadTickets();
    }
  }, [event?.status]);

  // Counter animation for winner count
  useEffect(() => {
    if (event?.status === "finished" && tickets.length > 0) {
      const actualCount = tickets.filter(t => t.is_winner).length;
      
      if (animatedCount < actualCount) {
        const timer = setTimeout(() => {
          setAnimatedCount(prev => prev + 1);
        }, 100); // Increment every 100ms
        return () => clearTimeout(timer);
      }
    } else {
      setAnimatedCount(0);
    }
  }, [event?.status, tickets, animatedCount]);

  // Audio effect for winner count
  useEffect(() => {
    if (!event || event.status !== "finished") return;
    
    const actualCount = tickets.filter(t => t.is_winner).length;
    
    // Play tick for each increment (except 0)
    if (animatedCount > 0 && animatedCount < actualCount) {
      playWinnerTick();
    } 
    // Play fanfare on completion
    else if (animatedCount > 0 && animatedCount === actualCount) {
      playWinnerFanfare();
    }
  }, [animatedCount, event?.status, tickets]);

  // Reset animatedCount when status changes from finished
  useEffect(() => {
    if (event?.status !== "finished") {
      setAnimatedCount(0);
    }
  }, [event?.status]);

  const loadStats = async () => {
    if (!event || tickets.length === 0) return;
    
    try {
      const statsData = await answerService.getEventTicketStats(event.id);
      setTicketStats(statsData);
      console.log("[TV] ✅ Stats loaded:", statsData.length, "tickets");
    } catch (error) {
      console.error("[TV] Failed to load stats:", error);
      setTicketStats([]);
    }
  };

  const loadEvents = async () => {
    try {
      console.log("[TV] 🔍 loadEvents: Fetching all events...");
      setLoadingError(null);
      const data = await eventService.getEvents();
      console.log("[TV] ✅ loadEvents: Found", data.length, "events");
      setEvents(data);
    } catch (error) {
      console.error("[TV] ❌ loadEvents: Failed to load events:", error);
      console.error("[TV] ❌ loadEvents: Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      setLoadingError("Failed to load events. Please refresh the page.");
    }
  };

  const loadEventData = async () => {
    if (!selectedEventId) {
      console.warn("[TV] ⚠️ loadEventData called without selectedEventId");
      return;
    }

    try {
      setLoadingError(null);
      console.log("[TV] 🔍 Step 1: Starting loadEventData for:", selectedEventId);
      
      // ✅ SAFE: Use getEvent with try-catch instead of assuming .single() succeeds
      const data = await eventService.getEvent(selectedEventId);
      
      if (!data) {
        console.warn("[TV] ⚠️ Event not found:", selectedEventId);
        // Graceful fallback: Clear selection and return to Event Selection
        localStorage.removeItem("tv_event_id");
        setSelectedEventId("");
        setEvent(null);
        return;
      }

      console.log("[TV] ✅ Step 2: Event fetched successfully:", data);
      console.log("[TV] ✅ Step 3: Event name:", data.name);
      console.log("[TV] ✅ Step 4: Event status:", data.status);
      console.log("[TV] ✅ Step 5: Drawn numbers:", data.drawn_numbers?.length || 0);
      
      // ✅ CRITICAL: Respect FINISHED status - stop polling
      if (data.status === "finished") {
        console.log("[TV] 🏁 Event is FINISHED, stopping all polling");
        setPollingActive(false);
      }
      
      setEvent(data);
      lastDrawnNumberRef.current = data.current_drawn_number;
      
      // Load drawn numbers from event
      setDrawnNumbers(new Set(data.drawn_numbers || []));
      console.log("[TV] ✅ Step 6: Drawn numbers set loaded");
      
      // Load current question if one exists
      if (data.current_drawn_number) {
        console.log("[TV] ✅ Step 7: Loading current question #", data.current_drawn_number);
        await loadCurrentQuestion(data.id, data.current_drawn_number);
        console.log("[TV] ✅ Step 8: Current question loaded");
      } else {
        console.log("[TV] ℹ️ Step 7: No current question (waiting for first draw)");
      }
      
      console.log("[TV] 🎉 Event data loaded successfully!");
    } catch (error) {
      console.error("[TV] ❌ FAILED at some step:", error);
      console.error("[TV] ❌ Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        selectedEventId,
      });
      
      // Check if it's a "not found" error
      if (error instanceof Error && (error.message.includes("not found") || error.message.includes("0 rows"))) {
        console.log("[TV] 🔄 Event no longer exists, returning to selection");
        localStorage.removeItem("tv_event_id");
        setSelectedEventId("");
        setEvent(null);
        setLoadingError(null); // Don't show error, just return to selection
      } else {
        setLoadingError(`Failed to load event: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setEvent(null);
      }
    }
  };

  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      console.log(`[TV] 🔍 loadCurrentQuestion: Loading question #${questionNumber} for event ${eventId}`);
      const data = await eventService.getEventQuestion(eventId, questionNumber);
      console.log("[TV] ✅ loadCurrentQuestion: Question loaded:", data);
      setCurrentQuestion(data);

      // Fetch question text if we have a question ID
      if (data?.question_id) {
        const { data: qData, error: qError } = await supabase
          .from("questions")
          .select("text")
          .eq("id", data.question_id)
          .single();

        if (qError) {
          console.error("[TV] ❌ Failed to load question text:", qError);
          setQuestionText(null);
        } else {
          console.log("[TV] ✅ Question text loaded:", qData?.text);
          setQuestionText(qData?.text || null);
        }
      } else {
        setQuestionText(null);
      }
    } catch (error) {
      console.error("[TV] ❌ loadCurrentQuestion: Failed to load question:", error);
      console.error("[TV] ❌ loadCurrentQuestion: Details:", {
        message: error instanceof Error ? error.message : String(error),
        eventId,
        questionNumber,
      });
      setCurrentQuestion(null);
      setQuestionText(null);
    }
  };

  const playBeep = (type: 'start' | 'tick' | 'end') => {
    if (!audioContextRef.current) return;
    
    try {
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (type === 'start') {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1760, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } else if (type === 'tick') {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === 'end') {
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 1);
        osc.start();
        osc.stop(ctx.currentTime + 1);
      }
    } catch (error) {
      console.warn("[TV] Audio playback failed:", error);
    }
  };

  const playWinnerTick = () => {
    if (!audioContextRef.current) return;
    try {
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      // Rising pitch based on count
      const pitch = 600 + (animatedCount * 50); 
      
      osc.frequency.setValueAtTime(pitch, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) { console.error(e); }
  };

  const playWinnerFanfare = () => {
    if (!audioContextRef.current) return;
    try {
      const ctx = audioContextRef.current;
      // C Major Arpeggio: C5, E5, G5, C6
      const notes = [523.25, 659.25, 783.99, 1046.50]; 
      
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.value = freq;
        osc.type = 'triangle';
        
        const startTime = ctx.currentTime + (i * 0.05); // Staggered entry
        
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.1, startTime + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 2);
        
        osc.start(startTime);
        osc.stop(startTime + 2);
      });
    } catch (e) { console.error(e); }
  };

  const loadDetailedResults = async () => {
    if (!event || tickets.length === 0) return;
    
    try {
      const resultsMap = new Map<string, TicketDetailedResults>();
      
      for (const ticket of tickets) {
        const details = await answerService.getTicketDetailedResults(
          ticket.id,
          ticket,
          event.id,
          event.drawn_numbers || []
        );
        resultsMap.set(ticket.serial_number, details);
      }
      
      setDetailedResults(resultsMap);
    } catch (error) {
      console.error("[TV] Failed to load detailed results:", error);
    }
  };

  const shouldShowWinnerScreen = event?.status === "finished" && tickets.filter(t => t.is_winner).length > 0;

  return (
    <>
      <SEO title="TV Display - Pitalica Skitalica" />
      
      {/* Error state */}
      {loadingError ? (
        <div className="min-h-screen bg-black flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl border-red-500 border-2">
            <CardContent className="pt-6">
              <h1 className="text-3xl font-bold mb-4 text-center text-red-500">⚠️ TV Display Error</h1>
              <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
                <p className="text-center text-red-800 font-mono text-sm whitespace-pre-wrap">
                  {loadingError}
                </p>
              </div>
              <div className="space-y-3">
                <button 
                  onClick={() => {
                    setLoadingError(null);
                    setSelectedEventId("");
                    localStorage.removeItem("tv_event_id");
                  }} 
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded font-semibold"
                >
                  ← Back to Event Selection
                </button>
                <button 
                  onClick={() => {
                    setLoadingError(null);
                    if (selectedEventId) {
                      loadEventData();
                    }
                  }} 
                  className="w-full bg-gray-600 hover:bg-gray-700 text-white px-4 py-3 rounded font-semibold"
                >
                  🔄 Retry Loading Event
                </button>
                <button 
                  onClick={() => window.location.reload()} 
                  className="w-full bg-gray-500 hover:bg-gray-600 text-white px-4 py-3 rounded font-semibold"
                >
                  ♻️ Reload Page
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : !selectedEventId ? (
        /* Event selection */
        <div className="min-h-screen bg-black flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6">
              <h1 className="text-2xl font-bold mb-4 text-center">Select Event for TV Display</h1>
              <Select onValueChange={setSelectedEventId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an event" />
                </SelectTrigger>
                <SelectContent>
                  {events.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} ({e.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </div>
      ) : !event ? (
        /* Loading */
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="text-white text-2xl">Loading event...</div>
        </div>
      ) : event.winner_ticket_id || event.status === "finished" ? (
        /* ✅ WINNER SCREEN - TV DISPLAY */
        <div className="fixed inset-0 bg-black overflow-hidden flex items-center justify-center">
          
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-900 via-orange-900 to-red-900" />
          
          {/* 16:9 Container */}
          <div className="relative w-full h-full max-w-[177.78vh] max-h-[56.25vw]">
            
            {/* Content wrapper */}
            <div className="absolute inset-0 flex items-center justify-center p-[5vh]">
              <div className="w-full max-w-[92vw] max-h-[86vh] flex flex-col items-center justify-center text-center gap-[2vh]">
                
                {/* Trophy icon */}
                <div className="animate-bounce">
                  <Trophy className="w-20 h-20 text-yellow-300" />
                </div>
                
                {/* Winner title */}
                <h1 
                  className="text-white font-extrabold tracking-wide text-center leading-tight drop-shadow-2xl animate-pulse"
                  style={{ fontSize: "clamp(40px, 6vw, 84px)" }}
                >
                  IMAMO {(() => {
                    const winnerCount = tickets.filter(t => t.is_winner).length;
                    return winnerCount === 1 ? "POBJEDNIKA" : "POBJEDNIKE";
                  })()}!
                </h1>
                
                {/* Winner display box */}
                <div className="bg-white/10 backdrop-blur-sm rounded-3xl border-4 border-yellow-400 p-[4vh] shadow-2xl">
                  <div 
                    className="font-extrabold text-yellow-400 text-center leading-none"
                    style={{ fontSize: "clamp(52px, 11vw, 160px)" }}
                  >
                    {(() => {
                      const winnerCount = tickets.filter(t => t.is_winner).length;
                      return winnerCount === 1 
                        ? "POBJEDNIK"
                        : `${winnerCount} POBJEDNIKA`;
                    })()}
                  </div>
                </div>
                
                {/* Confetti effect */}
                <div 
                  className="animate-pulse"
                  style={{ fontSize: "clamp(32px, 4.5vw, 56px)" }}
                >
                  🎉 🎊 🏆 🎊 🎉
                </div>
                
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ✅ MAIN TV DISPLAY - NORMAL GAME SCREEN */
        <div className="fixed inset-0 bg-black overflow-hidden flex items-center justify-center">
          
          {/* Background gradient (fills entire screen) */}
          <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-purple-900 to-indigo-900" />
          
          {/* 16:9 Container (constrained, centered, letterboxed if needed) */}
          <div className="relative w-full h-full max-w-[177.78vh] max-h-[56.25vw]">
            
            {/* Content wrapper with padding */}
            <div className="absolute inset-0 flex flex-col p-6">
              
              {/* 1️⃣ HEADER (12% height) */}
              <div className="flex-none h-[12%] flex items-center justify-between px-4">
                {/* Event name - top left corner */}
                <div className="text-lg text-gray-400 font-medium">
                  {event.name}
                </div>
                
                {/* Main title - centered */}
                <h1 className="absolute left-1/2 transform -translate-x-1/2 text-4xl sm:text-5xl lg:text-6xl font-black tracking-normal text-white drop-shadow-2xl whitespace-nowrap">
                  PITALICA SKITALICA
                </h1>
              </div>
              
              {/* 2️⃣ MAIN CONTENT AREA (76% height) - 2 columns */}
              <div className="flex-none h-[76%] grid grid-cols-[58%_38%] gap-[4%] py-4">
                
                {/* LEFT COLUMN: Question Panel (58%) */}
                <div className="bg-white/5 backdrop-blur-sm rounded-3xl border-2 border-white/10 p-6 flex flex-col justify-center shadow-2xl overflow-hidden">
                  
                  {event.current_drawn_number ? (
                    /* Active question state */
                    <div className="text-center space-y-4">
                      <div className="text-lg text-indigo-300 tracking-wide uppercase">
                        Trenutno pitanje
                      </div>
                      <div className="text-8xl font-black text-white drop-shadow-2xl">
                        #{event.current_drawn_number}
                      </div>
                      {timeRemaining > 0 && (
                        <div className="text-5xl font-bold text-yellow-300 animate-pulse">
                          {timeRemaining}s
                        </div>
                      )}
                      {questionText && (
                        <div className="mt-6 bg-white/10 rounded-2xl p-5 backdrop-blur max-h-[40vh] overflow-y-auto">
                          <p className="text-xl text-white leading-relaxed">
                            {questionText}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Waiting state */
                    <div className="text-center">
                      <div className="text-6xl mb-4 animate-pulse">⏳</div>
                      <p className="text-3xl text-gray-300 animate-pulse">
                        Čekam sljedeće pitanje...
                      </p>
                    </div>
                  )}
                  
                </div>
                
                {/* RIGHT COLUMN: Numbers Board (38%) */}
                <div className="bg-white/5 backdrop-blur-sm rounded-3xl border-2 border-white/10 p-4 flex items-center justify-center shadow-2xl overflow-hidden">
                  
                  {/* Board grid - scaled down for better fit */}
                  <div className="grid grid-cols-10 gap-1 w-full h-full max-h-full" style={{ aspectRatio: '10/9' }}>
                    {Array.from({ length: 90 }, (_, i) => i + 1).map((num) => {
                      const isDrawn = drawnNumbers.has(num);
                      const isCurrent = event.current_drawn_number === num;
                      
                      return (
                        <div
                          key={num}
                          className={`
                            aspect-square rounded-md flex items-center justify-center 
                            text-sm font-bold transition-all duration-300
                            ${
                              isCurrent
                                ? "bg-yellow-400 text-gray-900 scale-110 shadow-[0_0_15px_rgba(250,204,21,0.6)] animate-pulse"
                                : isDrawn
                                ? "bg-indigo-500 text-white shadow-[0_0_8px_rgba(99,102,241,0.4)] scale-105"
                                : "bg-gray-800/60 text-gray-400 border border-gray-700/50"
                            }
                          `}
                        >
                          {num}
                        </div>
                      );
                    })}
                  </div>
                  
                </div>
                
              </div>
              
              {/* 3️⃣ FOOTER (12% height) */}
              <div className="flex-none h-[12%] grid grid-cols-3 gap-4 items-center px-8">
                
                <div className="bg-white/5 backdrop-blur-sm rounded-xl p-3 text-center border border-white/10">
                  <div className="text-3xl font-bold text-yellow-300">90</div>
                  <div className="text-sm text-gray-300 mt-1">pitanja</div>
                </div>
                
                <div className="bg-white/5 backdrop-blur-sm rounded-xl p-3 text-center border border-white/10">
                  <div className="text-3xl font-bold text-green-300">15</div>
                  <div className="text-sm text-gray-300 mt-1">za pobjedu</div>
                </div>
                
                <div className="bg-white/5 backdrop-blur-sm rounded-xl p-3 text-center border border-white/10">
                  <div className="text-3xl font-bold text-pink-300">🍀</div>
                  <div className="text-sm text-gray-300 mt-1">Sretno</div>
                </div>
                
              </div>
              
            </div>
          </div>
        </div>
      )}
    </>
  );
}