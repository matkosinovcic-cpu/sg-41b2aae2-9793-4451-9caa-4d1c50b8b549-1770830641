import { supabase } from "@/integrations/supabase/client";

export interface Question {
  id: string;
  text: string;
  correct_answer: boolean;
  question_type?: string; // 'yes_no' by default
}

export interface Event {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "finished";
  current_question_number: number | null;
  current_drawn_number: number | null;
  drawn_numbers: number[];
  question_open_until: string | null;
  winner_ticket_id: string | null;
  created_at: string;
  updated_at: string; // ✅ ADDED for sync comparison
}

export interface EventQuestion {
  id: string;
  event_id: string;
  question_number: number;
  question_id: string;
  drawn: boolean;
  drawn_at: string | null;
  questions?: Question;
}

export interface Ticket {
  id: string;
  serial_number: string;
  event_id: string;
  is_winner: boolean;
  ticket_questions?: TicketQuestion[]; // Joined data
}

export interface TicketQuestion {
  ticket_id: string;
  question_number: number;
}

export interface Answer {
  id: string;
  ticket_id: string;
  question_number: number;
  answer: boolean;
  created_at: string;
}

export const eventService = {
  async createQuestion(text: string, correctAnswer: boolean) {
    const { data, error } = await supabase
      .from("questions")
      .insert({ text, correct_answer: correctAnswer })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  async getAllQuestions() {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return data as Question[];
  },

  async createEvent(name: string) {
    const { data, error } = await supabase
      .from("events")
      .insert({ 
        name, 
        status: "draft",
        drawn_numbers: [],
        current_drawn_number: null,
        continue_after_winner: false  // CRITICAL: Always OFF for new events
      })
      .select()
      .single();
    
    if (error) throw error;
    return data as Event;
  },

  async getEvents() {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return data as Event[];
  },

  async getEvent(eventId: string) {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();
    
    if (error) throw error;
    return data as Event;
  },

  async generateEventQuestions(eventId: string) {
    // Get all questions from the pool
    const { data: allQuestions, error: questionsError } = await supabase
      .from("questions")
      .select("id");
    
    if (questionsError) throw questionsError;
    
    const availableCount = allQuestions.length;
    const questionCount = Math.min(availableCount, 90);

    if (availableCount === 0) {
      throw new Error("No questions available in the pool. Please create some questions first.");
    }

    // Shuffle ALL questions using Fisher-Yates algorithm
    const shuffled = [...allQuestions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    // Take first N questions from shuffled array
    const selectedQuestions = shuffled.slice(0, questionCount);

    // Assign sequential question_numbers (1, 2, 3...) to the shuffled questions
    // This creates the pre-randomized draw order
    const eventQuestions = selectedQuestions.map((q, index) => ({
      event_id: eventId,
      question_number: index + 1, // Sequential numbers 1..N
      question_id: q.id,           // But random question IDs
      drawn: false
    }));

    const { error: insertError } = await supabase
      .from("event_questions")
      .insert(eventQuestions);
    
    if (insertError) throw insertError;
    return { count: questionCount, total: availableCount };
  },

  async generateTickets(eventId: string, count: number) {
    const tickets = [];
    
    for (let i = 0; i < count; i++) {
      const serialNumber = `T${Date.now()}-${i.toString().padStart(4, "0")}`;
      
      const numbers = new Set<number>();
      while (numbers.size < 15) {
        numbers.add(Math.floor(Math.random() * 90) + 1);
      }

      const { data: ticket, error: ticketError } = await supabase
        .from("tickets")
        .insert({ serial_number: serialNumber, event_id: eventId })
        .select()
        .single();
      
      if (ticketError) throw ticketError;

      const ticketQuestions = Array.from(numbers).map(num => ({
        ticket_id: ticket.id,
        question_number: num
      }));

      const { error: questionsError } = await supabase
        .from("ticket_questions")
        .insert(ticketQuestions);
      
      if (questionsError) throw questionsError;
      
      tickets.push(ticket);
    }

    return tickets;
  },

  async getTicket(ticketId: string) {
    const { data, error } = await supabase
      .from("tickets")
      .select("*, ticket_questions(*)")
      .eq("id", ticketId)
      .single();
    
    if (error) throw error;
    return data;
  },

  async getTicketBySerial(serialNumber: string) {
    const { data, error } = await supabase
      .from("tickets")
      .select("*, ticket_questions(*)")
      .eq("serial_number", serialNumber)
      .single();
    
    if (error) throw error;
    return data;
  },

  async getTickets(eventId: string) {
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    
    if (error) throw error;
    return data as Ticket[];
  },

  async startEvent(eventId: string) {
    // ✅ CRITICAL: Re-fetch event to check current status (SOURCE OF TRUTH)
    const { data: currentEvent } = await supabase
      .from("events")
      .select("status")
      .eq("id", eventId)
      .single();

    if (!currentEvent) {
      throw new Error("Event not found");
    }

    // ✅ STATE MACHINE: FINISHED events cannot be restarted (use reset instead)
    if (currentEvent.status === "finished") {
      throw new Error("Event je završen i ne može se ponovno pokrenuti. Koristi 'Reset Event' akciju.");
    }

    // First, deactivate ALL other active events
    const { error: deactivateError } = await supabase
      .from("events")
      .update({ status: "draft" })
      .eq("status", "active")
      .neq("id", eventId);
    
    if (deactivateError) throw deactivateError;

    // Then activate the selected event
    // Only clear drawn numbers if starting from DRAFT (not PAUSED)
    const updates: any = { status: "active" };
    
    if (currentEvent.status === "draft") {
      updates.drawn_numbers = [];
      updates.current_drawn_number = null;
      updates.winner_ticket_id = null;
    }

    const { error } = await supabase
      .from("events")
      .update(updates)
      .eq("id", eventId);
    
    if (error) throw error;
  },

  async drawNextQuestion(eventId: string) {
    console.log("═══════════════════════════════════════════════");
    console.log("[DRAW] 🎲 STARTING DRAW");
    console.log("[DRAW] 📋 Event ID:", eventId);
    console.log("═══════════════════════════════════════════════");

    // Get current event state
    const event = await this.getEvent(eventId);
    const drawnNumbers = event.drawn_numbers || [];
    
    console.log("[DRAW] 📊 Current state:", {
      eventId: event.id.slice(0, 8),
      status: event.status,
      currentQuestion: event.current_question_number,
      totalDrawn: drawnNumbers.length
    });

    // Find available numbers
    const availableNumbers = Array.from({ length: 90 }, (_, i) => i + 1).filter(
      (num) => !drawnNumbers.includes(num)
    );

    if (availableNumbers.length === 0) {
      console.error("[DRAW] ❌ No more questions available");
      throw new Error("All questions have been drawn");
    }

    // Draw random number
    const randomIndex = Math.floor(Math.random() * availableNumbers.length);
    const drawnNumber = availableNumbers[randomIndex];
    const updatedDrawnNumbers = [...drawnNumbers, drawnNumber];

    console.log("[DRAW] 🎯 Drew number:", drawnNumber);
    console.log("[DRAW] 📈 Total drawn now:", updatedDrawnNumbers.length);

    // Get question
    const { data: questionData, error: questionError } = await supabase
      .from("event_questions")
      .select("*, questions(*)")
      .eq("event_id", eventId)
      .eq("question_number", drawnNumber)
      .single();

    if (questionError || !questionData) {
      console.error("[DRAW] ❌ Failed to get question:", questionError);
      throw new Error("Question not found for drawn number");
    }

    console.log("[DRAW] ✅ Question loaded:", {
      questionNumber: questionData.question_number,
      questionId: questionData.question_id
    });

    // Calculate deadline (9 seconds from now)
    const now = new Date();
    const questionOpenUntil = new Date(now.getTime() + 9000).toISOString();

    console.log("[DRAW] ⏰ Setting deadline:", {
      now: now.toISOString(),
      deadline: questionOpenUntil,
      durationMs: 9000
    });

    // ✅ ONE UPDATE - TRIGGERS SUPABASE REALTIME
    console.log("[DRAW] 📤 Executing UPDATE...");
    console.log("[DRAW] 🔑 Update data:", {
      drawn_numbers: `[${updatedDrawnNumbers.length} items]`,
      current_drawn_number: drawnNumber,
      current_question_number: drawnNumber,
      question_open_until: questionOpenUntil,
      updated_at: "NOW()"
    });

    const { data: returnedRow, error: updateError } = await supabase
      .from("events")
      .update({
        drawn_numbers: updatedDrawnNumbers,
        current_drawn_number: drawnNumber,
        current_question_number: drawnNumber,
        question_open_until: questionOpenUntil,
        updated_at: new Date().toISOString() // ✅ FORCE updated_at change
      })
      .eq("id", eventId)
      .select("*")
      .single();

    if (updateError) {
      console.error("[DRAW] ❌ UPDATE FAILED:", updateError);
      throw updateError;
    }

    if (!returnedRow) {
      console.error("[DRAW] ❌ NO ROW RETURNED");
      throw new Error("Failed to update event - no row returned");
    }

    console.log("[DRAW] ✅ UPDATE SUCCESS!");
    console.log("[DRAW] 📦 Returned row:", {
      id: returnedRow.id.slice(0, 8),
      current_drawn_number: returnedRow.current_drawn_number,
      current_question_number: returnedRow.current_question_number,
      question_open_until: returnedRow.question_open_until,
      updated_at: returnedRow.updated_at,
      drawn_count: returnedRow.drawn_numbers?.length || 0
    });

    console.log("[DRAW] 📡 Realtime should now broadcast UPDATE to TV & Player");
    console.log("═══════════════════════════════════════════════");
    console.log("[DRAW] 🏁 DRAW COMPLETED");
    console.log("═══════════════════════════════════════════════");

    // Check for winner
    await this.checkForWinner(eventId);

    return { 
      question: questionData, 
      questionOpenUntil, 
      drawnNumber 
    };
  },

  async pauseEvent(eventId: string) {
    const { error } = await supabase
      .from("events")
      .update({ status: "paused" })
      .eq("id", eventId);
    
    if (error) throw error;
  },

  async submitAnswer(ticketId: string, questionNumber: number, answer: boolean) {
    const { data: ticket } = await supabase
      .from("tickets")
      .select("event_id")
      .eq("id", ticketId)
      .single();

    if (!ticket) throw new Error("Ticket not found");

    const { data: event } = await supabase
      .from("events")
      .select("question_open_until")
      .eq("id", ticket.event_id)
      .single();

    if (!event) throw new Error("Event not found");

    if (event.question_open_until) {
      const deadline = new Date(event.question_open_until);
      if (new Date() > deadline) {
        throw new Error("Time expired for this question");
      }
    }

    const { data, error } = await supabase
      .from("answers")
      .insert({
        ticket_id: ticketId,
        question_number: questionNumber,
        answer
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Check if any ticket has all its 15 numbers drawn and mark as winner
   * CRITICAL: Winner is first ticket with all 15 numbers drawn
   * CRITICAL: Only marks the FIRST winner, never changes winner once set
   * CRITICAL: Auto-sets event status to FINISHED when winner found
   */
  async checkForWinner(eventId: string): Promise<{ winnerFound: boolean; winnerSerial?: string } | null> {
    console.log("[checkForWinner] Checking for winner in event:", eventId);

    const { data: event } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (!event) return null;

    // If winner already exists, don't check again (winner is locked)
    if (event.winner_ticket_id) {
      console.log("[checkForWinner] Winner already exists:", event.winner_ticket_id);
      return { winnerFound: true, winnerSerial: undefined };
    }

    const drawnNumbers = event.drawn_numbers || [];
    console.log("[checkForWinner] Drawn numbers:", drawnNumbers.length);

    // Get all tickets with their questions
    const { data: tickets } = await supabase
      .from("tickets")
      .select("id, serial_number, ticket_questions(question_number)")
      .eq("event_id", eventId);

    if (!tickets || tickets.length === 0) return null;

    // Check each ticket for all 15 numbers drawn
    for (const ticket of tickets) {
      const ticketNumbers = ticket.ticket_questions.map((tq: any) => tq.question_number);
      
      // Check if ALL 15 ticket numbers have been drawn
      const allNumbersDrawn = ticketNumbers.every((num: number) => drawnNumbers.includes(num));

      if (allNumbersDrawn) {
        console.log("[checkForWinner] 🎉 WINNER FOUND! Ticket:", ticket.serial_number);

        // Mark ticket as winner
        await supabase
          .from("tickets")
          .update({ is_winner: true })
          .eq("id", ticket.id);

        // ✅ CRITICAL: Auto-set event status to FINISHED when winner found
        await supabase
          .from("events")
          .update({ 
            status: "finished",
            winner_ticket_id: ticket.id 
          })
          .eq("id", eventId);

        console.log("[checkForWinner] ✅ Event status set to FINISHED");

        return { winnerFound: true, winnerSerial: ticket.serial_number };
      }
    }

    console.log("[checkForWinner] No winner yet");
    return { winnerFound: false };
  },

  subscribeToEvent(eventId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`event:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "events",
          filter: `id=eq.${eventId}`
        },
        callback
      )
      .subscribe();
  },

  subscribeToEventQuestions(eventId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`event_questions:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_questions",
          filter: `event_id=eq.${eventId}`
        },
        callback
      )
      .subscribe();
  },

  subscribeToTickets(eventId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`tickets:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${eventId}`
        },
        callback
      )
      .subscribe();
  },

  async getEventQuestion(eventId: string, questionNumber: number) {
    const { data, error } = await supabase
      .from("event_questions")
      .select("*, questions(*)")
      .eq("event_id", eventId)
      .eq("question_number", questionNumber)
      .single();
    
    if (error) throw error;
    return data as EventQuestion;
  },

  async getEventQuestions(eventId: string) {
    const { data, error } = await supabase
      .from("event_questions")
      .select("*, questions(*)")
      .eq("event_id", eventId)
      .order("question_number", { ascending: true });
    
    if (error) throw error;
    return data as EventQuestion[];
  }
};