import test from "node:test";
import assert from "node:assert/strict";
import { resolvePublicHost, createPinnedLookup } from "../src/security/url-policy.js";

test("public DNS resolver validates every answer before returning it", async () => {
  const answers=[{address:"8.8.8.8",family:4},{address:"2606:4700:4700::1111",family:6}];
  const resolved=await resolvePublicHost("example.com",async (host,options) => {
    assert.equal(host,"example.com");
    assert.equal(options.all,true);
    return answers;
  });
  assert.deepEqual(resolved,answers);
});

test("public DNS resolver rejects mixed public and private answers", async () => {
  await assert.rejects(()=>resolvePublicHost("example.com",async()=>[{address:"8.8.8.8",family:4},{address:"127.0.0.1",family:4}]),/non-public/);
});

test("public DNS resolver validates the hostname before resolution", async () => {
  await assert.rejects(()=>resolvePublicHost("metadata.google.internal",async()=>[{address:"8.8.8.8",family:4}]),/reserved hostnames/);
});

test("pinned lookup returns only the validated address and never resolves again", () => {
  const lookup=createPinnedLookup("example.com",[{address:"8.8.8.8",family:4},{address:"2606:4700:4700::1111",family:6}]);
  lookup("example.com",{family:4},(error,address,family)=>{
    assert.equal(error,null);
    assert.equal(address,"8.8.8.8");
    assert.equal(family,4);
  });
  lookup("example.com",{all:true},(error,addresses)=>{
    assert.equal(error,null);
    assert.deepEqual(addresses,[{address:"8.8.8.8",family:4},{address:"2606:4700:4700::1111",family:6}]);
  });
});

test("pinned lookup rejects hostname substitution and unsupported address families", () => {
  const lookup=createPinnedLookup("example.com",[{address:"8.8.8.8",family:4}]);
  lookup("attacker.example",{family:4},error=>assert.equal(error.code,"ENOTFOUND"));
  lookup("example.com",{family:6},error=>assert.equal(error.code,"ENOTFOUND"));
});
