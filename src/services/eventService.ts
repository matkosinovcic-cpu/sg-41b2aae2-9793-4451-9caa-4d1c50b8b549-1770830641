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
  current_question_number: number | null;
  question_open_until: string | null;
  winner_ticket_id: string | null;
  created_at: string;
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
      .insert({ name, status: "draft" })
      .select()
      .single();
    
    if (error) throw error;
    return data as Event;
  },

  async getAllEvents() {
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
    const { data: allQuestions, error: questionsError } = await supabase
      .from("questions")
      .select("id");
    
    if (questionsError) throw questionsError;
    
    const availableCount = allQuestions.length;
    const questionCount = Math.min(availableCount, 90);

    if (availableCount === 0) {
      throw new Error("No questions available in the pool. Please create some questions first.");
    }

    // Shuffle ALL questions randomly using Fisher-Yates algorithm
    const shuffled = [...allQuestions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    // Take first N questions from the shuffled array
    const selected = shuffled.slice(0, questionCount);

    // Create shuffled sequence of question numbers (1..90 in random order)
    const questionNumbers = Array.from({ length: questionCount }, (_, i) => i + 1);
    for (let i = questionNumbers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questionNumbers[i], questionNumbers[j]] = [questionNumbers[j], questionNumbers[i]];
    }

    // Map shuffled question IDs to shuffled question numbers
    const eventQuestions = selected.map((q, index) => ({
      event_id: eventId,
      question_number: questionNumbers[index], // Random number from 1..90
      question_id: q.id,
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

  async getEventTickets(eventId: string) {
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    
    if (error) throw error;
    return data as Ticket[];
  },

  async startEvent(eventId: string) {
    const { error } = await supabase
      .from("events")
      .update({ status: "active" })
      .eq("id", eventId);
    
    if (error) throw error;
  },

  async drawNextQuestion(eventId: string) {
    const { data: event } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (!event) throw new Error("Event not found");

    const { data: undrawnQuestions } = await supabase
      .from("event_questions")
      .select("*, questions(*)")
      .eq("event_id", eventId)
      .eq("drawn", false)
      .order("question_number", { ascending: true })
      .limit(1);

    if (!undrawnQuestions || undrawnQuestions.length === 0) {
      throw new Error("No more questions available");
    }

    const nextQuestion = undrawnQuestions[0];
    const questionOpenUntil = new Date(Date.now() + 10000).toISOString();

    await supabase
      .from("event_questions")
      .update({ drawn: true, drawn_at: new Date().toISOString() })
      .eq("id", nextQuestion.id);

    await supabase
      .from("events")
      .update({
        current_question_number: nextQuestion.question_number,
        question_open_until: questionOpenUntil
      })
      .eq("id", eventId);

    return { question: nextQuestion, questionOpenUntil };
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

  async checkForWinner(eventId: string) {
    const { data: tickets } = await supabase
      .from("tickets")
      .select("*, ticket_questions(*)")
      .eq("event_id", eventId);

    if (!tickets) return null;

    const { data: drawnQuestions } = await supabase
      .from("event_questions")
      .select("question_number")
      .eq("event_id", eventId)
      .eq("drawn", true);

    if (!drawnQuestions) return null;

    const drawnNumbers = new Set(drawnQuestions.map(q => q.question_number));

    for (const ticket of tickets) {
      const ticketNumbers = ticket.ticket_questions.map((tq: TicketQuestion) => tq.question_number);
      const allDrawn = ticketNumbers.every(num => drawnNumbers.has(num));

      if (allDrawn) {
        await supabase
          .from("tickets")
          .update({ is_winner: true })
          .eq("id", ticket.id);

        await supabase
          .from("events")
          .update({ 
            status: "finished",
            winner_ticket_id: ticket.id 
          })
          .eq("id", eventId);

        return ticket;
      }
    }

    return null;
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
  }
};