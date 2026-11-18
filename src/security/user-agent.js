const PRODUCT_VERSION = "0.2";

export function wireUserAgent(token = "SearqonBot") {
  if (typeof token !== "string" || !/^[A-Za-z_-]{1,64}$/.test(token)) {
    throw new TypeError("userAgent must be a crawler product token of 1-64 ASCII letters, underscores, or hyphens");
  }
  return token + "/" + PRODUCT_VERSION + " (+https://github.com/LloydCoder/tinlance-searqon)";
}
