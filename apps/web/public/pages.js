const toggle = document.querySelector(".page-nav-toggle");
const navigation = document.querySelector("#page-primary-nav");

if (navigation) {
  const currentPath = window.location.pathname.endsWith("/")
    ? window.location.pathname
    : window.location.pathname + "/";
  for (const link of navigation.querySelectorAll("a")) {
    const linkPath = new URL(link.href, window.location.origin).pathname;
    if (linkPath === currentPath) link.setAttribute("aria-current", "page");
  }
}

if (toggle && navigation) {
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", expanded ? "Close navigation" : "Open navigation");
    navigation.classList.toggle("open", expanded);
  });

  navigation.addEventListener("click", event => {
    if (event.target.closest("a")) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
      navigation.classList.remove("open");
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
      navigation.classList.remove("open");
      toggle.focus();
    }
  });
}
