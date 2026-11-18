import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { fetchPublicUrl } from "../src/security/fetch.js";

function fakeTransport(responses, seen = []) {
  return (url, options, callback) => {
    seen.push({ url: url.href, options });
    const request = new EventEmitter();
    request.end = () => {
      const next = responses.shift();
      if (next instanceof Error) {
        process.nextTick(() => request.emit("error", next));
        return;
      }
      const response = Readable.from([Buffer.from(next.body ?? "")]);
      response.statusCode = next.status ?? 200;
      response.headers = next.headers ?? { "content-type": "text/plain" };
      process.nextTick(() => callback(response));
    };
    request.destroy = error => {
      if (error) process.nextTick(() => request.emit("error", error));
    };
    request.setTimeout = () => request;
    return request;
  };
}

const publicResolver = async hostname => {
  assert.equal(hostname, "example.com");
  return [{ address: "93.184.216.34", family: 4 }];
};

test("fetch pins the validated DNS answer and returns bounded response metadata", async () => {
  const seen = [];
  const result = await fetchPublicUrl("https://example.com/docs", {
    resolver: publicResolver,
    requestImpl: fakeTransport([{ body: "hello" }], seen)
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.toString(), "hello");
  assert.equal(result.finalUrl, "https://example.com/docs");
  assert.equal(seen[0].options.agent, false);
  assert.equal(seen[0].options.headers["accept-encoding"], "identity");
  assert.match(seen[0].options.headers["user-agent"], /SearqonBot\/0.2/);
  await new Promise((resolve, reject) => {
    seen[0].options.lookup("example.com", { family: 4 }, (error, address, family) => {
      if (error) return reject(error);
      try {
        assert.equal(address, "93.184.216.34");
        assert.equal(family, 4);
        resolve();
      } catch (assertion) { reject(assertion); }
    });
  });
});

test("fetch revalidates and re-resolves every redirect hop", async () => {
  const seen = [];
  let resolutions = 0;
  const result = await fetchPublicUrl("https://example.com/start", {
    resolver: async () => { resolutions++; return [{ address: "93.184.216.34", family: 4 }]; },
    requestImpl: fakeTransport([
      { status: 302, headers: { location: "/next" }, body: "" },
      { status: 200, body: "ok" }
    ], seen)
  });
  assert.equal(result.redirects, 1);
  assert.equal(result.finalUrl, "https://example.com/next");
  assert.equal(resolutions, 2);
  assert.equal(seen.length, 2);
});

test("fetch rejects redirects to private or non-HTTP destinations before a second request", async () => {
  const seen = [];
  await assert.rejects(() => fetchPublicUrl("https://example.com/start", {
    resolver: publicResolver,
    requestImpl: fakeTransport([
      { status: 302, headers: { location: "http://127.0.0.1/admin" } }
    ], seen)
  }), /non-public/);
  assert.equal(seen.length, 1);
});

test("fetch rejects non-standard ports and unsupported schemes", async () => {
  await assert.rejects(() => fetchPublicUrl("https://example.com:8443/"), /ports 80 and 443/);
  await assert.rejects(() => fetchPublicUrl("file:///etc/passwd"), /HTTP or HTTPS/);
});

test("fetch enforces response byte limits while streaming", async () => {
  await assert.rejects(() => fetchPublicUrl("https://example.com/large", {
    resolver: publicResolver,
    maxBytes: 4,
    requestImpl: fakeTransport([{ body: "12345" }])
  }), /response exceeds/);
});

test("fetch rejects unexpected content encoding instead of returning compressed bytes", async () => {
  await assert.rejects(() => fetchPublicUrl("https://example.com/compressed", {
    resolver: publicResolver,
    requestImpl: fakeTransport([{ body: "bytes", headers: { "content-encoding": "gzip" } }])
  }), /content encoding/);
});

test("fetch rejects excessive redirect chains", async () => {
  const responses = Array.from({ length: 4 }, () => ({ status: 302, headers: { location: "/again" } }));
  await assert.rejects(() => fetchPublicUrl("https://example.com/start", {
    resolver: publicResolver,
    maxRedirects: 2,
    requestImpl: fakeTransport(responses)
  }), /redirect limit/);
});

test("fetch blocks HTTPS-to-HTTP redirect downgrade", async () => {
  await assert.rejects(() => fetchPublicUrl("https://example.com/secure", {
    resolver: publicResolver,
    requestImpl: fakeTransport([{ status: 302, headers: { location: "http://example.com/insecure" } }])
  }), /downgrade/);
});

test("fetch rejects invalid or oversized declared content lengths before buffering", async () => {
  await assert.rejects(() => fetchPublicUrl("https://example.com/large", {
    resolver: publicResolver,
    maxBytes: 4,
    requestImpl: fakeTransport([{ body: "", headers: { "content-length": "5" } }])
  }), /byte limit/);
  await assert.rejects(() => fetchPublicUrl("https://example.com/invalid-length", {
    resolver: publicResolver,
    requestImpl: fakeTransport([{ body: "", headers: { "content-length": "not-a-number" } }])
  }), /invalid content length/);
});

test("fetch rejects socket inactivity timeouts", async () => {
  const requestImpl = () => {
    const request = new EventEmitter();
    request.setTimeout = (_duration, callback) => process.nextTick(callback);
    request.destroy = error => process.nextTick(() => request.emit("error", error));
    request.end = () => {};
    return request;
  };
  await assert.rejects(() => fetchPublicUrl("https://example.com/slow", {
    resolver: publicResolver,
    requestImpl
  }), /timed out/);
});


test("fetch bounds DNS resolution time", async () => {
  await assert.rejects(() => fetchPublicUrl("https://example.com/dns-slow", {
    dnsTimeoutMs: 100,
    resolver: () => new Promise(() => {}),
    requestImpl: fakeTransport([{ body: "should not be requested" }])
  }), /DNS resolution timed out/);
});


test("fetch awaits a redirect policy check before resolving the next host", async () => {
  const seen = [];
  let checked = 0;
  await assert.rejects(() => fetchPublicUrl("https://example.com/start", {
    resolver: publicResolver,
    requestImpl: fakeTransport([{ status: 302, headers: { location: "https://other.example.com/private" } }], seen),
    validateRedirect: async context => {
      checked++;
      assert.equal(context.from, "https://example.com/start");
      assert.equal(context.to, "https://other.example.com/private");
      assert.equal(context.redirectCount, 1);
      return false;
    }
  }), error => error.code === "ERR_REDIRECT_POLICY");
  assert.equal(checked, 1);
  assert.equal(seen.length, 1);
});


test("fetch enforces a hard deadline while waiting for response headers", async () => {
  const requestImpl = () => {
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.end = () => {};
    request.destroy = error => process.nextTick(() => request.emit("error", error));
    return request;
  };
  await assert.rejects(() => fetchPublicUrl("https://example.com/headers-slow", {
    resolver: publicResolver,
    timeoutMs: 100,
    requestImpl
  }), /timed out/);
});

test("fetch enforces a hard deadline while streaming a response body", async () => {
  let incoming;
  const requestImpl = (_url, _options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.end = () => {
      incoming = new Readable({ read() {} });
      incoming.statusCode = 200;
      incoming.headers = { "content-type": "text/plain" };
      process.nextTick(() => callback(incoming));
    };
    request.destroy = error => {
      if (error) incoming?.destroy(error);
      else incoming?.destroy();
      if (error) process.nextTick(() => request.emit("error", error));
    };
    return request;
  };
  await assert.rejects(() => fetchPublicUrl("https://example.com/body-slow", {
    resolver: publicResolver,
    timeoutMs: 100,
    requestImpl
  }), /timed out/);
});

test("fetch blocks DNS rebinding when a redirect hop resolves to a private address", async () => {
  const seen = [];
  let resolutions = 0;
  const resolver = async hostname => {
    assert.equal(hostname, "example.com");
    resolutions++;
    return resolutions === 1
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "10.0.0.7", family: 4 }];
  };

  await assert.rejects(() => fetchPublicUrl("https://example.com/start", {
    resolver,
    requestImpl: fakeTransport([
      { status: 302, headers: { location: "/next" } },
      { status: 200, body: "must never be requested" }
    ], seen)
  }), /non-public/);

  assert.equal(resolutions, 2);
  assert.equal(seen.length, 1);
});

