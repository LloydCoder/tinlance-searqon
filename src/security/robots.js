const MAX_ROBOTS_BYTES=512*1024;

function escapeRegexCharacter(character) {
  const metacharacters=new Set([".", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);
  return metacharacters.has(character) ? "\\"+character : character;
}

function compileRulePattern(path) {
  const anchored=path.endsWith("$");
  const body=anchored ? path.slice(0,-1) : path;
  const expression=[...body].map(character=>character==="*" ? ".*" : escapeRegexCharacter(character)).join("");
  return new RegExp("^"+expression+(anchored ? "$" : ""));
}

function validSitemap(value) {
  try {
    const url=new URL(value);
    return (url.protocol==="http:" || url.protocol==="https:") ? url.href : null;
  } catch { return null; }
}

/**
 * Parse a robots.txt document into user-agent groups and path rules.
 * This parser is deliberately bounded and performs no network access.
 */
export function parseRobots(content) {
  if (typeof content!=="string") throw new TypeError("robots.txt content must be a string");
  if (Buffer.byteLength(content,"utf8")>MAX_ROBOTS_BYTES) throw new RangeError("robots.txt exceeds the 512 KiB parsing size limit");
  const groups=[];
  const sitemaps=[];
  let current=null;

  const startGroup=()=>({userAgents:[],rules:[],crawlDelay:null,_hasDirectives:false});
  for (const rawLine of content.replace(/^\uFEFF/,"").split(/\r?\n/)) {
    const line=rawLine.split("#",1)[0].trim();
    if (!line) continue;
    const separator=line.indexOf(":");
    if (separator<0) continue;
    const field=line.slice(0,separator).trim().toLowerCase();
    const value=line.slice(separator+1).trim();

    if (field==="sitemap") {
      const sitemap=validSitemap(value);
      if (sitemap && !sitemaps.includes(sitemap)) sitemaps.push(sitemap);
      continue;
    }
    if (field==="user-agent") {
      if (!value) continue;
      if (!current || current._hasDirectives) {
        if (current && current.userAgents.length) groups.push(current);
        current=startGroup();
      }
      current.userAgents.push(value.toLowerCase());
      continue;
    }
    if (!current || current.userAgents.length===0) continue;
    if (field==="allow" || field==="disallow") {
      current._hasDirectives=true;
      if (!value) continue;
      if (!value.startsWith("/") && !value.startsWith("*")) continue;
      current.rules.push(Object.freeze({
        type:field,
        path:value,
        specificity:Buffer.byteLength(value.replace(/\*/g,"").replace(/\$$/,""),"utf8"),
        pattern:compileRulePattern(value)
      }));
      continue;
    }
    if (field==="crawl-delay") {
      current._hasDirectives=true;
      const delay=Number(value);
      if (Number.isFinite(delay) && delay>=0) current.crawlDelay=delay;
    }
  }
  if (current && current.userAgents.length) groups.push(current);

  return Object.freeze({
    groups:Object.freeze(groups.map(group=>Object.freeze({
      userAgents:Object.freeze([...group.userAgents]),
      rules:Object.freeze([...group.rules]),
      crawlDelay:group.crawlDelay
    }))),
    sitemaps:Object.freeze(sitemaps)
  });
}

/**
 * Evaluate the most-specific matching robots group. The longest matching path
 * rule wins; Allow wins ties, as required by RFC 9309.
 */
export function evaluateRobots(robots, targetUrl, userAgent) {
  if (!robots || !Array.isArray(robots.groups)) throw new TypeError("Parsed robots policy is required");
  if (typeof userAgent!=="string" || !userAgent.trim()) throw new TypeError("A crawler user-agent token is required");
  let url;
  try { url=new URL(targetUrl); }
  catch { throw new TypeError("Target must be a valid URL"); }
  if (url.protocol!=="http:" && url.protocol!=="https:") throw new TypeError("Robots target must use HTTP or HTTPS");
  const agent=userAgent.toLowerCase();
  const matches=[];
  for (const group of robots.groups) {
    for (const token of group.userAgents) {
      if (token==="*") continue;
      if (agent.includes(token)) matches.push({group,token,length:token.length});
    }
  }
  let selected;
  if (matches.length) {
    const longest=Math.max(...matches.map(item=>item.length));
    const chosen=new Set(matches.filter(item=>item.length===longest).map(item=>item.group));
    selected=[...chosen];
  } else {
    selected=robots.groups.filter(group=>group.userAgents.includes("*"));
  }

  const path=url.pathname+url.search;
  const matchingRules=selected.flatMap(group=>group.rules.filter(rule=>rule.pattern.test(path)));
  if (!matchingRules.length) return Object.freeze({allowed:true,matchedRule:null,matchingGroups:selected.length});
  const longest=Math.max(...matchingRules.map(rule=>rule.specificity));
  const best=matchingRules.filter(rule=>rule.specificity===longest);
  const winning=best.find(rule=>rule.type==="allow") ?? best[0];
  return Object.freeze({
    allowed:winning.type==="allow",
    matchedRule:Object.freeze({type:winning.type,path:winning.path,specificity:winning.specificity}),
    matchingGroups:selected.length
  });
}
