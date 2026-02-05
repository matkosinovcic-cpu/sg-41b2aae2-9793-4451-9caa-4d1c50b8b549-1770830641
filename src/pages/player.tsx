import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { SEO } from "@/components/SEO";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import {
  getActiveEvent,
  getPlayerTickets,
  getTicketAnswers,
  getDrawnNumbers,
} from "@/services/playerService";

// Simplified interfaces to avoid deep instantiation issues
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

type DrawnNumber = { number: number };

// Local helper to calculate stats since getEventStats is server-side or missing
function calculateEventStats(tickets: TicketWithAnswers[], drawnNumbers: DrawnNumber[]) {
  const totalDrawn = drawnNumbers.length;
  let correctTotal = 0;
  let incorrectTotal = 0;
  
  // Collect all unique answered question numbers across all tickets
  const answeredQuestions = new Set<number>();
  
  tickets.forEach(ticket => {
    ticket.answers.forEach(ans => {
      // Assuming answer=true means correct, or we check against drawn numbers
      // If the answer is stored as boolean 'answer' in DB:
      if (ans.answer === true) {
        correctTotal++;
      } else {
        incorrectTotal++;
      }
      answeredQuestions.add(ans.question_number);
    });
  });

  // Calculate missed/skipped if needed, but for now stick to simple counts
  // or logic: incorrect = answered incorrect + (total drawn - answered correctly)? 
  // Let's stick to what we have in UI: T (correct), N (incorrect/missed)
  
  // Total questions is 90
  // Accuracy
  const accuracyPct = totalDrawn > 0 
    ? Math.round((correctTotal / totalDrawn) * 100) 
    : 0;

  return {
    totalDrawn,
    correctTotal,
    incorrectTotal,
    accuracyPct
  };
}

