import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { eventService, Event, EventQuestion } from "@/services/eventService";
import { answerService, TicketStats } from "@/services/answerService";
import { Card, CardContent } from "@/components/ui/card";
import { Trophy } from "lucide-react";
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
  const urlEventId = router.query.eventId as string | undefined;
  
  const [event, setEvent] = useState<Event | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [questionText, setQuestionText] = useState<string | null>(null);
  const [drawnNumbers, setDrawnNumbers] = useState<Set<number>>(new Set());
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [ticketStats, setTicketStats] = useState<TicketStats[]>([]);
  const [animatedCount, setAnimatedCount] = useState(0);
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [noActiveEvent, setNoActiveEvent] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const eventChannelRef = useRef<RealtimeChannel | null>(null);
  const activeEventTrackerRef = useRef<RealtimeChannel | null>(null);

  // 🚀 RESOLVE ACTIVE EVENT (ONCE ON MOUNT)
  const resolveActiveEvent = async (): Promise<Event | null> => {
    try {
      console.log("[TV] 🔍 Resolving active event...");
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error("[TV] ❌ Error fetching active event:", error);
        return null;
      }
      
      return data as unknown as Event;
    } catch (error) {
      console.error("[TV] ❌ Exception in resolveActiveEvent:", error);
      return null;
    }
  };

  // 🎯 LOAD EVENT DATA (ONCE ON MOUNT)
  const loadEventData = async (eventId: string) => {
    try {
      console.log("[TV] 📥 Loading event data:", eventId.slice(0, 8));
      const eventData = await eventService.getEvent(eventId);
      
      setEvent(eventData);
      setDrawnNumbers(new Set(eventData.drawn_numbers || []));
      
      if (eventData.current_drawn_number) {
        await loadCurrentQuestion(eventData.id, eventData.current_drawn_number);
      }
      
      console.log("[TV] ✅ Event data loaded");
    } catch (error) {
      console.error("[TV] ❌ Failed to load event data:", error);
    }
  };

  // 📡 SUBSCRIBE TO EVENT UPDATES (REALTIME ONLY)
  const subscribeToEventUpdates = (eventId: string) => {
    if (eventChannelRef.current) {
      eventChannelRef.current.unsubscribe();
      eventChannelRef.current = null;
    }
    
    console.log("[TV] 📡 Subscribing to realtime updates");
    console.log("[TV] 📡 Filter: id=eq." + eventId.slice(0, 8));
    console.log("[TV] 📡 Full eventId:", eventId);
    
    const channel = supabase
      .channel(`tv-event-${eventId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'events',
        filter: `id=eq.${eventId}`
      }, async (payload) => {
        console.log("[TV] ⚡ realtime UPDATE received!");
        console.log("[TV] 📦 Payload:", {
          eventType: payload.eventType,
          new_id: (payload.new as any)?.id?.slice(0, 8),
          new_currentQuestionNumber: (payload.new as any)?.current_question_number,
          new_currentDrawnNumber: (payload.new as any)?.current_drawn_number,
          new_updatedAt: (payload.new as any)?.updated_at,
          timestamp: Date.now()
        });
        
        const newEvent = payload.new as Event;
        
        // ✅ DIRECT STATE UPDATE
        setEvent(newEvent);
        setDrawnNumbers(new Set(newEvent.drawn_numbers || []));
        
        // ✅ LOAD QUESTION IF CHANGED
        if (newEvent.current_drawn_number && 
            newEvent.current_drawn_number !== currentQuestion?.question_number) {
          console.log("[TV] 🔔 New question detected:", newEvent.current_drawn_number);
          playBeep('start');
          await loadCurrentQuestion(newEvent.id, newEvent.current_drawn_number);
        }
      })
      .subscribe((status) => {
        console.log("[TV] 📡 Subscription status:", status);
        if (status === 'SUBSCRIBED') {
          console.log("[TV] ✅ Successfully subscribed to realtime updates");
        } else if (status === 'CHANNEL_ERROR') {
          console.error("[TV] ❌ Subscription error:", status);
        }
      });
    
    eventChannelRef.current = channel;
  };

  // 🔄 SUBSCRIBE TO ACTIVE EVENT TRACKER (AUTO-SWITCH)
  const subscribeToActiveEventTracker = () => {
    console.log("[TV] 📡 Setting up active event tracker");
    
    const channel = supabase
      .channel('tv-active-event-tracker')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'events',
        filter: 'status=eq.active'
      }, async (payload) => {
        console.log("[TV] ⚡ Active event change:", payload.eventType);
        
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const newActiveEvent = payload.new as Event;
          
          if (event && newActiveEvent.id === event.id) {
            return;
          }
          
          console.log("[TV] 🆕 NEW ACTIVE EVENT:", newActiveEvent.id.slice(0, 8));
          
          // Switch to new event
          setEvent(null);
          setCurrentQuestion(null);
          setQuestionText(null);
          setDrawnNumbers(new Set());
          setTimeRemaining(0);
          
          await loadEventData(newActiveEvent.id);
          subscribeToEventUpdates(newActiveEvent.id);
        }
      })
      .subscribe((status) => {
        console.log("[TV] 📡 Active event tracker status:", status);
      });
    
    activeEventTrackerRef.current = channel;
  };

  // 🚀 INITIALIZE ON MOUNT (ONCE)
  useEffect(() => {
    console.log("[TV] 🚀 TV Screen mounted");
    
    // ✅ EXPOSE __TV_SYNC_STATUS__ HELPER
    (window as any).__TV_SYNC_STATUS__ = () => ({
      activeEventId: event?.id?.slice(0, 8) || 'none',
      eventName: event?.name || 'none',
      status: event?.status || 'none',
      realtimeConnected: eventChannelRef.current !== null,
      mode: 'realtime',
      currentQuestionNumber: event?.current_question_number || null,
      currentDrawnNumber: event?.current_drawn_number || null,
      drawnCount: event?.drawn_numbers?.length || 0,
      timeRemaining
    });
    
    const initializeTV = async () => {
      try {
        // 1️⃣ Get event ID (URL param OR active event)
        let targetEventId = urlEventId;
        
        if (!targetEventId) {
          const activeEvent = await resolveActiveEvent();
          
          if (activeEvent) {
            targetEventId = activeEvent.id;
            console.log("[TV] ✅ Using active event:", targetEventId.slice(0, 8));
          } else {
            console.log("[TV] ⚠️ No active event found");
            setNoActiveEvent(true);
            setIsLoadingEvent(false);
            subscribeToActiveEventTracker();
            return;
          }
        }
        
        // 2️⃣ Load event data (ONCE)
        await loadEventData(targetEventId);
        
        // 3️⃣ Subscribe to realtime updates
        subscribeToEventUpdates(targetEventId);
        subscribeToActiveEventTracker();
        
        setIsLoadingEvent(false);
        setNoActiveEvent(false);
      } catch (error) {
        console.error("[TV] ❌ Failed to initialize:", error);
        setIsLoadingEvent(false);
        subscribeToActiveEventTracker();
      }
    };
    
    initializeTV();
    
    return () => {
      console.log("[TV] 🧹 Cleanup");
      if (eventChannelRef.current) eventChannelRef.current.unsubscribe();
      if (activeEventTrackerRef.current) activeEventTrackerRef.current.unsubscribe();
      delete (window as any).__TV_SYNC_STATUS__;
    };
  }, [urlEventId]);

  // 🎵 INITIALIZE AUDIO CONTEXT
  useEffect(() => {
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (error) {
      console.warn("[TV] ⚠️ AudioContext failed:", error);
    }
  }, []);

  // ⏱️ COUNTDOWN TIMER (LOCAL CALCULATION FROM question_open_until)
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

  // 📊 LOAD STATS WHEN FINISHED
  useEffect(() => {
    if (event?.status === "finished") {
      loadStats();
    }
    if (event) {
      loadTickets();
    }
  }, [event?.status, event?.id]);

  // 🎨 RESET ANIMATION ON STATUS CHANGE
  useEffect(() => {
    if (event?.status !== "finished") {
      setAnimatedCount(0);
    }
  }, [event?.status]);

  // 🏆 COUNTER ANIMATION FOR WINNERS
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

  // 🎵 AUDIO EFFECTS FOR WINNERS
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
    } catch (error) {
      console.error("[TV] Failed to load stats:", error);
      setTicketStats([]);
    }
  };

  const loadTickets = async () => {
    if (!event) return;
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
        .eq('event_id', event.id);

      if (error) throw error;
      setTickets(data as any || []);
    } catch (error) {
      console.error("[TV] Failed to load tickets:", error);
    }
  };

  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      console.log(`[TV] 🔍 Loading question #${questionNumber}`);
      const data = await eventService.getEventQuestion(eventId, questionNumber);
      
      setCurrentQuestion(data);

      if (data?.question_id) {
        const { data: qData, error: qError } = await supabase
          .from("questions")
          .select("text")
          .eq("id", data.question_id)
          .single();

        if (!qError && qData) {
          setQuestionText(qData.text);
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

  // 🔄 LOADING STATE
  if (isLoadingEvent) {
    return (
      <>
        <SEO title="TV Display - Pitalica Skitalica" />
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="text-white text-2xl">Učitavanje...</div>
        </div>
      </>
    );
  }

  // ⏳ NO ACTIVE EVENT
  if (noActiveEvent) {
    return (
      <>
        <SEO title="TV Display - Pitalica Skitalica" />
        <div className="min-h-screen bg-black flex items-center justify-center p-4">
          <Card className="w-full max-w-md border-yellow-500 border-2">
            <CardContent className="pt-6 text-center">
              <div className="text-6xl mb-4 animate-pulse">⏳</div>
              <h1 className="text-2xl font-bold mb-2">Čekam aktivni event</h1>
              <p className="text-gray-600">
                Još nema aktivnog eventa. Automatski će se prikazati kad admin pokrene event.
              </p>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  // ❌ NO EVENT LOADED
  if (!event) {
    return (
      <>
        <SEO title="TV Display - Pitalica Skitalica" />
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="text-white text-2xl">Učitavanje eventa...</div>
        </div>
      </>
    );
  }

  // 🏆 WINNER SCREEN
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

  // 🎮 GAME SCREEN
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
                    
                    {currentQuestion?.questions?.question_type === 'yes_no' && timeRemaining > 0 && (
                      <div className="mt-6 grid grid-cols-2 gap-6">
                        <div className="bg-green-500/20 border-2 border-green-400 rounded-2xl p-6 backdrop-blur">
                          <div className="text-4xl font-black text-green-300">DA</div>
                        </div>
                        <div className="bg-red-500/20 border-2 border-red-400 rounded-2xl p-6 backdrop-blur">
                          <div className="text-4xl font-black text-red-300">NE</div>
                        </div>
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