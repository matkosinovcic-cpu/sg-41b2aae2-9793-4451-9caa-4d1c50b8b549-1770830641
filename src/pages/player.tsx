import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SEO } from "@/components/SEO";
import { ThemeSwitch } from "@/components/ThemeSwitch";

// Simplified interfaces to avoid TS2589 deep instantiation errors
interface Player {
  id: string;
  nickname: string;
  email: string;
}

interface Event {
  id: string;
  name: string;
  status: string;
  drawn_numbers: number[] | null;
}

interface Answer {
  id: string;
  ticket_id: string;
  question_number: number;
  answer: boolean;
  created_at: string | null;
}

interface Ticket {
  id: string;
  serial_number: string;
  event_id: string;
  player_id: string | null;
  created_at: string | null;
}

interface TicketWithAnswers extends Ticket {
  answers: Answer[];
}

// Local helper to calculate global stats
function calculateGlobalStats(
  tickets: TicketWithAnswers[],
  drawnNumbers: number[]
): {
  totalDrawn: number;
  answeredTotal: number;
  correctTotal: number;
  incorrectTotal: number;
  accuracyPct: number;
} {
  const totalDrawn = drawnNumbers.length;
  
  if (totalDrawn === 0 || tickets.length === 0) {
    return {
      totalDrawn: 0,
      answeredTotal: 0,
      correctTotal: 0,
      incorrectTotal: 0,
      accuracyPct: 0
    };
  }

  const drawnSet = new Set(drawnNumbers);
  const answerMap = new Map<number, boolean>();

  // Collect all answers for drawn questions
  for (const ticket of tickets) {
    for (const answer of ticket.answers) {
      if (drawnSet.has(answer.question_number)) {
        // Keep first answer (already sorted by created_at DESC)
        if (!answerMap.has(answer.question_number)) {
          answerMap.set(answer.question_number, answer.answer);
        }
      }
    }
  }

  const answeredTotal = answerMap.size;
  let correctTotal = 0;
  let answeredIncorrect = 0;

  for (const [, isCorrect] of answerMap) {
    if (isCorrect) {
      correctTotal++;
    } else {
      answeredIncorrect++;
    }
  }

  const skippedCount = totalDrawn - answeredTotal;
  const incorrectTotal = answeredIncorrect + skippedCount;
  const accuracyPct = totalDrawn > 0 
    ? Math.round((correctTotal / totalDrawn) * 100)
    : 0;

  return {
    totalDrawn,
    answeredTotal,
    correctTotal,
    incorrectTotal,
    accuracyPct
  };
}

