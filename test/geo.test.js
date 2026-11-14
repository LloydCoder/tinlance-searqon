import test from "node:test";
import assert from "node:assert/strict";
import { analyzeGeoObservation, aggregateGeoObservations } from "../src/geo.js";

const consumer = {
  prompt:"Which provider would you recommend for a payments API?",
  answer:"Acme is a strong choice. Acme offers reliable APIs.",
  brand:"Acme",
  targetDomain:"acme.example",
  citations:["https://docs.acme.example/guide","https://review.example/acme"],
  provider:{name:"Consumer Search UI",observationClass:"consumer_observation",region:"US",locale:"en-US"},
  sampledAt:"2026-11-14T12:00:00.000Z"
};

test("GEO observation preserves channel provenance and detects brand mentions/citations", () => {
  const result=analyzeGeoObservation(consumer);
  assert.equal(result.type,"geo_observation");
  assert.equal(result.observationClass,"consumer_observation");
  assert.equal(result.mentionCount,2);
  assert.equal(result.mentioned,true);
  assert.equal(result.citationCount,2);
  assert.equal(result.brandCited,true);
  assert.equal(result.evidence.observationClass,"consumer_observation");
  assert.equal(result.evidence.acquisitionMethod,"provider_observation");
  assert.equal(result.evidence.sha256.length,64);
  assert.equal("prompt" in result,false);
  assert.equal("answer" in result,false);
});

test("model API observations remain distinct from consumer-facing observations", () => {
  const result=analyzeGeoObservation({...consumer,provider:{name:"Model API",observationClass:"model_api",model:"example-model"}});
  assert.equal(result.observationClass,"model_api");
  assert.equal(result.provider.model,"example-model");
});

test("citation parsing rejects unsafe schemes and embedded credentials", () => {
  assert.throws(()=>analyzeGeoObservation({...consumer,citations:["javascript:alert(1)"]}),/HTTP or HTTPS/);
  assert.throws(()=>analyzeGeoObservation({...consumer,citations:["https://user:pass@example.test/path"]}),/credentials/);
});

test("GEO observation requires an explicit supported observation channel", () => {
  assert.throws(()=>analyzeGeoObservation({...consumer,provider:{name:"unknown",observationClass:"crawl"}}),/observationClass/);
});

test("aggregation keeps providers and observation classes separate and reports Wilson intervals", () => {
  const a=analyzeGeoObservation(consumer);
  const b=analyzeGeoObservation({...consumer,answer:"No mention here.",citations:[],provider:{name:"Consumer Search UI",observationClass:"consumer_observation",region:"US",locale:"en-US"}});
  const c=analyzeGeoObservation({...consumer,provider:{name:"Model API",observationClass:"model_api"}});
  const groups=aggregateGeoObservations([a,b,c]);
  assert.equal(groups.length,2);
  const consumerGroup=groups.find(item=>item.observationClass==="consumer_observation");
  assert.equal(consumerGroup.sampleSize,2);
  assert.equal(consumerGroup.mentionCount,1);
  assert.equal(consumerGroup.mentionRate,0.5);
  assert.ok(consumerGroup.mentionRate95.lower < 0.5);
  assert.ok(consumerGroup.mentionRate95.upper > 0.5);
  assert.equal(groups.find(item=>item.observationClass==="model_api").sampleSize,1);
});

test("aggregation handles empty input and validates records", () => {
  assert.deepEqual(aggregateGeoObservations([]),[]);
  assert.throws(()=>aggregateGeoObservations([{}]),/valid GEO observation/);
});


test("GEO aggregation rejects evidence records with forged but well-shaped identifiers", () => {
  const observation = analyzeGeoObservation(consumer);
  const tampered = {
    ...observation,
    evidence: { ...observation.evidence, id: "evidence_" + "0".repeat(20) }
  };
  assert.throws(() => aggregateGeoObservations([tampered]), /evidence provenance is invalid/);
});


test("GEO aggregation rejects duplicate evidence identifiers instead of inflating sample size", () => {
  const observation = analyzeGeoObservation(consumer);
  assert.throws(() => aggregateGeoObservations([observation, observation]), /duplicate evidence identifier/);
});


test("GEO aggregation rejects citation URLs that are not in canonical normalized form", () => {
  const observation = analyzeGeoObservation(consumer);
  const tampered = {
    ...observation,
    citations: observation.citations.map((citation, index) =>
      index === 0 ? { ...citation, url: citation.url + "#fragment" } : citation
    )
  };
  assert.throws(() => aggregateGeoObservations([tampered]), /citation URL is not normalized/);
});

test("GEO aggregation rejects duplicate citation URLs within one observation", () => {
  const observation = analyzeGeoObservation(consumer);
  const first = observation.citations[0];
  const tampered = { ...observation, citations: [first, first], citationCount: 2 };
  assert.throws(() => aggregateGeoObservations([tampered]), /duplicate citation URL/);
});
