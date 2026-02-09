import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function runDiagnostics() {
  console.log("🔍 STARTING RPC DIAGNOSTICS...");
  console.log(`URL: ${supabaseUrl}`);

  // 1. Get Venue "boiler"
  console.log("\n1️⃣ Resolving Venue 'boiler'...");
  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .select("id, name, slug")
    .eq("slug", "boiler")
    .single();

  if (venueError) {
    console.error("❌ Failed to get venue:", venueError);
    return;
  }
  console.log("✅ Venue found:", venue);

  // 2. Get Active Event for Venue
  console.log("\n2️⃣ Resolving Active Event...");
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, name, status, venue_id")
    .eq("venue_id", venue.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (eventError) {
    console.error("❌ Failed to get active event:", eventError);
    // Try to get ANY active event for debug
    const { data: anyEvent } = await supabase.from("events").select("*").eq("status", "active").limit(1);
    console.log("DEBUG: Any active event:", anyEvent);
    return;
  }
  console.log("✅ Active Event found:", event);

  // 3. Call RPC claim_free_tickets_v3
  console.log("\n3️⃣ Testing RPC: claim_free_tickets_v3...");
  const params = {
    p_event_id: event.id,
    p_venue_id: venue.id,
    p_email: "diagnostic_test@example.com",
    p_nickname: "Dr. Diagnostics",
    p_limit: 1
  };
  console.log("Params:", params);

  const { data: rpcData, error: rpcError } = await supabase.rpc("claim_free_tickets_v3", params);

  if (rpcError) {
    console.error("\n🚨 RPC FAILED WITH ERROR:");
    console.error("--------------------------------------------------");
    console.error("Code:    ", rpcError.code);
    console.error("Message: ", rpcError.message);
    console.error("Details: ", rpcError.details);
    console.error("Hint:    ", rpcError.hint);
    console.error("--------------------------------------------------");
  } else {
    console.log("\n✅ RPC SUCCESS:");
    console.log(JSON.stringify(rpcData, null, 2));
  }
}

runDiagnostics();