export default function PlayerPage() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [activeEvent, setActiveEvent] = useState<Event | null>(null);
  const [tickets, setTickets] = useState<TicketWithAnswers[]>([]);
  const [drawnNumbers, setDrawnNumbers] = useState<DrawnNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);

  useEffect(() => {
    loadPlayerData();
  }, []);

  const loadPlayerData = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: playerData } = await supabase
        .from("players")
        .select("*")
        .eq("user_id", session.user.id)
        .single();

      if (playerData) {
        setPlayer(playerData);
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
      const event = await getActiveEvent();
      if (!event) return;

      setActiveEvent(event);

      const [ticketsData, drawnData] = await Promise.all([
        getPlayerTickets(playerId, event.id),
        getDrawnNumbers(event.id),
      ]);

      const ticketsWithAnswers = await Promise.all(
        ticketsData.map(async (ticket) => ({
          ...ticket,
          answers: await getTicketAnswers(ticket.id),
        }))
      );

      setTickets(ticketsWithAnswers);
      setDrawnNumbers(drawnData);
    } catch (error) {
      console.error("Error loading event data:", error);
    }
  };

  const handleNumberToggle = (number: number) => {
    setSelectedNumbers((prev) =>
      prev.includes(number)
        ? prev.filter((n) => n !== number)
        : [...prev, number]
    );
  };

  const handleSubmitAnswers = async () => {
    if (!selectedTicketId || selectedNumbers.length === 0) return;

    try {
      const answersToInsert = selectedNumbers.map((number) => ({
        ticket_id: selectedTicketId,
        question_number: number,
        answer: drawnNumbers.some((d) => d.number === number),
      }));

      await supabase.from("answers").insert(answersToInsert);

      setSelectedNumbers([]);
      setSelectedTicketId(null);
      if (player) await loadEventData(player.id);
    } catch (error) {
      console.error("Error submitting answers:", error);
    }
  };

  const getNumberStatus = (
    number: number,
    ticket: TicketWithAnswers
  ): "correct" | "incorrect" | "drawn" | "default" => {
    const answer = ticket.answers.find((a) => a.question_number === number);
    if (answer) {
      return answer.answer ? "correct" : "incorrect";
    }
    if (drawnNumbers.some((d) => d.number === number)) {
      return "drawn";
    }
    return "default";
  };

  const getNumberClass = (
    status: "correct" | "incorrect" | "drawn" | "default",
    isSelected: boolean
  ) => {
    const baseClass =
      "w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-lg font-bold text-sm sm:text-base transition-all";

    if (isSelected) {
      return `${baseClass} bg-blue-500 text-white scale-105`;
    }

    switch (status) {
      case "correct":
        return `${baseClass} bg-green-500 text-white`;
      case "incorrect":
        return `${baseClass} bg-red-500 text-white`;
      case "drawn":
        return `${baseClass} bg-yellow-400 text-black`;
      default:
        return `${baseClass} bg-gray-200 dark:bg-gray-700 text-black dark:text-white hover:bg-gray-300 dark:hover:bg-gray-600`;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
        <p className="text-lg font-semibold text-gray-700 dark:text-gray-300">
          Učitavanje...
        </p>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-full max-w-md">
          <CardHeader>
            <h2 className="text-2xl font-bold text-center">
              Niste prijavljeni
            </h2>
          </CardHeader>
          <CardContent>
            <p className="text-center text-gray-600 dark:text-gray-400">
              Molimo prijavite se da biste pristupili igračkoj stranici.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!activeEvent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
        <Card className="w-full max-w-md">
          <CardHeader>
            <h2 className="text-2xl font-bold text-center">
              Nema aktivnog eventa
            </h2>
          </CardHeader>
          <CardContent>
            <p className="text-center text-gray-600 dark:text-gray-400">
              Trenutno nema aktivnih evenata.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const globalStats = calculateEventStats(tickets, drawnNumbers);

  return (
    <>
      <SEO
        title="Igrač - PITALICA SKITALICA"
        description="Igračka stranica za PITALICA SKITALICA kviz"
      />
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 p-4">
        {/* Theme Switch */}
        <div className="fixed top-4 right-4 z-50">
          <ThemeSwitch />
        </div>

        <div className="max-w-7xl mx-auto">
          {/* Player Info */}
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {player.nickname}
                  </h1>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {player.email}
                  </p>
                </div>
                <Badge
                  variant={
                    activeEvent.status === "active" ? "default" : "secondary"
                  }
                >
                  {activeEvent.status === "active" ? "Aktivan" : "Završen"}
                </Badge>
              </div>
            </CardHeader>
          </Card>

          {/* SINGLE TICKET VIEW */}
          {tickets.length === 1 && (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  {/* Left: Brand */}
                  <div className="flex flex-col gap-0.5">
                    <p className="text-base sm:text-lg font-extrabold uppercase tracking-wide text-black dark:text-white leading-tight">
                      PITALICA SKITALICA
                    </p>
                  </div>

                  {/* Right: Event Name + Status Badge */}
                  <div className="flex flex-col items-end gap-1">
                    {activeEvent?.name && (
                      <p className="text-xs font-bold text-black dark:text-white leading-tight">
                        {activeEvent.name}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          activeEvent?.status === "active"
                            ? "default"
                            : "secondary"
                        }
                        className="text-xs px-2 py-0.5"
                      >
                        {activeEvent?.status === "active"
                          ? "U toku"
                          : "Završen"}
                      </Badge>
                    </div>
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
                  <span
                    className={`font-bold ${
                      globalStats.accuracyPct >= 50
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {globalStats.accuracyPct}%
                  </span>
                </div>
              </CardHeader>

              <CardContent className="p-4">
                {/* Numbers Grid */}
                <div className="grid grid-cols-9 gap-2 mb-4">
                  {Array.from({ length: 90 }, (_, i) => i + 1).map((num) => {
                    const status = getNumberStatus(num, tickets[0]);
                    const isSelected = selectedNumbers.includes(num);
                    const isAnswered = tickets[0].answers.some(
                      (a) => a.question_number === num
                    );

                    return (
                      <button
                        key={num}
                        onClick={() => !isAnswered && handleNumberToggle(num)}
                        disabled={isAnswered}
                        className={getNumberClass(status, isSelected)}
                      >
                        {num}
                      </button>
                    );
                  })}
                </div>

                {/* Submit Button */}
                {selectedNumbers.length > 0 && (
                  <Button
                    onClick={handleSubmitAnswers}
                    className="w-full"
                    size="lg"
                  >
                    Potvrdi odgovore ({selectedNumbers.length})
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* MULTI-TICKET GRID */}
          {tickets.length > 1 && (
            <div className="space-y-6">
              {/* Global Stats Header */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    {/* Left: Brand */}
                    <div className="flex flex-col gap-0.5">
                      <p className="text-base sm:text-lg font-extrabold uppercase tracking-wide text-black dark:text-white leading-tight">
                        PITALICA SKITALICA
                      </p>
                    </div>

                    {/* Right: Event Name + Status Badge */}
                    <div className="flex flex-col items-end gap-1">
                      {activeEvent?.name && (
                        <p className="text-xs font-bold text-black dark:text-white leading-tight">
                          {activeEvent.name}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            activeEvent?.status === "active"
                              ? "default"
                              : "secondary"
                          }
                          className="text-xs px-2 py-0.5"
                        >
                          {activeEvent?.status === "active"
                            ? "U toku"
                            : "Završen"}
                        </Badge>
                      </div>
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
                    <span
                      className={`font-bold ${
                        globalStats.accuracyPct >= 50
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {globalStats.accuracyPct}%
                    </span>
                  </div>
                </CardHeader>
              </Card>

              {/* Tickets Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {tickets.map((ticket) => {
                  const ticketStats = calculateEventStats([ticket], drawnNumbers);
                  const isSelected = selectedTicketId === ticket.id;

                  return (
                    <Card
                      key={ticket.id}
                      className={`transition-all ${
                        isSelected
                          ? "ring-2 ring-blue-500 shadow-lg"
                          : "hover:shadow-md"
                      }`}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between mb-2">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() =>
                              setSelectedTicketId(
                                isSelected ? null : ticket.id
                              )
                            }
                          />
                          <div className="text-right">
                            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                              Tiket #{ticket.serial_number}
                            </p>
                          </div>
                        </div>

                        {/* Ticket Stats */}
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-black dark:text-white">
                            {ticketStats.totalDrawn}/90
                          </span>
                          <span className="font-bold text-green-600 dark:text-green-400">
                            T {ticketStats.correctTotal}
                          </span>
                          <span className="font-bold text-red-600 dark:text-red-400">
                            N {ticketStats.incorrectTotal}
                          </span>
                          <span
                            className={`font-bold ${
                              ticketStats.accuracyPct >= 50
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {ticketStats.accuracyPct}%
                          </span>
                        </div>
                      </CardHeader>

                      <CardContent className="p-3">
                        <div className="grid grid-cols-9 gap-1">
                          {Array.from({ length: 90 }, (_, i) => i + 1).map(
                            (num) => {
                              const status = getNumberStatus(num, ticket);
                              const isNumSelected =
                                isSelected && selectedNumbers.includes(num);
                              const isAnswered = ticket.answers.some(
                                (a) => a.question_number === num
                              );

                              return (
                                <button
                                  key={num}
                                  onClick={() =>
                                    isSelected &&
                                    !isAnswered &&
                                    handleNumberToggle(num)
                                  }
                                  disabled={!isSelected || isAnswered}
                                  className={`w-8 h-8 flex items-center justify-center rounded text-xs font-bold transition-all ${getNumberClass(
                                    status,
                                    isNumSelected
                                  )}`}
                                >
                                  {num}
                                </button>
                              );
                            }
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Submit Button */}
              {selectedTicketId && selectedNumbers.length > 0 && (
                <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
                  <Button
                    onClick={handleSubmitAnswers}
                    size="lg"
                    className="shadow-xl"
                  >
                    Potvrdi odgovore ({selectedNumbers.length})
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}