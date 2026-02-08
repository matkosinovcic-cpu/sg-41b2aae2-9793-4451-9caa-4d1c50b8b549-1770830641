import { supabase } from "@/integrations/supabase/client";

export interface Question {
  id: string;
  text: string;
  correct_answer: boolean;
}

export interface Event {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "finished";
  venue_slug: string;
  current_question_number: number | null;
  current_drawn_number: number | null;
  drawn_numbers: number[];
  question_open_until: string | null;
  winner_ticket_id: string | null;
  created_at: string;
  draw_mode?: "standalone" | "global";
  draw_session_id?: string | null;
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

  async getEventById(eventId: string) {
    return this.getEvent(eventId);
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
      // Generate truly unique serial number with timestamp + random component + index
      const timestamp = Date.now();
      const randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
      const serialNumber = `T${timestamp}-${randomPart}-${i.toString().padStart(4, "0")}`;
      
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

  /**
   * ✅ GLOBAL MODE: Draw next question from SHARED draw_session
   * This function works for BOTH standalone and global events:
   * - Standalone: Uses event.drawn_numbers (legacy)
   * - Global: Uses draw_session.drawn_numbers (shared across venues)
   */
  async drawNextQuestion(eventId: string) {
    console.log("[drawNextQuestion] 🎯 Starting draw for event:", eventId);

    // ✅ STEP 1: Load event WITH draw_session data
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("*, draw_sessions(*)")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      console.error("[drawNextQuestion] ❌ Event not found:", eventError);
      throw new Error("Event not found");
    }

    console.log("[drawNextQuestion] 📊 Event loaded:", {
      id: event.id,
      name: event.name,
      status: event.status,
      draw_mode: event.draw_mode,
      draw_session_id: event.draw_session_id,
      has_draw_session: !!event.draw_sessions
    });

    // ✅ STATE MACHINE: Enforce strict status rules
    if (event.status === "finished") {
      throw new Error("Event je završen. Za novo izvlačenje koristi 'Reset Event' u admin panelu.");
    }

    if (event.status === "paused") {
      throw new Error("Event je pauziran. Klikni 'Nastavi' za nastavak.");
    }

    if (event.status !== "active") {
      throw new Error(`Event mora biti aktivan za izvlačenje (trenutni status: ${event.status})`);
    }

    // ✅ STEP 2: Determine if GLOBAL or STANDALONE mode
    const isGlobalMode = event.draw_mode === "global" && event.draw_session_id && event.draw_sessions;

    console.log("[drawNextQuestion] 🔍 Mode detection:", {
      draw_mode: event.draw_mode,
      has_session_id: !!event.draw_session_id,
      has_session_data: !!event.draw_sessions,
      isGlobalMode
    });

    let drawnNumbers: number[] = [];
    let drawSessionId: string | null = null;

    if (isGlobalMode) {
      // ✅ GLOBAL MODE: Use draw_session.drawn_numbers (shared across all events)
      drawnNumbers = event.draw_sessions.drawn_numbers || [];
      drawSessionId = event.draw_session_id!;
      console.log("[drawNextQuestion] 🌍 GLOBAL MODE - Using draw_session:", {
        session_id: drawSessionId,
        drawn_count: drawnNumbers.length
      });
    } else {
      // ✅ STANDALONE MODE: Use event.drawn_numbers (legacy)
      drawnNumbers = event.drawn_numbers || [];
      console.log("[drawNextQuestion] 📍 STANDALONE MODE - Using event.drawn_numbers:", {
        drawn_count: drawnNumbers.length
      });
    }

    // ✅ STEP 3: Check if all 90 numbers are drawn
    if (drawnNumbers.length >= 90) {
      console.log("[drawNextQuestion] ⛔ All 90 numbers drawn");
      throw new Error("Svih 90 brojeva je izvučeno");
    }

    // ✅ STEP 4: Find available numbers (1-90 that haven't been drawn)
    const availableNumbers = [];
    for (let i = 1; i <= 90; i++) {
      if (!drawnNumbers.includes(i)) {
        availableNumbers.push(i);
      }
    }

    if (availableNumbers.length === 0) {
      throw new Error("Nema više dostupnih brojeva");
    }

    // ✅ STEP 5: Randomly select one number
    const randomIndex = Math.floor(Math.random() * availableNumbers.length);
    const drawnNumber = availableNumbers[randomIndex];

    console.log("[drawNextQuestion] 🎲 Random selection:", {
      available_count: availableNumbers.length,
      drawn_number: drawnNumber
    });

    // ✅ STEP 6: Get the question for this number (from ANY event in session)
    const { data: questionData, error: questionError } = await supabase
      .from("event_questions")
      .select("*, questions(*)")
      .eq("event_id", eventId)
      .eq("question_number", drawnNumber)
      .maybeSingle();

    if (questionError || !questionData) {
      console.error("[drawNextQuestion] ❌ Question not found:", questionError);
      throw new Error("Pitanje nije pronađeno za izvučeni broj");
    }

    console.log("[drawNextQuestion] 📝 Question loaded:", {
      question_number: drawnNumber,
      question_id: questionData.question_id,
      question_text: questionData.questions?.text
    });

    const questionOpenUntil = new Date(Date.now() + 10000).toISOString();
    const updatedDrawnNumbers = [...drawnNumbers, drawnNumber];

    console.log("[drawNextQuestion] 📦 STEP 7.0: Prepared data for update:", {
      updatedDrawnNumbers,
      updatedDrawnNumbers_length: updatedDrawnNumbers.length,
      questionOpenUntil,
      isGlobalMode
    });

    // ✅ STEP 7: Update database based on mode
    if (isGlobalMode) {
      console.log("[drawNextQuestion] 🌍 GLOBAL MODE - Updating draw_session + ALL events");

      // ✅ CRITICAL FIX: Force update draw_session.drawn_numbers with explicit error handling
      console.log("[drawNextQuestion] 📝 FORCE UPDATE draw_session:", {
        session_id: drawSessionId,
        old_count: drawnNumbers.length,
        new_count: updatedDrawnNumbers.length,
        adding_number: drawnNumber,
        full_array: updatedDrawnNumbers
      });

      // ✅ Update DRAW_SESSION (shared state) - Include current_index and draw_count
      const { data: sessionUpdateData, error: sessionError } = await supabase
        .from("draw_sessions")
        .update({
          drawn_numbers: updatedDrawnNumbers,
          current_question_number: drawnNumber,
          current_index: updatedDrawnNumbers.length,  // ✅ NEW: Track current position
          draw_count: updatedDrawnNumbers.length,     // ✅ NEW: Track total drawn
          last_draw_at: new Date().toISOString()      // ✅ NEW: Track last draw time
        })
        .eq("id", drawSessionId!)
        .select("drawn_numbers, current_question_number, current_index, draw_count");

      if (sessionError) {
        console.error("[drawNextQuestion] ❌ Failed to update draw_session:", {
          error: sessionError,
          code: sessionError.code,
          message: sessionError.message,
          details: sessionError.details,
          hint: sessionError.hint
        });
        throw sessionError;
      }

      console.log("[drawNextQuestion] ✅ Draw_session updated successfully:", {
        session_id: drawSessionId,
        returned_data: sessionUpdateData,
        drawn_numbers_count: sessionUpdateData?.[0]?.drawn_numbers?.length || 0,
        current_question: sessionUpdateData?.[0]?.current_question_number,
        current_index: sessionUpdateData?.[0]?.current_index,
        draw_count: sessionUpdateData?.[0]?.draw_count
      });

      // ✅ CRITICAL: Verify the update was persisted
      const { data: verifySession, error: verifyError } = await supabase
        .from("draw_sessions")
        .select("drawn_numbers, current_question_number, current_index, draw_count")
        .eq("id", drawSessionId!)
        .single();

      if (verifyError) {
        console.error("[drawNextQuestion] ❌ Failed to verify draw_session update:", verifyError);
      } else {
        console.log("[drawNextQuestion] 🔍 VERIFICATION - draw_session after update:", {
          session_id: drawSessionId,
          drawn_numbers_count_in_db: verifySession.drawn_numbers?.length || 0,
          drawn_numbers_in_db: verifySession.drawn_numbers,
          current_question_in_db: verifySession.current_question_number,
          current_index_in_db: verifySession.current_index,
          draw_count_in_db: verifySession.draw_count,
          MATCH: verifySession.drawn_numbers?.length === updatedDrawnNumbers.length ? "✅ SUCCESS" : "❌ MISMATCH"
        });

        // ✅ CRITICAL: If verification fails, throw error to prevent inconsistent state
        if (verifySession.drawn_numbers?.length !== updatedDrawnNumbers.length) {
          throw new Error(`draw_session.drawn_numbers verification failed! Expected ${updatedDrawnNumbers.length}, got ${verifySession.drawn_numbers?.length}`);
        }
      }

      // ✅ Update ALL EVENTS in this draw_session (sync drawn_numbers + current states)
      const { error: eventsError } = await supabase
        .from("events")
        .update({
          drawn_numbers: updatedDrawnNumbers,           // ✅ NEW: Sync drawn_numbers array
          current_drawn_number: drawnNumber,
          current_question_number: drawnNumber,
          question_open_until: questionOpenUntil
        })
        .eq("draw_session_id", drawSessionId!);

      if (eventsError) {
        console.error("[drawNextQuestion] ❌ Failed to update events:", eventsError);
        throw eventsError;
      }

      console.log("[drawNextQuestion] ✅ All events updated for session:", drawSessionId);

    } else {
      console.log("[drawNextQuestion] 📍 STANDALONE MODE - Updating single event");

      // ✅ STANDALONE MODE: Update only this event
      const { error: eventUpdateError } = await supabase
        .from("events")
        .update({
          drawn_numbers: updatedDrawnNumbers,
          current_drawn_number: drawnNumber,
          current_question_number: drawnNumber,
          question_open_until: questionOpenUntil
        })
        .eq("id", eventId);

      if (eventUpdateError) {
        console.error("[drawNextQuestion] ❌ Failed to update event:", eventUpdateError);
        throw eventUpdateError;
      }

      console.log("[drawNextQuestion] ✅ Event updated (standalone)");
    }

    // ✅ STEP 8: Mark question as drawn (for this specific event)
    const eventQuestionUpdate: any = { 
      drawn: true, 
      drawn_at: new Date().toISOString() 
    };

    // ✅ CRITICAL: For GLOBAL mode, also set draw_session_id
    if (isGlobalMode && drawSessionId) {
      eventQuestionUpdate.draw_session_id = drawSessionId;
      console.log("[drawNextQuestion] 📝 Setting draw_session_id for event_question:", {
        question_id: questionData.id,
        draw_session_id: drawSessionId
      });
    }

    await supabase
      .from("event_questions")
      .update(eventQuestionUpdate)
      .eq("id", questionData.id);

    console.log("[drawNextQuestion] ✅ Question marked as drawn");

    // ✅ STEP 9: Check for winner (only for this specific event)
    console.log("[drawNextQuestion] 🏆 Checking for winner...");
    await this.checkForWinner(eventId);

    console.log("[drawNextQuestion] ✅ Draw complete:", {
      drawn_number: drawnNumber,
      total_drawn: updatedDrawnNumbers.length,
      mode: isGlobalMode ? "GLOBAL" : "STANDALONE"
    });

    return { question: questionData, questionOpenUntil, drawnNumber };
  },

