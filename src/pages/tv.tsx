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
  const [timeRemaining, setTimeRemaining] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    loadEvents();
    // Initialize AudioContext
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  }, []);

  useEffect(() => {
    if (selectedEventId) {
      loadEventData();
      const subscription = eventService.subscribeToEvent(selectedEventId, (payload) => {
        setEvent(payload.new);
        // Play sound on new question if question number changed
        if (payload.new.current_question_number !== event?.current_question_number) {
          playBeep('start');
        }
      });

      const questionsSubscription = eventService.subscribeToEventQuestions(selectedEventId, () => {
        loadCurrentQuestion();
      });

      return () => {
        subscription.unsubscribe();
        questionsSubscription.unsubscribe();
      };
    }
  }, [selectedEventId]);

  // Effect to handle question loading when event updates
  useEffect(() => {
    if (event?.current_question_number) {
      loadCurrentQuestion();
    }
  }, [event?.current_question_number]);

  useEffect(() => {
    if (event?.question_open_until) {
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
    }
  }, [event?.question_open_until, timeRemaining]);

  const loadEvents = async () => {
    try {
      const data = await eventService.getAllEvents();
      setEvents(data);
    } catch (error) {
      console.error("Failed to load events");
    }
  };

  const loadEventData = async () => {
    try {
      const data = await eventService.getEvent(selectedEventId);
      setEvent(data);
    } catch (error) {
      console.error("Failed to load event");
    }
  };

  const loadCurrentQuestion = async () => {
    if (!selectedEventId || !event?.current_question_number) return;
    try {
      const data = await eventService.getEventQuestion(selectedEventId, event.current_question_number);
      setCurrentQuestion(data);
    } catch (error) {
      console.error("Failed to load question");
    }
  };

  const playBeep = (type: 'start' | 'tick' | 'end') => {
    if (!audioContextRef.current) return;
    
    const ctx = audioContextRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (type === 'start') {
      // High pitch double beep
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1760, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } else if (type === 'tick') {
      // Short tick
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } else if (type === 'end') {
      // Low finish tone
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 1);
      osc.start();
      osc.stop(ctx.currentTime + 1);
    }
  };

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
  if (!event) return null;

  return (
    <>
      <SEO title="TV Display - Pitalica Skitalica" />
      <div className="min-h-screen bg-black text-white overflow-hidden relative">
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

          {/* Winner Display */}
          {event.winner_ticket_id ? (
            <div className="flex-1 flex flex-col items-center justify-center animate-bounce-slow">
              <Trophy className="w-64 h-64 text-yellow-400 mb-8 drop-shadow-[0_0_30px_rgba(250,204,21,0.5)]" />
              <h2 className="text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-orange-400 to-yellow-300 mb-8">
                WE HAVE A WINNER!
              </h2>
              <div className="bg-white text-black px-12 py-6 rounded-2xl">
                <p className="text-3xl text-gray-600 mb-2">Winning Ticket</p>
                <p className="text-6xl font-black">{event.winner_ticket_id.split('-')[0] || "WINNER"}</p>
              </div>
            </div>
          ) : (
            /* Game Display */
            <div className="flex-1 flex flex-col justify-center">
              {currentQuestion ? (
                <div className="grid grid-cols-12 gap-12 items-center">
                  {/* Question Number */}
                  <div className="col-span-3">
                    <div className="aspect-square rounded-full bg-purple-600 flex items-center justify-center border-8 border-purple-400 shadow-[0_0_50px_rgba(147,51,234,0.5)]">
                      <span className="text-9xl font-black">{currentQuestion.question_number}</span>
                    </div>
                  </div>

                  {/* Question Text */}
                  <div className="col-span-9 space-y-8">
                    <div className="bg-white/10 backdrop-blur-md rounded-3xl p-12 border border-white/20">
                      <h2 className="text-6xl font-bold leading-tight text-shadow">
                        {currentQuestion.questions?.text}
                      </h2>
                    </div>

                    {/* Timer */}
                    {timeRemaining > 0 ? (
                      <div className="flex items-center gap-6">
                        <Clock className="w-16 h-16 text-green-400 animate-pulse" />
                        <div className="h-8 flex-1 bg-gray-800 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-green-500 to-green-300 transition-all duration-100 ease-linear"
                            style={{ width: `${(timeRemaining / 10) * 100}%` }}
                          />
                        </div>
                        <span className="text-6xl font-black font-mono text-green-400 min-w-[3ch]">
                          {timeRemaining}
                        </span>
                      </div>
                    ) : (
                      <div className="bg-red-500/20 border border-red-500/50 rounded-2xl p-6 text-center">
                        <p className="text-4xl font-bold text-red-400">TIME'S UP</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Waiting State */
                <div className="text-center space-y-8">
                  <Gamepad2 className="w-48 h-48 text-purple-500 mx-auto animate-pulse" />
                  <h2 className="text-6xl font-bold text-white/50">
                    Waiting for next question...
                  </h2>
                </div>
              )}
            </div>
          )}

          {/* Footer Stats */}
          <div className="mt-8 grid grid-cols-3 gap-8 text-center text-white/40 text-xl font-bold">
            <div>90 Questions Total</div>
            <div>15 to Win</div>
            <div>Good Luck!</div>
          </div>
        </div>
      </div>
    </>
  );
}