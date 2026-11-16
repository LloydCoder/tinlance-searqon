export class EmailDeliveryError extends Error {
  constructor(code = "email_delivery_failed") {
    super("Transactional email delivery is unavailable.");
    this.name = "EmailDeliveryError";
    this.code = code;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

export function createEmailSender({
  apiKey = process.env.RESEND_API_KEY,
  from = process.env.SEARQON_EMAIL_FROM,
  mode = process.env.SEARQON_EMAIL_MODE,
  nodeEnv = process.env.NODE_ENV ?? "development",
  fetchImpl = globalThis.fetch,
  logger = message => process.stdout.write(JSON.stringify(message) + "\n")
} = {}) {
  if (apiKey && from) {
    if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
    return {
      available: true,
      async sendMagicLink({ to, url, idempotencyKey }) {
        if (typeof to !== "string" || typeof url !== "string" || typeof idempotencyKey !== "string") {
          throw new TypeError("A recipient, URL and idempotency key are required.");
        }
        const response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: "Bearer " + apiKey,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject: "Your Searqon sign-in link",
            text: "Use this one-time link to sign in to Searqon: " + url + "\n\nThis link expires in 15 minutes. If you did not request it, you can ignore this email.",
            html: '<p>Use this one-time link to sign in to Searqon.</p><p><a href="' +
              escapeHtml(url) + '">Continue to Searqon</a></p><p>This link expires in 15 minutes. If you did not request it, you can ignore this email.</p>'
          }),
          signal: AbortSignal.timeout(8_000)
        }).catch(() => {
          throw new EmailDeliveryError("email_provider_unavailable");
        });

        if (!response.ok) throw new EmailDeliveryError("email_provider_rejected");
        return { accepted: true };
      }
    };
  }

  if (mode === "console" && nodeEnv !== "production") {
    return {
      available: true,
      async sendMagicLink({ to, url, idempotencyKey }) {
        logger({
          event: "searqon_magic_link_local_only",
          recipient: to,
          verificationUrl: url,
          idempotencyKey
        });
        return { accepted: true };
      }
    };
  }

  return {
    available: false,
    async sendMagicLink() {
      throw new EmailDeliveryError("email_not_configured");
    }
  };
}