  async pauseEvent(eventId: string) {
    const { error } = await supabase
      .from("events")
      .update({ status: "paused" })
      .eq("id", eventId);
    
    if (error) throw error;
  },

  async resetEvent(eventId: string) {
    const { error } = await supabase
      .from("events")
      .update({
        status: "draft",
        drawn_numbers: [],
        current_drawn_number: null,
        current_question_number: null,
        winner_ticket_id: null
      })
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
      .select("*, draw_sessions(*)")
      .eq("id", eventId)
      .single();

    if (!event) return null;

    // If winner already exists, don't check again (winner is locked)
    if (event.winner_ticket_id) {
      console.log("[checkForWinner] Winner already exists:", event.winner_ticket_id);
      return { winnerFound: true, winnerSerial: undefined };
    }

    // ✅ GLOBAL MODE: Use draw_session.drawn_numbers
    const isGlobalMode = event.draw_mode === "global" && event.draw_session_id && event.draw_sessions;
    const drawnNumbers = isGlobalMode 
      ? (event.draw_sessions.drawn_numbers || [])
      : (event.drawn_numbers || []);

    console.log("[checkForWinner] Drawn numbers:", {
      mode: isGlobalMode ? "GLOBAL" : "STANDALONE",
      count: drawnNumbers.length,
      numbers: drawnNumbers
    });

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
    return data as unknown as EventQuestion[];
  },

