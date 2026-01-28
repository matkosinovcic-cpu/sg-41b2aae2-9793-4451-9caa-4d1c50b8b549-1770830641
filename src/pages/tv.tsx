import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { eventService, Event, EventQuestion } from "@/services/eventService";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gamepad2, Trophy, Clock } from "lucide-react";

export default function TVScreen() {
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [event, setEvent] = useState<Event | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [drawnNumbers, setDrawnNumbers] = useState<Set<number>>(new Set());
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [pollingActive, setPollingActive] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastDrawnNumberRef = useRef<number | null>(null);

  useEffect(() => {
    loadEvents();
    
    // Initialize AudioContext with error handling
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (error) {
      console.warn("[TV] AudioContext initialization failed:", error);
    }
    
    // Load from localStorage
    const storedEventId = localStorage.getItem("tv_event_id");
    if (storedEventId) {
      console.log("[TV] Auto-selecting stored event:", storedEventId);
      setSelectedEventId(storedEventId);
    }
  }, []);

  // Save selected event to localStorage
  useEffect(() => {
    if (selectedEventId) {
      localStorage.setItem("tv_event_id", selectedEventId);
    }
  }, [selectedEventId]);

  // Real-time subscriptions
  useEffect(() => {
    if (!selectedEventId) {
      return;
    }

    console.log("[TV] Setting up subscription for event:", selectedEventId);

    // Initial load
    loadEventData();

    // Subscribe to event changes
    const eventSubscription = eventService.subscribeToEvent(selectedEventId, async (payload) => {
      console.log("[TV] Real-time event update received:", payload);
      const updatedEvent = payload.new;
      
      // Check if drawn number changed
      const numberChanged = updatedEvent.current_drawn_number !== lastDrawnNumberRef.current;
      
      if (numberChanged && updatedEvent.current_drawn_number) {
        console.log(`[TV] Number changed from ${lastDrawnNumberRef.current} to ${updatedEvent.current_drawn_number}`);
        playBeep('start');
        lastDrawnNumberRef.current = updatedEvent.current_drawn_number;
        await loadCurrentQuestion(updatedEvent.id, updatedEvent.current_drawn_number);
        
        // Update drawn numbers set
        setDrawnNumbers(new Set(updatedEvent.drawn_numbers || []));
      }
      
      setEvent(updatedEvent);
    });

    console.log("[TV] Subscription active");

    return () => {
      console.log("[TV] Cleaning up subscription");
      eventSubscription.unsubscribe();
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

  // Safari-safe fallback: Polling mechanism (every 1.5s)
  useEffect(() => {
    if (!selectedEventId || !event || event.status !== "active") {
      setPollingActive(false);
      return;
    }

    console.log("[TV-POLL] Starting polling for event:", selectedEventId);
    setPollingActive(true);

    const pollInterval = setInterval(async () => {
      try {
        console.log("[TV-POLL] Fetching event state...");
        const updatedEvent = await eventService.getEvent(selectedEventId);
        
        // Check if drawn number changed
        const numberChanged = updatedEvent.current_drawn_number !== event.current_drawn_number;
        
        if (numberChanged && updatedEvent.current_drawn_number) {
          console.log(`[TV-POLL] ✅ Number changed: ${event.current_drawn_number} → ${updatedEvent.current_drawn_number}`);
          
          // Play sound for number change
          playBeep('start');
          
          // Update ref and load new question
          lastDrawnNumberRef.current = updatedEvent.current_drawn_number;
          await loadCurrentQuestion(updatedEvent.id, updatedEvent.current_drawn_number);
          
          // Update drawn numbers set
          setDrawnNumbers(new Set(updatedEvent.drawn_numbers || []));
        }

        // Update event state
        setEvent(updatedEvent);

        // Stop polling if event ended
        if (updatedEvent.status !== "active") {
          console.log("[TV-POLL] Event ended, stopping polling");
          setPollingActive(false);
        }
      } catch (error) {
        console.error("[TV-POLL] Polling error:", error);
      }
    }, 1500);

    return () => {
      console.log("[TV-POLL] Cleaning up polling");
      clearInterval(pollInterval);
      setPollingActive(false);
    };
  }, [selectedEventId, event?.id, event?.status, event?.current_drawn_number]);

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
      console.warn("[TV] loadEventData called without selectedEventId");
      return;
    }

    try {
      setLoadingError(null);
      console.log("[TV] 🔍 Step 1: Starting loadEventData for:", selectedEventId);
      
      const data = await eventService.getEvent(selectedEventId);
      console.log("[TV] ✅ Step 2: Event fetched successfully:", data);
      
      if (!data) {
        throw new Error("Event not found");
      }

      console.log("[TV] ✅ Step 3: Event name:", data.name);
      console.log("[TV] ✅ Step 4: Event status:", data.status);
      console.log("[TV] ✅ Step 5: Drawn numbers:", data.drawn_numbers?.length || 0);
      
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
      setLoadingError("Failed to load event data. Please try selecting another event.");
      setEvent(null);
    }
  };

  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      console.log(`[TV] 🔍 loadCurrentQuestion: Loading question #${questionNumber} for event ${eventId}`);
      const data = await eventService.getEventQuestion(eventId, questionNumber);
      console.log("[TV] ✅ loadCurrentQuestion: Question loaded:", data);
      setCurrentQuestion(data);
    } catch (error) {
      console.error("[TV] ❌ loadCurrentQuestion: Failed to load question:", error);
      console.error("[TV] ❌ loadCurrentQuestion: Details:", {
        message: error instanceof Error ? error.message : String(error),
        eventId,
        questionNumber,
      });
      setCurrentQuestion(null);
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

  // Error state
  if (loadingError) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-red-500">
          <CardContent className="pt-6">
            <h1 className="text-2xl font-bold mb-4 text-center text-red-500">Error</h1>
            <p className="text-center mb-4">{loadingError}</p>
            <button 
              onClick={() => window.location.reload()} 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
            >
              Reload Page
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Event selection screen
  if (!selectedEventId) {
    return (
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
    );
  }

  // Loading state
  if (!event) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-2xl">Loading event...</div>
      </div>
    );
  }

  return (
    <>
      <SEO title="TV Display - Pitalica Skitalica" />
      <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 p-8">
        <div className="container mx-auto max-w-7xl">
          
          {/* WINNER SCREEN - Show when winner exists AND game is finished */}
          {event.winner_ticket_id && event.status === "finished" && (
            <div className="fixed inset-0 bg-gradient-to-br from-yellow-400 via-orange-500 to-red-500 flex items-center justify-center z-50 animate-pulse">
              <div className="text-center">
                <Trophy className="w-48 h-48 text-white mx-auto mb-8 animate-bounce" />
                <h1 className="text-9xl font-black text-white mb-6 drop-shadow-2xl">
                  POBJEDNIK!
                </h1>
                <div className="bg-white/20 backdrop-blur-sm rounded-3xl p-12 border-8 border-white">
                  <p className="text-6xl font-black text-white mb-4">Ulaznica:</p>
                  <p className="text-8xl font-black text-white">
                    {event.winner_ticket_id}
                  </p>
                </div>
                <p className="text-4xl text-white mt-12 font-bold">
                  🎉 Čestitamo! 🎉
                </p>
              </div>
            </div>
          )}

          {/* WINNER BANNER - Show during continue mode (Active + Winner exists) */}
          {event.winner_ticket_id && event.status === "active" && (
            <Card className="mb-6 border-4 border-yellow-500 bg-yellow-50">
              <CardContent className="pt-6">
                <div className="flex items-center justify-center gap-4">
                  <Trophy className="w-12 h-12 text-yellow-600" />
                  <div className="text-center">
                    <p className="text-4xl font-black text-yellow-600">POBJEDNIK: {event.winner_ticket_id}</p>
                    <p className="text-xl text-yellow-700">Igra se nastavlja za zabavu...</p>
                  </div>
                  <Trophy className="w-12 h-12 text-yellow-600" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Background Elements */}
          <div className="absolute inset-0 bg-gradient-to-br from-purple-900 via-blue-900 to-black opacity-50" />
          
          <div className="relative z-10 container mx-auto px-4 py-8 h-screen flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-4xl font-bold text-white/80">{event.name}</h1>
              <div className="text-2xl font-mono text-purple-300">
                PITALICA SKITALICA
              </div>
            </div>

            {/* Game Board Display */}
            <div className="flex-1 flex gap-8">
              {/* Left: Current Question */}
              <div className="flex-1 flex flex-col justify-center">
                {currentQuestion ? (
                  <div className="space-y-6">
                    {/* Question Number Circle */}
                    <div className="flex justify-center mb-6">
                      <div className="w-48 h-48 rounded-full bg-purple-600 flex items-center justify-center border-8 border-purple-400 shadow-[0_0_50px_rgba(147,51,234,0.5)]">
                        <span className="text-8xl font-black">{currentQuestion.question_number}</span>
                      </div>
                    </div>

                    {/* Question Text */}
                    <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 border border-white/20">
                      <h2 className="text-5xl font-bold leading-tight text-shadow text-center">
                        {currentQuestion.questions?.text}
                      </h2>
                    </div>

                    {/* Timer */}
                    {timeRemaining > 0 ? (
                      <div className="flex items-center gap-4">
                        <Clock className="w-12 h-12 text-green-400 animate-pulse" />
                        <div className="h-6 flex-1 bg-gray-800 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-green-500 to-green-300 transition-all duration-100 ease-linear"
                            style={{ width: `${(timeRemaining / 10) * 100}%` }}
                          />
                        </div>
                        <span className="text-5xl font-black font-mono text-green-400 min-w-[2ch]">
                          {timeRemaining}
                        </span>
                      </div>
                    ) : currentQuestion ? (
                      <div className="bg-red-500/20 border border-red-500/50 rounded-2xl p-4 text-center">
                        <p className="text-3xl font-bold text-red-400">TIME'S UP</p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  /* Waiting State */
                  <div className="text-center space-y-6">
                    <Gamepad2 className="w-32 h-32 text-purple-500 mx-auto animate-pulse" />
                    <h2 className="text-5xl font-bold text-white/50">
                      Waiting for next number...
                    </h2>
                  </div>
                )}
              </div>

              {/* Right: Full 1-90 Number Board */}
              <div className="w-[500px] flex flex-col">
                <div className="bg-white/5 backdrop-blur-md rounded-2xl p-6 border border-white/20">
                  <h3 className="text-2xl font-bold text-center mb-4 text-purple-300">TOMBOLA BOARD</h3>
                  <div className="grid grid-cols-10 gap-2">
                    {Array.from({ length: 90 }, (_, i) => i + 1).map((num) => {
                      const isDrawn = drawnNumbers.has(num);
                      const isCurrent = event.current_drawn_number === num;
                      
                      return (
                        <div
                          key={num}
                          className={`
                            aspect-square flex items-center justify-center rounded-lg font-bold text-lg
                            transition-all duration-300
                            ${isCurrent 
                              ? 'bg-yellow-400 text-black scale-110 shadow-[0_0_20px_rgba(250,204,21,0.8)] animate-pulse' 
                              : isDrawn 
                                ? 'bg-green-500 text-white shadow-[0_0_10px_rgba(34,197,94,0.5)]' 
                                : 'bg-white/10 text-white/60 hover:bg-white/20'
                          }
                        `}
                        >
                          {num}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 text-center text-sm text-white/40">
                    {drawnNumbers.size} / 90 drawn
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Stats */}
            <div className="mt-8 grid grid-cols-3 gap-8 text-center text-white/40 text-xl font-bold">
              <div>90 Numbers Total</div>
              <div>15 to Win</div>
              <div>Good Luck!</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}