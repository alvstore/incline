import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPA_URL, SERVICE_KEY);

const MIPS_SERVER_URL = Deno.env.get("MIPS_SERVER_URL") || "http://212.38.94.228:9000";
const MIPS_USERNAME = Deno.env.get("MIPS_USERNAME") || "admin";
const MIPS_PASSWORD = Deno.env.get("MIPS_PASSWORD") || "Incline@3003";

async function getRuoYiToken() {
  const res = await fetch(`${MIPS_SERVER_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "TENANT-ID": "1" },
    body: JSON.stringify({ username: MIPS_USERNAME, password: MIPS_PASSWORD }),
  });
  const json = await res.json();
  if (json.code !== 200 && json.code !== 0) throw new Error(`Login failed: ${json.msg}`);
  return json.token || json.data?.token;
}

async function audit() {
  console.log("--- MIPS GATE 1 AUDIT START ---");
  try {
    const token = await getRuoYiToken();
    console.log("MIPS Auth successful.");

    // 1. Fetch live device list
    const devRes = await fetch(`${MIPS_SERVER_URL}/through/device/list`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}`, "TENANT-ID": "1" }
    });
    const devJson = await devRes.json();
    const rows = devJson?.rows || devJson?.data || [];
    console.log(`MIPS Server Devices (${rows.length}):`);
    rows.forEach((d: any) => {
      console.log(` - ID: ${d.id}, SN: ${d.deviceKey}, Name: ${d.deviceName}, Online: ${d.onlineFlag}`);
    });

    // 2. Fetch DB devices
    const { data: dbDevices } = await supabase.from("access_devices").select("*");
    console.log(`\nCRM Database Devices (${dbDevices?.length || 0}):`);
    dbDevices?.forEach((d: any) => {
      console.log(` - LocalID: ${d.id}, MIPS_ID: ${d.mips_device_id}, Name: ${d.device_name}, SN: ${d.serial_number}, Online: ${d.is_online}`);
    });

    // 3. Check for mismatch
    const gate1 = dbDevices?.find(d => d.device_name.includes("Gate 1") || d.mips_device_id === 24);
    if (gate1) {
      console.log(`\nGate 1 Analysis:`);
      const mipsMatch = rows.find((r: any) => r.id === gate1.mips_device_id || r.deviceKey === gate1.serial_number);
      if (mipsMatch) {
        console.log(` Match found on server! Server Online Flag: ${mipsMatch.onlineFlag}`);
        if (mipsMatch.onlineFlag !== 1) {
          console.warn(" CRITICAL: Gate 1 is OFFLINE on MIPS server.");
        }
      } else {
        console.error(" CRITICAL: Gate 1 NOT FOUND in MIPS server device list.");
      }
    }

    // 4. Fetch recent errors
    const { data: errors } = await supabase
      .from("mips_sync_attempts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);
    
    console.log("\nRecent MIPS Sync Errors:");
    errors?.forEach((e: any) => {
      console.log(` - ${e.created_at}: [${e.operation}] ${e.last_error}`);
    });

  } catch (err) {
    console.error("Audit failed:", err);
  }
}

audit();
