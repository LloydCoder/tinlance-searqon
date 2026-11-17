import test from "node:test";
import assert from "node:assert/strict";
import { createVercelHandler } from "../api/index.js";

test("Vercel adapter forwards the original Node request and response to the application server", () => {
  const calls = [];
  const server = {
    emit(event, request, response) {
      calls.push({ event, request, response });
      return true;
    }
  };
  const request = { method: "GET", url: "/api/v1/health" };
  const response = { statusCode: 200 };

  const handler = createVercelHandler(server);
  const result = handler(request, response);

  assert.equal(result, true);
  assert.deepEqual(calls, [{ event: "request", request, response }]);
});

test("Vercel adapter rejects invalid server instances at construction", () => {
  assert.throws(() => createVercelHandler(null), /server.*emit/i);
  assert.throws(() => createVercelHandler({}), /server.*emit/i);
});
