const status = document.querySelector("#workspace-status");
const userName = document.querySelector("#user-name");
const userEmail = document.querySelector("#user-email");
const organizationName = document.querySelector("#organization-name");
const organizationRole = document.querySelector("#organization-role");
const settingsSummary = document.querySelector("#settings-summary");

async function loadWorkspace() {
  try {
    const response = await fetch("/api/v1/auth/me", {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      cache: "no-store"
    });
    if (response.status === 401) {
      window.location.replace("/auth/login/");
      return;
    }
    if (!response.ok) throw new Error("Your workspace could not be loaded. Try signing in again.");
    const profile = await response.json();
    const user = profile.user;
    const organizations = Array.isArray(profile.organizations) ? profile.organizations : [];
    const active = organizations[0] ?? null;
    userName.textContent = user.display_name || "there";
    userEmail.textContent = user.email || "";
    organizationName.textContent = active?.name || "Personal workspace";
    organizationRole.textContent = active?.role || "Member";
    settingsSummary.textContent = (user.email || "") + " · " + (active?.name || "Personal workspace") + " · " + (active?.role || "member");
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Workspace unavailable.";
    status.className = "workspace-status";
  }
}

const signOut = document.querySelector("#sign-out");
signOut?.addEventListener("click", async () => {
  signOut.disabled = true;
  signOut.textContent = "Signing out…";
  try {
    const response = await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!response.ok) throw new Error("The session could not be revoked. Please retry.");
    window.location.replace("/auth/login/");
  } catch (error) {
    signOut.disabled = false;
    signOut.textContent = "Sign out";
    status.textContent = error instanceof Error ? error.message : "Sign-out could not be confirmed. Please retry.";
    status.className = "workspace-status";
  }
});

loadWorkspace();