  async getQuestionForNumber(eventId: string, questionNumber: number) {
    const { data, error } = await supabase
      .from("event_questions")
      .select("*, questions(*)")
      .eq("event_id", eventId)
      .eq("question_number", questionNumber)
      .single();
    
    if (error) throw error;
    return data as EventQuestion;
  },

  async getActiveEvent() {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("status", "active")
      .single();
    
    if (error) throw error;
    return data as Event;
  },

  async getActiveOrLastFinished() {
    // First try to get active event
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("status", "active")
      .single();
    
    if (error) {
      const { data: lastFinished, error: lastFinishedError } = await supabase
        .from("events")
        .select("*")
        .eq("status", "finished")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      
      if (lastFinishedError) throw lastFinishedError;
      return { event: lastFinished as Event, mode: "lastFinished" };
    }
    return { event: data as Event, mode: "active" };
  },

  async getDrawnQuestions(eventId: string) {
    const { data, error } = await supabase
      .from("event_questions")
      .select("question_number, questions(id, text, correct_answer)")
      .eq("event_id", eventId)
      .eq("drawn", true);
    
    if (error) throw error;
    
    // Transform to simple map: question_number -> correct_answer
    const correctAnswersMap: Record<number, boolean> = {};
    data.forEach((item: any) => {
      if (item.questions) {
        correctAnswersMap[item.question_number] = item.questions.correct_answer;
      }
    });
    
    return correctAnswersMap;
  },

  /**
   * Get detailed list of all drawn questions for an event (for post-event review)
   * Returns full question data including text, sorted by draw order
   */
  async getDrawnQuestionsDetailed(eventId: string): Promise<Array<{
    number: number;
    text: string;
    correct_answer: boolean;
    drawn_at: string;
  }>> {
    const { data, error } = await supabase
      .from("event_questions")
      .select("question_number, drawn_at, questions(text, correct_answer)")
      .eq("event_id", eventId)
      .eq("drawn", true)
      .order("drawn_at", { ascending: true });
    
    if (error) {
      console.error("[eventService] Failed to get drawn questions detailed:", error);
      throw error;
    }
    
    // Transform to detailed list
    const detailedQuestions = (data || [])
      .filter((item: any) => item.questions) // Filter out any null questions
      .map((item: any) => ({
        number: item.question_number,
        text: item.questions.text,
        correct_answer: item.questions.correct_answer,
        drawn_at: item.drawn_at
      }));
    
    console.log(`[eventService] ✅ Loaded ${detailedQuestions.length} drawn questions for event ${eventId}`);
    return detailedQuestions;
  }
};