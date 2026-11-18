const statusNode = document.querySelector("#auth-status");
const acceptButton = document.querySelector("#accept-invitation-button");
const signInLink = document.querySelector("#sign-in-link");
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function setStatus(message, tone = "") {
  statusNode.textContent = message;
  statusNode.className = "auth-status" + (tone ? " " + tone : "");
}

async function getProfile() {
  const response = await fetch("/api/v1/auth/me", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Your sign-in status could not be checked.");
  return response.json();
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message ?? "The invitation could not be accepted.");
  return result;
}

const fragment = new URLSearchParams(window.location.hash.slice(1));
const fragmentToken = fragment.get("token");
if (fragmentToken && TOKEN_PATTERN.test(fragmentToken)) {
  sessionStorage.setItem("searqon_invitation_token", fragmentToken);
}
window.history.replaceState(null, "", window.location.pathname);

const token = sessionStorage.getItem("searqon_invitation_token");
if (!token || !TOKEN_PATTERN.test(token)) {
  sessionStorage.removeItem("searqon_invitation_token");
  setStatus("This invitation link is missing, invalid or expired. Ask a workspace administrator to send a new invitation.", "error");
} else {
  try {
    const profile = await getProfile();
    if (!profile?.user?.id) {
      sessionStorage.setItem("searqon_auth_return_to", "/auth/invitation/");
      signInLink.hidden = false;
      acceptButton.hidden = true;
      setStatus("Sign in using the email address that received this invitation. Your invitation will remain available in this browser session.");
    } else {
      acceptButton.disabled = false;
      setStatus("You are signed in. Accept the invitation to join the workspace.");
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The invitation could not be loaded.", "error");
  }
}

acceptButton.addEventListener("click", async () => {
  const currentToken = sessionStorage.getItem("searqon_invitation_token");
  if (!currentToken || !TOKEN_PATTERN.test(currentToken)) {
    setStatus("This invitation is no longer available. Ask for a new invitation.", "error");
    acceptButton.disabled = true;
    return;
  }
  acceptButton.disabled = true;
  setStatus("Accepting your invitation…");
  try {
    const result = await postJson("/api/v1/workspace-invitations/accept", { token: currentToken });
    sessionStorage.removeItem("searqon_invitation_token");
    sessionStorage.removeItem("searqon_auth_return_to");
    setStatus("Invitation accepted. Opening your workspace…", "success");
    window.location.assign("/app/");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The invitation could not be accepted.", "error");
    acceptButton.disabled = false;
  }
});
