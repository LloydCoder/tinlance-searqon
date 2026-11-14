import { BlockList, isIP } from "node:net";

const blockedIPv4 = new BlockList();
const blockedIPv4Ranges = [
  ["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],
  ["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],
  ["192.88.99.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],
  ["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]
];
for (const [network,prefix] of blockedIPv4Ranges) blockedIPv4.addSubnet(network,prefix,"ipv4");

const blockedIPv6 = new BlockList();
const blockedIPv6Ranges = [
  ["::",128],["::1",128],["::ffff:0:0",96],["64:ff9b::",96],["64:ff9b:1::",48],
  ["100::",64],["2001::",23],["2001:db8::",32],["2002::",16],["3fff::",20],["fc00::",7],
  ["fe80::",10],["ff00::",8]
];
for (const [network,prefix] of blockedIPv6Ranges) blockedIPv6.addSubnet(network,prefix,"ipv6");
const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::",3,"ipv6");

const RESERVED_HOST_SUFFIXES = [".localhost",".local",".internal",".test",".example",".invalid",".onion"];

export function isPublicIp(address) {
  const family=isIP(address);
  if (family===4) return !blockedIPv4.check(address,"ipv4");
  if (family===6) return globalIPv6.check(address,"ipv6") && !blockedIPv6.check(address,"ipv6");
  return false;
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g,"");
}

/**
 * Validate an HTTP(S) destination before DNS resolution or connection.
 * This is a policy primitive only; it does not perform network I/O.
 */
export function validateTargetUrl(value) {
  if (typeof value!=="string" || value.length>8192) throw new TypeError("Target URL must be a string of at most 8192 characters");
  let url;
  try { url=new URL(value); }
  catch { throw new TypeError("Target must be an absolute HTTP or HTTPS URL"); }
  if (url.protocol!=="http:" && url.protocol!=="https:") throw new TypeError("Only HTTP or HTTPS targets are allowed");
  if (url.username || url.password) throw new TypeError("Target URLs must not contain credentials");
  const hostname=normalizeHostname(url.hostname);
  if (!hostname || hostname.endsWith(".")) throw new TypeError("Target hostname is invalid");
  const family=isIP(hostname);
  if (family) {
    if (!isPublicIp(hostname)) throw new TypeError("Target IP address is non-public or reserved");
  } else {
    if (!hostname.includes(".") || RESERVED_HOST_SUFFIXES.some(suffix=>hostname===suffix.slice(1) || hostname.endsWith(suffix))) {
      throw new TypeError("Local, single-label, and reserved hostnames are not allowed");
    }
  }
  url.hash="";
  return Object.freeze({
    href:url.href,
    protocol:url.protocol,
    hostname,
    port:url.port,
    isIpLiteral:Boolean(family)
  });
}

/**
 * Validate every DNS answer, not just the first. A real connector must pin the
 * selected validated address at socket creation to close the rebinding window.
 */
export function validateResolvedAddresses(hostname, addresses) {
  if (typeof hostname!=="string" || !hostname.trim()) throw new TypeError("Resolved hostname is required");
  if (!Array.isArray(addresses) || addresses.length===0) throw new TypeError("DNS resolution must return at least one address");
  const seen=new Set();
  const validated=[];
  for (const record of addresses) {
    if (!record || typeof record.address!=="string") throw new TypeError("DNS answer must include an IP address");
    const family=isIP(record.address);
    if (!family || record.family!==family) throw new TypeError("DNS answer address family does not match its IP address");
    if (!isPublicIp(record.address)) throw new TypeError("DNS answer contains a non-public or reserved address");
    const key=record.address.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      validated.push(Object.freeze({address:record.address,family}));
    }
  }
  return Object.freeze(validated);
}

/** Validate every redirect destination independently before following it. */
export function resolveRedirectTarget(currentUrl, location) {
  const base=validateTargetUrl(currentUrl);
  if (typeof location!=="string" || !location.trim()) throw new TypeError("Redirect location is required");
  let target;
  try { target=new URL(location,base.href); }
  catch { throw new TypeError("Redirect target is not a valid URL"); }
  return validateTargetUrl(target.href);
}
