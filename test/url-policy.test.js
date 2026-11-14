import test from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, validateTargetUrl, validateResolvedAddresses, resolveRedirectTarget } from "../src/security/url-policy.js";

test("public IPv4 and IPv6 addresses are recognized", () => {
  assert.equal(isPublicIp("8.8.8.8"),true);
  assert.equal(isPublicIp("2606:4700:4700::1111"),true);
});

test("private, loopback, link-local, reserved, multicast and metadata ranges are rejected", () => {
  for (const address of ["0.0.0.0","10.0.0.1","100.64.0.1","127.0.0.1","169.254.169.254","172.16.0.1","192.0.2.1","192.168.1.1","198.18.0.1","198.51.100.1","203.0.113.1","224.0.0.1","240.0.0.1"]) {
    assert.equal(isPublicIp(address),false,address);
  }
  for (const address of ["::","::1","::ffff:127.0.0.1","64:ff9b::a00:1","100::1","2001:db8::1","2002:7f00:1::1","fc00::1","fe80::1","ff02::1","3fff::1"]) {
    assert.equal(isPublicIp(address),false,address);
  }
});

test("target URL parser rejects non-HTTP schemes, credentials and local hostnames", () => {
  for (const value of ["file:///etc/passwd","ftp://example.com","https://user:pass@example.com","http://localhost","http://service.local","http://metadata.google.internal","http://printer","http://127.0.0.1","http://2130706433","http://0x7f000001","http://169.254.169.254"]) {
    assert.throws(()=>validateTargetUrl(value),undefined,value);
  }
});

test("target URL parser normalizes public destinations and drops fragments", () => {
  const result=validateTargetUrl("https://Example.COM/docs?q=1#fragment");
  assert.equal(result.hostname,"example.com");
  assert.equal(result.href,"https://example.com/docs?q=1");
  assert.equal(result.protocol,"https:");
  assert.equal(result.isIpLiteral,false);
});

test("hostname labels reject underscores and leading or trailing hyphens", () => {
  for (const value of ["https://foo_bar.example.com","https://-bad.example.com","https://bad-.example.com"]) assert.throws(()=>validateTargetUrl(value),/hostname labels/);
});

test("DNS answers must all be public and match their declared address families", () => {
  const valid=validateResolvedAddresses("example.com",[{address:"8.8.8.8",family:4},{address:"2606:4700:4700::1111",family:6}]);
  assert.equal(valid.length,2);
  assert.throws(()=>validateResolvedAddresses("example.com",[{address:"8.8.8.8",family:4},{address:"10.0.0.1",family:4}]),/non-public/);
  assert.throws(()=>validateResolvedAddresses("example.com",[{address:"8.8.8.8",family:6}]),/family/);
  assert.throws(()=>validateResolvedAddresses("example.com",[]),/at least one/);
});

test("redirect targets are revalidated against the same destination policy", () => {
  assert.equal(resolveRedirectTarget("https://example.com/a","../b").href,"https://example.com/b");
  assert.throws(()=>resolveRedirectTarget("https://example.com/a","http://127.0.0.1/admin"),/non-public/);
  assert.throws(()=>resolveRedirectTarget("https://example.com/a","file:///etc/passwd"),/HTTP or HTTPS/);
});


test("Azure WireServer platform address is blocked as a cloud-internal destination", () => {
  assert.equal(isPublicIp("168.63.129.16"), false);
  assert.throws(() => validateTargetUrl("http://168.63.129.16/metadata"), /non-public/);
  assert.throws(() => validateResolvedAddresses("metadata.azure.internal", [{ address: "168.63.129.16", family: 4 }]), /non-public/);
});

test("additional special-use and local naming suffixes are rejected", () => {
  for (const value of [
    "https://router.home.arpa/",
    "https://service.lan/",
    "https://service.corp/",
    "https://service.intranet/",
    "https://service.alt/"
  ]) {
    assert.throws(() => validateTargetUrl(value), /reserved hostnames/);
  }
});
