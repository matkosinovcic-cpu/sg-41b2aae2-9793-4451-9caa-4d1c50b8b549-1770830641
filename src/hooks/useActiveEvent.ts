import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Event } from "@/services/eventService";

interface UseActiveEventReturn {
  event: Event | null;
  isLoading: boolean;
  realtimeStatus: "connected" | "disconnected" | "connecting";
  error: string | null;
}

/**
 * Shared hook for tracking the currently ACTIVE event
 * - Fetches most recent active event on mount
 * - Subscribes to realtime updates for that event
 * - Auto-switches when a new event becomes active
 * - Provides fallback polling if realtime disconnects
 */
export function useActiveEvent(): UseActiveEventReturn {
  const [event, setEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [realtimeStatus, setRealtimeStatus] = useState<"connected" | "disconnected" | "connecting">("connecting");
  const [error, setError] = useState<string | null>(null);
  
  const channelRef = useRef<any>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastRealtimeUpdateRef = useRef(Date.now());

  // Fetch active event
  const fetchActiveEvent = async (): Promise<Event | null> => {
    try {
      const { data, error: fetchError } = await supabase
        .from("events")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        console.error("[useActiveEvent] Fetch error:", fetchError);
        setError(fetchError.message);
        return null;
      }

      return data as unknown as Event;
    } catch (err) {
      console.error("[useActiveEvent] Exception:", err);
      setError(String(err));
      return null;
    }
  };

  // Start polling (fallback only)
  const startPolling = () => {
    if (pollingIntervalRef.current) return; // Already polling
    
    console.log("[useActiveEvent] 🔄 Starting polling fallback (1s interval)");
    
    pollingIntervalRef.current = setInterval(async () => {
      const timeSinceRealtime = Date.now() - lastRealtimeUpdateRef.current;
      
      // Only poll if realtime is stale (> 5s)
      if (timeSinceRealtime < 5000) {
        return; // Realtime is fresh, skip polling
      }
      
      console.log("[useActiveEvent] 📊 Polling (realtime stale)");
      const activeEvent = await fetchActiveEvent();
      
      if (activeEvent) {
        setEvent(activeEvent);
        setError(null);
      }
    }, 1000); // 1s interval for fast fallback
  };

  // Stop polling
  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      console.log("[useActiveEvent] ⏹️ Stopping polling");
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  // Setup realtime subscription
  useEffect(() => {
    console.log("[useActiveEvent] 🚀 Initializing...");
    
    // 1. Fetch initial active event
    const init = async () => {
      const activeEvent = await fetchActiveEvent();
      
      if (activeEvent) {
        setEvent(activeEvent);
        setError(null);
      } else {
        setError("No active event found");
      }
      
      setIsLoading(false);
    };
    
    init();
    
    // 2. Subscribe to ALL events with status='active'
    // This catches both updates to current active event AND new events becoming active
    const channel = supabase
      .channel("active-event-watcher")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "events",
        filter: "status=eq.active"
      }, (payload) => {
        console.log("[useActiveEvent] 📡 Realtime update:", payload.eventType);
        lastRealtimeUpdateRef.current = Date.now();
        
        if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
          const newEvent = payload.new as unknown as Event;
          
          // Update event (will auto-switch if different event becomes active)
          setEvent(newEvent);
          setError(null);
          
          console.log("[useActiveEvent] ✅ Event updated:", {
            id: newEvent.id.slice(0, 8),
            name: newEvent.name,
            status: newEvent.status,
            currentNumber: newEvent.current_drawn_number
          });
        }
      })
      .subscribe((status) => {
        console.log("[useActiveEvent] 📡 Subscription status:", status);
        
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("connected");
          stopPolling(); // Realtime works, stop polling
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtimeStatus("disconnected");
          startPolling(); // Realtime failed, start polling
        } else {
          setRealtimeStatus("connecting");
        }
      });
    
    channelRef.current = channel;
    
    // 3. Start polling as backup (will auto-stop when realtime connects)
    startPolling();
    
    // Cleanup
    return () => {
      console.log("[useActiveEvent] 🧹 Cleanup");
      if (channelRef.current) {
        channelRef.current.unsubscribe();
      }
      stopPolling();
    };
  }, []); // Run once on mount

  return {
    event,
    isLoading,
    realtimeStatus,
    error
  };
}