test("fetch blocks a redirect to a different hostname that resolves to a private address", async () => {
  const seen = [];
  const resolver = async hostname => hostname === "example.com"
    ? [{ address: "93.184.216.34", family: 4 }]
    : [{ address: "192.168.1.20", family: 4 }];

  await assert.rejects(() => fetchPublicUrl("https://example.com/start", {
    resolver,
    requestImpl: fakeTransport([
      { status: 302, headers: { location: "https://internal.example.net/admin" } }
    ], seen)
  }), /non-public/);

  assert.equal(seen.length, 1);
});


test("fetch sends the exact caller-selected crawler product token", async () => {
  const seen = [];
  await fetchPublicUrl("https://example.com/docs", {
    userAgent: "CustomBot",
    resolver: publicResolver,
    requestImpl: fakeTransport([{ body: "ok" }], seen)
  });
  assert.match(seen[0].options.headers["user-agent"], /CustomBot\/0.2/);
  assert.equal(seen[0].options.headers["user-agent"].includes("SearqonBot"), false);
});

test("fetch rejects malformed crawler product tokens before DNS or network access", async () => {
  for (const userAgent of ["Bad Bot", "Bot2"]) {
    let contacted = false;
    await assert.rejects(() => fetchPublicUrl("https://example.com/docs", {
      userAgent,
      resolver: async () => { contacted = true; return [{ address: "93.184.216.34", family: 4 }]; },
      requestImpl: fakeTransport([{ body: "must not fetch" }])
    }), /crawler product token/);
    assert.equal(contacted, false);
  }
});