export default function PlayerPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [tickets, setTickets] = useState<TicketWithAnswers[]>([]);
  const [drawnNumbers, setDrawnNumbers] = useState<number[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPlayerData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      // Explicitly type the query result
      const { data: playerData, error } = await supabase
        .from("players")
        .select("id, nickname, email")
        .eq("id", session.user.id)
        .single();

      if (error) {
        console.error("Error loading player:", error);
        return;
      }

      if (playerData) {
        setPlayer(playerData as Player);
        await loadEventData(playerData.id);
      }
    } catch (error) {
      console.error("Error loading player data:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadEventData = async (playerId: string) => {
    try {
      // Get active event
      const { data: eventData } = await supabase
        .from("events")
        .select("id, name, status, drawn_numbers")
        .eq("status", "active")
        .single();

      if (!eventData) return;

      setActiveEvent(eventData as Event);
      setDrawnNumbers(eventData.drawn_numbers || []);

      // Get player tickets with answers
      const { data: ticketsData } = await supabase
        .from("tickets")
        .select(`
          id,
          serial_number,
          event_id,
          player_id,
          created_at
        `)
        .eq("event_id", eventData.id)
        .eq("player_id", playerId);

      if (!ticketsData) return;

      // Load answers for each ticket
      const ticketsWithAnswers = await Promise.all(
        ticketsData.map(async (ticket) => {
          const { data: answersData } = await supabase
            .from("answers")
            .select("id, ticket_id, question_number, answer, created_at")
            .eq("ticket_id", ticket.id)
            .order("created_at", { ascending: false });

          return {
            ...ticket,
            answers: (answersData || []) as Answer[]
          } as TicketWithAnswers;
        })
      );

      setTickets(ticketsWithAnswers);
      if (ticketsWithAnswers.length > 0) {
        setSelectedTicketId(ticketsWithAnswers[0].id);
      }
    } catch (error) {
      console.error("Error loading event data:", error);
    }
  };

  const handleSubmitAnswers = async () => {
    if (!selectedTicketId || !activeEvent) return;

    const selectedTicket = tickets.find(t => t.id === selectedTicketId);
    if (!selectedTicket) return;

    try {
      const answersToSubmit = selectedTicket.answers.map(answer => ({
        ticket_id: selectedTicket.id,
        question_number: answer.question_number,
        answer: answer.answer,
        created_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from("answers")
        .upsert(answersToSubmit);

      if (error) throw error;

      alert("Odgovori uspješno poslani!");
    } catch (error) {
      console.error("Error submitting answers:", error);
      alert("Greška pri slanju odgovora");
    }
  };

  useEffect(() => {
    loadPlayerData();

    const channel = supabase
      .channel("event-updates")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "events"
        },
        () => {
          if (player) loadEventData(player.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const globalStats = calculateGlobalStats(tickets, drawnNumbers);
  const selectedTicket = tickets.find(t => t.id === selectedTicketId);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <p className="text-lg">Učitavanje...</p>
      </div>
    );
  }

  if (!player || !activeEvent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <p className="text-lg">Nema aktivnog eventa</p>
      </div>
    );
  }

  return (
    <>
      <SEO
        title="Igrač | Pitalica Skitalica"
        description="Stranica igrača za Pitalica Skitalica kviz"
      />
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">Dobrodošli, {player.nickname}!</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">{player.email}</p>
            </div>
            <ThemeSwitch />
          </div>

          {/* Global Stats Card */}
          <Card className="mb-6 bg-white dark:bg-gray-800 shadow-lg">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex flex-col gap-0.5">
                  <p className="text-base sm:text-lg font-extrabold uppercase tracking-wide text-black dark:text-white leading-tight">
                    PITALICA SKITALICA
                  </p>
                </div>

                {/* Right: Event Name + Status Badge + Accuracy */}
                <div className="flex flex-col items-end gap-1">
                  {activeEvent?.name && (
                    <p className="text-xs font-bold text-black dark:text-white leading-tight">
                      {activeEvent.name}
                    </p>
                  )}
                  
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={activeEvent?.status === "active" ? "default" : "secondary"}
                      className={
                        activeEvent?.status === "active"
                          ? "bg-green-500 text-white"
                          : "bg-gray-500 text-white"
                      }
                    >
                      {activeEvent?.status === "active" ? "U toku" : "Završen"}
                    </Badge>
                  </div>

                  <p className="text-base sm:text-lg font-extrabold text-black dark:text-white bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
                    {globalStats.accuracyPct}%
                  </p>
                </div>
              </div>

              {/* Global Stats Row */}
              <div className="flex items-center justify-between text-sm sm:text-base">
                <span className="font-bold text-black dark:text-white">
                  {globalStats.totalDrawn}/90
                </span>
                <span className="font-bold text-green-600 dark:text-green-400">
                  T {globalStats.correctTotal}
                </span>
                <span className="font-bold text-red-600 dark:text-red-400">
                  N {globalStats.incorrectTotal}
                </span>
                <span className={`font-bold ${
                  globalStats.accuracyPct >= 70 
                    ? "text-green-600 dark:text-green-400" 
                    : globalStats.accuracyPct >= 40 
                    ? "text-yellow-600 dark:text-yellow-400" 
                    : "text-red-600 dark:text-red-400"
                }`}>
                  {globalStats.accuracyPct}%
                </span>
              </div>
            </CardHeader>
          </Card>

          {/* Tickets */}
          {tickets.length > 0 && (
            <div className="space-y-4">
              {tickets.map(ticket => {
                const isSelected = selectedTicketId === ticket.id;
                const ticketAnswers = ticket.answers.filter(a => 
                  drawnNumbers.includes(a.question_number)
                );
                const correctCount = ticketAnswers.filter(a => a.answer).length;
                const accuracy = ticketAnswers.length > 0 
                  ? Math.round((correctCount / ticketAnswers.length) * 100)
                  : 0;

                return (
                  <Card
                    key={ticket.id}
                    className={`cursor-pointer transition-all ${
                      isSelected 
                        ? "ring-2 ring-blue-500 shadow-lg" 
                        : "hover:shadow-md"
                    }`}
                    onClick={() => setSelectedTicketId(ticket.id)}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold">Tiket: {ticket.serial_number}</h3>
                        <span className="text-sm font-semibold">
                          {correctCount}/{ticketAnswers.length} ({accuracy}%)
                        </span>
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Submit Button */}
          {selectedTicket && (
            <div className="mt-6">
              <Button
                onClick={handleSubmitAnswers}
                className="w-full"
                size="lg"
              >
                Pošalji odgovore
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}