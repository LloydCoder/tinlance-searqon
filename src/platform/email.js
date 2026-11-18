export class EmailDeliveryError extends Error {
  constructor(code = "email_delivery_failed") {
    super("Transactional email delivery is unavailable.");
    this.name = "EmailDeliveryError";
    this.code = code;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function validateMessage({ to, url, idempotencyKey }) {
  if (typeof to !== "string" || to.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)
    || typeof url !== "string" || typeof idempotencyKey !== "string"
    || idempotencyKey.length < 1 || idempotencyKey.length > 128) {
    throw new TypeError("A valid recipient, URL and idempotency key are required.");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !["localhost","127.0.0.1","[::1]"].includes(parsed.hostname)) {
    throw new TypeError("Email links must use HTTPS outside loopback development.");
  }
}

export function createEmailSender({
  apiKey = process.env.RESEND_API_KEY,
  from = process.env.SEARQON_EMAIL_FROM,
  mode = process.env.SEARQON_EMAIL_MODE,
  nodeEnv = process.env.NODE_ENV ?? "development",
  fetchImpl = globalThis.fetch,
  logger = message => process.stdout.write(JSON.stringify(message) + "\\n")
} = {}) {
  if (apiKey && from) {
    if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
    async function send({ to, url, idempotencyKey, subject, text, html }) {
      validateMessage({to,url,idempotencyKey});
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: "Bearer " + apiKey,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey
        },
        body: JSON.stringify({from,to:[to],subject,text,html}),
        signal: AbortSignal.timeout(8_000)
      }).catch(() => { throw new EmailDeliveryError("email_provider_unavailable"); });
      if (!response.ok) throw new EmailDeliveryError("email_provider_rejected");
      return {accepted:true};
    }
    return {
      available:true,
      async sendMagicLink({to,url,idempotencyKey}) {
        validateMessage({to,url,idempotencyKey});
        return send({
          to,url,idempotencyKey,
          subject:"Your Searqon sign-in link",
          text:"Use this one-time link to sign in to Searqon: "+url+"\\n\\nThis link expires in 15 minutes. If you did not request it, ignore this email.",
          html:'<p>Use this one-time link to sign in to Searqon.</p><p><a href="'+escapeHtml(url)+'">Continue to Searqon</a></p><p>This link expires in 15 minutes. If you did not request it, ignore this email.</p>'
        });
      },
      async sendWorkspaceInvitation({to,url,organizationName,role,idempotencyKey}) {
        if (typeof organizationName !== "string" || organizationName.length > 160
          || !["admin","analyst","viewer"].includes(role)) {
          throw new TypeError("A valid workspace name and role are required.");
        }
        validateMessage({to,url,idempotencyKey});
        const workspace = escapeHtml(organizationName);
        const safeRole = escapeHtml(role);
        return send({
          to,url,idempotencyKey,
          subject:"You are invited to a Searqon workspace",
          text:"You have been invited to join "+organizationName+" as "+role+". Accept the invitation: "+url+"\\n\\nThis invitation expires in seven days.",
          html:'<p>You have been invited to join <strong>'+workspace+'</strong> as <strong>'+safeRole+'</strong>.</p><p><a href="'+escapeHtml(url)+'">Accept workspace invitation</a></p><p>This invitation expires in seven days.</p>'
        });
      }
    };
  }

  if (mode === "console" && nodeEnv !== "production") {
    return {
      available:true,
      async sendMagicLink({to,url,idempotencyKey}) {
        validateMessage({to,url,idempotencyKey});
        logger({event:"searqon_magic_link_local_only",recipient:to,verificationUrl:url,idempotencyKey});
        return {accepted:true};
      },
      async sendWorkspaceInvitation({to,url,organizationName,role,idempotencyKey}) {
        validateMessage({to,url,idempotencyKey});
        if (typeof organizationName !== "string" || !["admin","analyst","viewer"].includes(role)) {
          throw new TypeError("A valid workspace name and role are required.");
        }
        logger({event:"searqon_workspace_invitation_local_only",recipient:to,invitationUrl:url,organizationName,role,idempotencyKey});
        return {accepted:true};
      }
    };
  }

  return {
    available:false,
    async sendMagicLink() { throw new EmailDeliveryError("email_not_configured"); },
    async sendWorkspaceInvitation() { throw new EmailDeliveryError("email_not_configured"); }
  };
}
