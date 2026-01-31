import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { eventService, Event, EventQuestion } from "@/services/eventService";
import { answerService, TicketStats } from "@/services/answerService";
import { Card, CardContent } from "@/components/ui/card";
import { Gamepad2, Trophy, Clock } from "lucide-react";
import { RealtimeChannel } from "@supabase/supabase-js";
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
  const eventId = router.query.eventId as string;
  
  const [event, setEvent] = useState<Event | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [questionText, setQuestionText] = useState<string | null>(null);
  const [drawnNumbers, setDrawnNumbers] = useState<Set<number>>(new Set());
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [ticketStats, setTicketStats] = useState<TicketStats[]>([]);
  const [animatedCount, setAnimatedCount] = useState(0);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastDrawnNumberRef = useRef<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Initialize AudioContext
  useEffect(() => {
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log("[TV] ✅ AudioContext initialized");
    } catch (error) {
      console.warn("[TV] ⚠️ AudioContext initialization failed:", error);
    }
  }, []);

  // Fetch initial event state
  useEffect(() => {
    if (!eventId) return;
    
    const fetchEvent = async () => {
      try {
        console.log("[TV] 📥 Fetching initial event state for:", eventId.slice(0, 8));
        const eventData = await eventService.getEvent(eventId);
        
        setEvent(eventData);
        setDrawnNumbers(new Set(eventData.drawn_numbers || []));
        lastDrawnNumberRef.current = eventData.current_drawn_number;
        
        if (eventData.current_drawn_number) {
          await loadCurrentQuestion(eventData.id, eventData.current_drawn_number);
        }
        
        console.log("[TV] ✅ Initial state loaded:", {
          currentNumber: eventData.current_drawn_number,
          drawnCount: eventData.drawn_numbers?.length || 0,
          status: eventData.status
        });
      } catch (error) {
        console.error("[TV] ❌ Failed to fetch initial event:", error);
      }
    };
    
    fetchEvent();
  }, [eventId]);

  // Realtime subscription
  useEffect(() => {
    if (!eventId) return;
    
    console.log("[TV] 📡 Setting up realtime subscription for event:", eventId.slice(0, 8));
    
    const channel = supabase
      .channel(`tv-event-${eventId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'events',
        filter: `id=eq.${eventId}`
      }, async (payload) => {
        console.log("[TV] ⚡ Realtime UPDATE received:", payload);
        
        const newEvent = payload.new as Event;
        
        // Update drawn numbers
        const newDrawnNumbers = new Set(newEvent.drawn_numbers || []);
        setDrawnNumbers(newDrawnNumbers);
        
        // Check if current number changed
        if (newEvent.current_drawn_number !== lastDrawnNumberRef.current) {
          console.log("[TV] 🔔 Current number changed:", lastDrawnNumberRef.current, "→", newEvent.current_drawn_number);
          
          playBeep('start');
          lastDrawnNumberRef.current = newEvent.current_drawn_number;
          
          if (newEvent.current_drawn_number) {
            await loadCurrentQuestion(newEvent.id, newEvent.current_drawn_number);
          }
        }
        
        // Update event state
        setEvent(newEvent);
        
        console.log("[TV] ✅ State updated:", {
          currentNumber: newEvent.current_drawn_number,
          drawnCount: newEvent.drawn_numbers?.length || 0,
          status: newEvent.status
        });
      })
      .subscribe((status) => {
        console.log("[TV] 📡 Subscription status:", status);
      });
    
    channelRef.current = channel;
    
    return () => {
      console.log("[TV] 🧹 Cleaning up realtime subscription");
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [eventId]);

  // Timer countdown
  useEffect(() => {
    if (!event?.question_open_until) {
      setTimeRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const deadline = new Date(event.question_open_until!).getTime();
      const remaining = Math.max(0, Math.floor((deadline - now) / 1000));
      
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

  // Load statistics when event finishes
  useEffect(() => {
    if (event?.status === "finished") {
      loadStats();
    }
    if (event) {
      loadTickets();
    }
  }, [event?.status, event?.id]);

  // Reset animation when status changes
  useEffect(() => {
    if (event?.status !== "finished") {
      setAnimatedCount(0);
    }
  }, [event?.status]);

  // Counter animation for winners
  useEffect(() => {
    if (event?.status === "finished" && tickets.length > 0) {
      const actualCount = tickets.filter(t => t.is_winner).length;
      
      if (animatedCount < actualCount) {
        const timer = setTimeout(() => {
          setAnimatedCount(prev => prev + 1);
        }, 100);
        return () => clearTimeout(timer);
      }
    } else {
      setAnimatedCount(0);
    }
  }, [event?.status, tickets, animatedCount]);

  // Audio effects
  useEffect(() => {
    if (!event || event.status !== "finished") return;
    
    const actualCount = tickets.filter(t => t.is_winner).length;
    
    if (animatedCount > 0 && animatedCount < actualCount) {
      playWinnerTick();
    } else if (animatedCount > 0 && animatedCount === actualCount) {
      playWinnerFanfare();
    }
  }, [animatedCount, event?.status, tickets]);

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

  const loadTickets = async () => {
    if (!eventId) return;
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select(`
          id,
          serial_number,
          event_id,
          is_winner,
          ticket_questions (
            question_number
          )
        `)
        .eq('event_id', eventId);

      if (error) throw error;
      setTickets(data as any || []);
    } catch (error) {
      console.error("[TV] Failed to load tickets:", error);
    }
  };

  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      console.log(`[TV] 🔍 Loading question #${questionNumber} for event ${eventId.slice(0, 8)}`);
      const data = await eventService.getEventQuestion(eventId, questionNumber);
      console.log("[TV] ✅ Question loaded:", data);
      
      setCurrentQuestion(data);

      if (data?.question_id) {
        const { data: qData, error: qError } = await supabase
          .from("questions")
          .select("text")
          .eq("id", data.question_id)
          .single();

        if (qError) {
          console.error("[TV] ❌ Failed to load question text:", qError);
        } else {
          console.log("[TV] ✅ Question text loaded");
          setQuestionText(qData?.text || null);
        }
      }
    } catch (error) {
      console.error("[TV] ❌ Failed to load question:", error);
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
      const notes = [523.25, 659.25, 783.99, 1046.50];
      
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.value = freq;
        osc.type = 'triangle';
        
        const startTime = ctx.currentTime + (i * 0.05);
        
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.1, startTime + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 2);
        
        osc.start(startTime);
        osc.stop(startTime + 2);
      });
    } catch (e) { console.error(e); }
  };

  // No eventId
  if (!eventId) {
    return (
      <>
        <SEO title="TV Display - Pitalica Skitalica" />
        <div className="min-h-screen bg-black flex items-center justify-center p-4">
          <Card className="w-full max-w-md border-yellow-500 border-2">
            <CardContent className="pt-6 text-center">
              <div className="text-6xl mb-4">⚠️</div>
              <h1 className="text-2xl font-bold mb-2">Missing Event ID</h1>
              <p className="text-gray-600 mb-4">
                Please provide an event ID in the URL:
              </p>
              <code className="bg-gray-100 px-3 py-2 rounded text-sm">
                /tv?eventId=YOUR_EVENT_ID
              </code>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  // Loading
  if (!event) {
    return (
      <>
        <SEO title="TV Display - Pitalica Skitalica" />
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="text-white text-2xl">Loading event...</div>
        </div>
      </>
    );
  }

  // Winner screen
  const shouldShowWinnerScreen = event.status === "finished" && tickets.filter(t => t.is_winner).length > 0;

  if (shouldShowWinnerScreen) {
    return (
      <>
        <SEO title="TV Display - Pitalica Skitalica" />
        <div className="fixed inset-0 bg-black overflow-hidden flex items-center justify-center">
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-900 via-orange-900 to-red-900" />
          <div className="relative w-full h-full max-w-[177.78vh] max-h-[56.25vw]">
            <div className="absolute inset-0 flex items-center justify-center p-[5vh]">
              <div className="w-full max-w-[92vw] max-h-[86vh] flex flex-col items-center justify-center text-center gap-[2vh]">
                <div className="animate-bounce">
                  <Trophy className="w-20 h-20 text-yellow-300" />
                </div>
                <h1 
                  className="text-white font-extrabold tracking-wide text-center leading-tight drop-shadow-2xl animate-pulse"
                  style={{ fontSize: "clamp(40px, 6vw, 84px)" }}
                >
                  IMAMO {(() => {
                    const winnerCount = tickets.filter(t => t.is_winner).length;
                    return winnerCount === 1 ? "POBJEDNIKA" : "POBJEDNIKE";
                  })()}!
                </h1>
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
      </>
    );
  }

  // Game screen
  return (
    <>
      <SEO title="TV Display - Pitalica Skitalica" />
      <div className="fixed inset-0 bg-black overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-purple-900 to-indigo-900" />
        <div className="relative w-full h-full max-w-[177.78vh] max-h-[56.25vw]">
          <div className="absolute inset-0 flex flex-col p-6">
            <div className="flex-none h-[12%] flex items-center justify-between px-4">
              <div className="text-lg text-gray-400 font-medium">
                {event.name}
              </div>
              <h1 className="absolute left-1/2 transform -translate-x-1/2 text-4xl sm:text-5xl lg:text-6xl font-black tracking-normal text-white drop-shadow-2xl whitespace-nowrap">
                PITALICA SKITALICA
              </h1>
            </div>
            
            <div className="flex-none h-[76%] grid grid-cols-[58%_38%] gap-[4%] py-4">
              <div className="bg-white/5 backdrop-blur-sm rounded-3xl border-2 border-white/10 p-6 flex flex-col justify-center shadow-2xl overflow-hidden">
                {event.current_drawn_number ? (
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
                  <div className="text-center">
                    <div className="text-6xl mb-4 animate-pulse">⏳</div>
                    <p className="text-3xl text-gray-300 animate-pulse">
                      Čekam sljedeće pitanje...
                    </p>
                  </div>
                )}
              </div>
              
              <div className="bg-white/5 backdrop-blur-sm rounded-3xl border-2 border-white/10 p-4 flex items-center justify-center shadow-2xl overflow-hidden">
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
    </>
  );
}