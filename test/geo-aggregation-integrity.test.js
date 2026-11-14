import test from "node:test";
import assert from "node:assert/strict";
import { analyzeGeoObservation, aggregateGeoObservations } from "../src/geo.js";

const sample = {
  prompt:"Recommend a payments API.",
  answer:"Acme is a strong choice. Acme offers reliable APIs.",
  brand:"Acme",
  targetDomain:"acme.example",
  citations:["https://docs.acme.example/guide"],
  provider:{name:"Consumer Search UI",observationClass:"consumer_observation",region:"US",locale:"en-US"},
  sampledAt:"2026-11-14T12:00:00.000Z"
};

test("GEO aggregation separates different brands and target domains", () => {
  const a=analyzeGeoObservation(sample);
  const b=analyzeGeoObservation({...sample,brand:"Beta",targetDomain:"beta.example",answer:"Beta is another platform.",citations:["https://docs.beta.example/"]});
  const groups=aggregateGeoObservations([a,b]);
  assert.equal(groups.length,2);
  assert.deepEqual(new Set(groups.map(group=>group.brand)),new Set(["Acme","Beta"]));
});

test("GEO aggregation rejects inconsistent observation counters", () => {
  const result=analyzeGeoObservation(sample);
  assert.throws(()=>aggregateGeoObservations([{...result,mentionCount:0}]),/mention count/);
  assert.throws(()=>aggregateGeoObservations([{...result,citationCount:0}]),/citation count/);
});

test("GEO aggregation rejects malformed provider and evidence provenance", () => {
  const result=analyzeGeoObservation(sample);
  assert.throws(()=>aggregateGeoObservations([{...result,provider:{name:" "}}]),/provider metadata/);
  assert.throws(()=>aggregateGeoObservations([{...result,evidence:{...result.evidence,id:"bad"}}]),/evidence provenance/);\n  assert.throws(()=>aggregateGeoObservations([{...result,brandCited:false}]),/brand citation state/);\n  assert.throws(()=>aggregateGeoObservations([{...result,citations:[{url:"https://other.example/",domain:"docs.acme.example"}]}]),/citation URL/);
});

test("GEO aggregation does not pool distinct models, regions, or locales", () => {
  const a=analyzeGeoObservation(sample);
  const b=analyzeGeoObservation({...sample,provider:{name:"Consumer Search UI",observationClass:"consumer_observation",model:"variant-b",region:"EU",locale:"fr-FR"}});
  const groups=aggregateGeoObservations([a,b]);
  assert.equal(groups.length,2);
  assert.ok(groups.every(group=>group.provider && typeof group.provider==="object"));
});
