const status = document.querySelector("#auth-status");

function setStatus(message, tone = "") {
  if (!status) return;
  status.textContent = message;
  status.className = "auth-status" + (tone ? " " + tone : "");
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error?.message ?? "The request could not be completed. Try again.");
  }
  return result;
}

function bindRequestForm(formId, endpoint, fields, submitText, successMessage) {
  const form = document.querySelector("#" + formId);
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const payload = {};
    for (const field of fields) payload[field] = form.elements[field].value.trim();
    button.disabled = true;
    button.textContent = submitText;
    setStatus("Sending a secure sign-in request…");
    try {
      const result = await postJson(endpoint, payload);
      setStatus(result.message ?? successMessage, "success");
      form.reset();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The request could not be completed.", "error");
    } finally {
      button.disabled = false;
      button.textContent = submitText;
    }
  });
}

bindRequestForm(
  "register-form",
  "/api/v1/auth/register",
  ["email", "displayName", "organizationName"],
  "Create workspace ↗",
  "If the address can be registered, a sign-in link will be sent."
);

bindRequestForm(
  "login-form",
  "/api/v1/auth/magic-link",
  ["email"],
  "Send sign-in link ↗",
  "If the account exists, a sign-in link will be sent."
);

const verifyButton = document.querySelector("#verify-button");
if (verifyButton) {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("token");
  // Remove the credential from the address bar and history before making a request.
  window.history.replaceState(null, "", window.location.pathname);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    verifyButton.disabled = true;
    setStatus("This sign-in link is missing or malformed. Request a new one.", "error");
  } else {
    verifyButton.addEventListener("click", async () => {
      verifyButton.disabled = true;
      verifyButton.textContent = "Verifying…";
      setStatus("Verifying your one-time link…");
      try {
        await postJson("/api/v1/auth/verify", { token });
        setStatus("You're signed in. Opening your workspace…", "success");
        window.location.assign("/app/");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "The sign-in link could not be verified.", "error");
        verifyButton.disabled = false;
        verifyButton.textContent = "Continue to Searqon ↗";
      }
    }, { once: true });
  }
}
