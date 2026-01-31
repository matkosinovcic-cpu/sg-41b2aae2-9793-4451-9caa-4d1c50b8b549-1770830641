import { SEO } from "@/components/SEO";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { eventService, Event, EventQuestion } from "@/services/eventService";
import { supabase } from "@/integrations/supabase/client";
import { Trophy } from "lucide-react";

export default function TVScreen() {
  const router = useRouter();
  const { eventId: urlEventId } = router.query;

  const [event, setEvent] = useState<Event | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<EventQuestion | null>(null);
  const [questionText, setQuestionText] = useState<string>("");
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [drawnNumbers, setDrawnNumbers] = useState<Set<number>>(new Set());
  const [isLoadingEvent, setIsLoadingEvent] = useState(true);
  const [noActiveEvent, setNoActiveEvent] = useState(false);

  const eventChannelRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Initialize audio context
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Play beep sound
  const playBeep = (type: 'start' | 'tick' | 'end') => {
    if (!audioContextRef.current) return;

    const ctx = audioContextRef.current;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    if (type === 'start') {
      oscillator.frequency.value = 800;
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);
    } else if (type === 'tick') {
      oscillator.frequency.value = 600;
      gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.1);
    } else if (type === 'end') {
      oscillator.frequency.value = 400;
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.5);
    }
  };

  // Load current question
  const loadCurrentQuestion = async (eventId: string, questionNumber: number) => {
    try {
      console.log("[TV] 📥 Loading question #", questionNumber);
      const questionData = await eventService.getEventQuestion(eventId, questionNumber);
      setCurrentQuestion(questionData);
      
      if (questionData.questions) {
        setQuestionText(questionData.questions.text);
        console.log("[TV] ✅ Question loaded:", questionData.questions.text);
      }
    } catch (error) {
      console.error("[TV] Failed to load question:", error);
    }
  };

  // ✅ SIMPLE REALTIME INITIALIZATION
  useEffect(() => {
    console.log("[TV] 🚀 TV Screen mounting");

    const initTV = async () => {
      try {
        let targetEventId = urlEventId as string;

        // If no URL eventId, find active event
        if (!targetEventId) {
          console.log("[TV] 🔍 No eventId in URL, looking for active event");
          const { data: activeEvent } = await supabase
            .from('events')
            .select('*')
            .eq('status', 'active')
            .maybeSingle();

          if (!activeEvent) {
            console.log("[TV] ⚠️ No active event found");
            setNoActiveEvent(true);
            setIsLoadingEvent(false);
            return;
          }

          targetEventId = activeEvent.id;
          console.log("[TV] ✅ Found active event:", targetEventId.slice(0, 8));
        }

        // Load event data
        console.log("[TV] 📥 Loading event data:", targetEventId.slice(0, 8));
        const eventData = await eventService.getEvent(targetEventId);
        setEvent(eventData);
        setDrawnNumbers(new Set(eventData.drawn_numbers || []));

        // Load current question if exists
        if (eventData.current_question_number) {
          await loadCurrentQuestion(eventData.id, eventData.current_question_number);
        }

        // ✅ SUBSCRIBE TO REALTIME UPDATES
        console.log("[TV] 📡 Setting up realtime subscription for:", targetEventId.slice(0, 8));
        
        const channel = supabase
          .channel(`tv-event-${targetEventId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'events',
              filter: `id=eq.${targetEventId}`
            },
            async (payload) => {
              console.log("[TV] ⚡ Realtime UPDATE received");
              const newEvent = payload.new as Event;
              
              // ✅ DIRECT STATE UPDATE
              setEvent(newEvent);
              setDrawnNumbers(new Set(newEvent.drawn_numbers || []));
              
              // ✅ LOAD NEW QUESTION IF CHANGED
              if (newEvent.current_question_number && 
                  newEvent.current_question_number !== currentQuestion?.question_number) {
                console.log("[TV] 🔔 New question:", newEvent.current_question_number);
                playBeep('start');
                await loadCurrentQuestion(newEvent.id, newEvent.current_question_number);
              }
            }
          )
          .subscribe((status) => {
            console.log("[TV] 📡 Subscription status:", status);
          });

        eventChannelRef.current = channel;
        setIsLoadingEvent(false);
        setNoActiveEvent(false);

        console.log("[TV] ✅ TV initialization complete");
      } catch (error) {
        console.error("[TV] ❌ Failed to initialize TV:", error);
        setIsLoadingEvent(false);
      }
    };

    initTV();

    // Cleanup
    return () => {
      console.log("[TV] 🧹 Cleaning up subscription");
      if (eventChannelRef.current) {
        eventChannelRef.current.unsubscribe();
      }
    };
  }, [urlEventId]);

  // ⏱️ COUNTDOWN TIMER (LOCAL CALCULATION)
  useEffect(() => {
    if (!event?.question_open_until) {
      setTimeRemaining(0);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const deadline = new Date(event.question_open_until!).getTime();
      const remaining = Math.max(0, Math.floor((deadline - now) / 1000));

      // Play sounds
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

  // Loading state
  if (isLoadingEvent) {
    return (
      <>
        <SEO title="TV Screen - Pitalica Skitalica" />
        <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 flex items-center justify-center">
          <div className="text-white text-4xl font-bold">Učitavam...</div>
        </div>
      </>
    );
  }

  // No active event
  if (noActiveEvent) {
    return (
      <>
        <SEO title="TV Screen - Pitalica Skitalica" />
        <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="text-white text-6xl mb-6">⏳</div>
            <div className="text-white text-4xl font-bold mb-4">Čekam aktivni event</div>
            <div className="text-white/80 text-xl">
              Još nema aktivnog eventa. Automatski će se prikazati kad admin pokrene event.
            </div>
          </div>
        </div>
      </>
    );
  }

  // Winner screen
  if (event?.winner_ticket_id) {
    return (
      <>
        <SEO title="Pobjednik! - Pitalica Skitalica" />
        <div className="min-h-screen bg-gradient-to-br from-yellow-400 via-orange-500 to-red-600 flex items-center justify-center p-8">
          <div className="text-center animate-bounce">
            <Trophy className="w-48 h-48 text-white mx-auto mb-8" />
            <div className="text-white text-8xl font-black mb-6">POBJEDNIK!</div>
            <div className="text-white text-6xl font-bold mb-4">
              Ulaznica #{event.winner_ticket_id.slice(-4)}
            </div>
            <div className="text-white/90 text-3xl">
              🎉 Čestitamo! 🎉
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <SEO title="TV Screen - Pitalica Skitalica" />
      <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 p-8">
        <div className="container mx-auto max-w-7xl">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-6xl font-black text-white mb-4">
              {event?.name || "PITALICA SKITALICA"}
            </h1>
            <div className="text-white/80 text-2xl">
              Pitanje {event?.current_question_number || 0} / 90
            </div>
          </div>

          {/* Main Question Display */}
          {currentQuestion && questionText ? (
            <div className="bg-white rounded-3xl shadow-2xl p-12 mb-8">
              <div className="text-center mb-8">
                <div className="inline-block bg-gradient-to-r from-blue-600 to-purple-600 text-white px-8 py-4 rounded-full text-4xl font-bold mb-6">
                  #{event?.current_drawn_number}
                </div>
              </div>

              <div className="text-center mb-12">
                <h2 className="text-6xl font-bold text-gray-900 leading-tight">
                  {questionText}
                </h2>
              </div>

              {/* Timer */}
              <div className="text-center mb-8">
                <div className={`text-8xl font-black ${
                  timeRemaining <= 3 ? 'text-red-600 animate-pulse' : 'text-blue-600'
                }`}>
                  {timeRemaining}s
                </div>
              </div>

              {/* Answer options display */}
              <div className="grid grid-cols-2 gap-8">
                <div className="bg-green-100 border-4 border-green-500 rounded-2xl p-8 text-center">
                  <div className="text-6xl font-black text-green-700">DA</div>
                </div>
                <div className="bg-red-100 border-4 border-red-500 rounded-2xl p-8 text-center">
                  <div className="text-6xl font-black text-red-700">NE</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl shadow-2xl p-12 text-center">
              <div className="text-4xl font-bold text-gray-600">
                Čekam prvo pitanje...
              </div>
            </div>
          )}

          {/* Drawn Numbers Grid */}
          <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-6">
            <h3 className="text-white text-2xl font-bold mb-4">Izvučeni brojevi</h3>
            <div className="grid grid-cols-10 gap-2">
              {Array.from({ length: 90 }, (_, i) => i + 1).map((num) => (
                <div
                  key={num}
                  className={`
                    aspect-square rounded-lg flex items-center justify-center text-lg font-bold
                    ${drawnNumbers.has(num)
                      ? 'bg-yellow-400 text-gray-900'
                      : 'bg-white/20 text-white/40'
                    }
                    ${event?.current_drawn_number === num ? 'ring-4 ring-yellow-300' : ''}
                  `}
                >
                  {num}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}