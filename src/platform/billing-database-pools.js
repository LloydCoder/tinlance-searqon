import { Pool } from "pg";

const LOOPBACK=new Set(["localhost","127.0.0.1","::1","[::1]"]);

export function createBillingDatabasePool(connectionString,{role,max=2}={}) {
  if(typeof connectionString!=="string" || connectionString.length===0
    || typeof role!=="string" || !["ingest","worker"].includes(role)
    || !Number.isSafeInteger(max) || max<1 || max>10) {
    throw new TypeError("A valid dedicated billing database connection is required.");
  }
  let parsed;
  try { parsed=new URL(connectionString); }
  catch { throw new TypeError("The dedicated billing database URL is invalid."); }
  if(!["postgres:","postgresql:"].includes(parsed.protocol)) {
    throw new TypeError("The dedicated billing database URL must use PostgreSQL.");
  }
  const sslmode=parsed.searchParams.get("sslmode");
  if(!LOOPBACK.has(parsed.hostname) && !["verify-ca","verify-full"].includes(sslmode)) {
    throw new TypeError("Remote billing database URLs must require certificate-verified TLS (sslmode=verify-full or verify-ca).");
  }
  return new Pool({
    connectionString,
    max,
    connectionTimeoutMillis:5000,
    idleTimeoutMillis:30000,
    allowExitOnIdle:false
  });
}
