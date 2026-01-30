import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/router";
import { eventService, Event, EventQuestion } from "@/services/eventService";
import { answerService, TicketDetailedResults, TicketStats } from "@/services/answerService";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gamepad2, Trophy, Clock } from "lucide-react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useActiveEvent } from "@/hooks/useActiveEvent";

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
  const { event: activeEvent, isLoading: loadingActiveEvent, realtimeStatus } = useActiveEvent();
  const [event, setEvent] = useState<Event | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [questionText, setQuestionText] = useState<string | null>(null);
  const [drawnNumbers, setDrawnNumbers] = useState<Set<number>>(new Set());
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastDrawnNumberRef = useRef<number | null>(null);
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [detailedResults, setDetailedResults] = useState<Map<string, TicketDetailedResults>>(new Map());
  const [ticketStats, setTicketStats] = useState<TicketStats[]>([]);
  const [animatedCount, setAnimatedCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastRealtimeUpdateRef = useRef(Date.now());
  
  // 🛡️ HARD ANTI-FLICKER GUARD - Last good display state
  const lastGoodDisplayRef = useRef<{
    eventId: string;
    number: number;
    questionText: string;
    questionId: string | null;
    drawnNumbers: number[];
    updatedAt: number;
  } | null>(null);

  // 🚀 MOUNT/UNMOUNT TRACKING
  useEffect(() => {
    console.log("[TV] 🚀 COMPONENT MOUNTED");
    return () => console.log("[TV] 💀 COMPONENT UNMOUNTED");
  }, []);

  // 🎯 SYNC WITH ACTIVE EVENT from hook
  useEffect(() => {
    if (loadingActiveEvent) return;
    
    if (activeEvent) {
      console.log("[TV] ✅ Active event from hook:", {
        id: activeEvent.id.slice(0, 8),
        name: activeEvent.name,
        status: activeEvent.status,
        currentNumber: activeEvent.current_drawn_number
      });
      
      // Update local state
      setEvent(activeEvent);
      setDrawnNumbers(new Set(activeEvent.drawn_numbers || []));
      lastDrawnNumberRef.current = activeEvent.current_drawn_number;
      
      // Load current question if exists
      if (activeEvent.current_drawn_number) {
        loadCurrentQuestion(activeEvent.id, activeEvent.current_drawn_number);
      }
    } else {
      console.log("[TV] ℹ️ No active event");
      setEvent(null);
    }
  }, [activeEvent, loadingActiveEvent]);

  // Initialize AudioContext
  useEffect(() => {
    // Initialize AudioContext with error handling
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log("[TV] ✅ AudioContext initialized");
    } catch (error) {
      console.warn("[TV] ⚠️ AudioContext initialization failed:", error);
    }
  }, []);

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

  // Load statistics and tickets when event finishes
  useEffect(() => {
    if (event?.status === "finished") {
      loadStats();
    }
    if (event) {
      loadTickets();
    }
  }, [event?.status, event?.id]);

  // Reset animation when status changes from finished
  useEffect(() => {
    if (event?.status !== "finished") {
      setAnimatedCount(0);
    }
  }, [event?.status]);

  // Counter animation for winner count
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

  // Audio effect for winner count
  useEffect(() => {
    if (!event || event.status !== "finished") return;
    
    const actualCount = tickets.filter(t => t.is_winner).length;
    
    if (animatedCount > 0 && animatedCount < actualCount) {
      playWinnerTick();
    } 
    else if (animatedCount > 0 && animatedCount === actualCount) {
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
    if (!selectedEventId) return;
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
        .eq('event_id', selectedEventId);

      if (error) throw error;
      setTickets(data as any || []);
    } catch (error) {
      console.error("[TV] Failed to load tickets:", error);
    }
  };

  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      console.log(`[TV] 🔍 loadCurrentQuestion: Loading question #${questionNumber} for event ${eventId}`);
      const data = await eventService.getEventQuestion(eventId, questionNumber);
      console.log("[TV] ✅ loadCurrentQuestion: Question loaded:", data);
      
      console.log('[TV-STATE] setCurrentQuestion', {
        questionNumber,
        questionId: data?.question_id?.slice(0, 8),
        ts: Date.now()
      });
      setCurrentQuestion(data);

      if (data?.question_id) {
        const { data: qData, error: qError } = await supabase
          .from("questions")
          .select("text")
          .eq("id", data.question_id)
          .single();

        if (qError) {
          console.error("[TV] ❌ Failed to load question text:", qError);
          // 🛡️ DON'T CLEAR - Keep old question visible
        } else {
          console.log("[TV] ✅ Question text loaded:", qData?.text);
          console.log('[TV-STATE] setQuestionText', {
            text: qData?.text?.slice(0, 50) + '...',
            ts: Date.now()
          });
          setQuestionText(qData?.text || null);
          
          // 🛡️ UPDATE LAST GOOD DISPLAY
          if (event && questionNumber) {
            lastGoodDisplayRef.current = {
              eventId: event.id,
              number: questionNumber,
              questionText: qData?.text || '',
              questionId: data.question_id,
              drawnNumbers: event.drawn_numbers || [],
              updatedAt: Date.now()
            };
            console.log('[TV-GUARD] 🛡️ Updated lastGoodDisplay after question load', lastGoodDisplayRef.current);
          }
        }
      }
      // 🛡️ DON'T CLEAR if no question_id - keep old question
    } catch (error) {
      console.error("[TV] ❌ loadCurrentQuestion: Failed to load question:", error);
      // 🛡️ DON'T CLEAR STATE - Keep current display visible
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

  const shouldShowWinnerScreen = useMemo(() => {
    return event?.status === "finished" && tickets.filter(t => t.is_winner).length > 0;
  }, [event?.status, tickets]);

  const showOverlay = useMemo(() => {
    const urlDebug = typeof window !== 'undefined' 
      && new URLSearchParams(window.location.search).get('debug') === '1';
    const envDebug = process.env.NEXT_PUBLIC_TV_DEBUG === '1';
    return urlDebug || envDebug;
  }, []);

  // 🛡️ ANTI-FLICKER DISPLAY VALUES - Use lastGood if current is empty
  const displayNumber = useMemo(() => {
    if (event?.current_drawn_number) return event.current_drawn_number;
    if (lastGoodDisplayRef.current?.number) {
      console.log('[TV-GUARD] 🛡️ Using lastGoodDisplay number:', lastGoodDisplayRef.current.number);
      return lastGoodDisplayRef.current.number;
    }
    return null;
  }, [event?.current_drawn_number, lastGoodDisplayRef.current]);

  const displayQuestionText = useMemo(() => {
    if (questionText) return questionText;
    if (lastGoodDisplayRef.current?.questionText) {
      console.log('[TV-GUARD] 🛡️ Using lastGoodDisplay question');
      return lastGoodDisplayRef.current.questionText;
    }
    return null;
  }, [questionText, lastGoodDisplayRef.current]);

  const displayDrawnNumbers = useMemo(() => {
    if (drawnNumbers.size > 0) return drawnNumbers;
    if (lastGoodDisplayRef.current?.drawnNumbers) {
      console.log('[TV-GUARD] 🛡️ Using lastGoodDisplay drawnNumbers');
      return new Set(lastGoodDisplayRef.current.drawnNumbers);
    }
    return new Set<number>();
  }, [drawnNumbers, lastGoodDisplayRef.current]);

  return (
    <>
      <SEO title="TV Display - Pitalica Skitalica" />
      
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
        <div className="min-h-screen bg-black flex items-center justify-center p-4">
          <Card className="w-full max-w-md border-blue-500 border-2">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <div className="text-6xl animate-pulse">⏳</div>
                <h1 className="text-2xl font-bold text-blue-400">Čekam događaj...</h1>
                <p className="text-gray-400">Nema aktivnog događaja</p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : !event ? (
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="text-white text-2xl">Loading event...</div>
        </div>
      ) : shouldShowWinnerScreen ? (
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
      ) : (
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
                  {displayNumber ? (
                    <div className="text-center space-y-4">
                      <div className="text-lg text-indigo-300 tracking-wide uppercase">
                        Trenutno pitanje
                      </div>
                      <div className="text-8xl font-black text-white drop-shadow-2xl">
                        #{displayNumber}
                      </div>
                      {timeRemaining > 0 && (
                        <div className="text-5xl font-bold text-yellow-300 animate-pulse">
                          {timeRemaining}s
                        </div>
                      )}
                      {displayQuestionText && (
                        <div className="mt-6 bg-white/10 rounded-2xl p-5 backdrop-blur max-h-[40vh] overflow-y-auto">
                          <p className="text-xl text-white leading-relaxed">
                            {displayQuestionText}
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
                      const isDrawn = displayDrawnNumbers.has(num);
                      const isCurrent = displayNumber === num;
                      
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
      )}

      {showOverlay && selectedEventId && (
        <div className="fixed bottom-4 left-4 bg-black/90 text-white p-3 rounded-lg text-xs font-mono border border-green-500 z-50">
          <div className="font-bold text-green-400 mb-2">🎯 TV DEBUG (REALTIME PRIMARY)</div>
          <div className="space-y-1">
            <div>
              <span className="text-gray-400">Event ID:</span>{" "}
              <span className="text-white">{event?.id?.slice(0, 8) || "loading"}...</span>
            </div>
            <div>
              <span className="text-gray-400">Name:</span>{" "}
              <span className="text-white">{event?.name || "loading"}</span>
            </div>
            <div>
              <span className="text-gray-400">Status:</span>{" "}
              <span className={`font-bold ${event?.status === 'active' ? 'text-green-400' : 'text-red-400'}`}>
                {event?.status || "loading"}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Display #:</span>{" "}
              <span className="text-yellow-300">{displayNumber || "none"}</span>
            </div>
            <div>
              <span className="text-gray-400">Has Guard:</span>{" "}
              <span className={lastGoodDisplayRef.current ? "text-green-400" : "text-red-400"}>
                {lastGoodDisplayRef.current ? "✅ YES" : "❌ NO"}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Winners:</span>{" "}
              <span className="text-purple-300">{tickets.filter(t => t.is_winner).length}</span>
            </div>
            <div>
              <span className="text-gray-400">RT Fresh:</span>{" "}
              <span className={Date.now() - lastRealtimeUpdateRef.current < 20000 ? "text-green-400" : "text-yellow-400"}>
                {Math.floor((Date.now() - lastRealtimeUpdateRef.current) / 1000)}s
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}