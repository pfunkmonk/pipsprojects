const form = document.getElementById("draft-board-login");
const input = document.getElementById("draft-board-code");
const button = document.getElementById("open-draft-board");
const status = document.getElementById("login-status");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

async function signedIn() {
  const response = await fetch("/api/thunder-bowl/draft-board/auth", { credentials: "same-origin", cache: "no-store" });
  return response.ok;
}

async function openBoard(code) {
  const response = await fetch("/api/thunder-bowl/draft-board/auth", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (response.ok) {
    window.location.replace("/thunder-bowl/board");
    return;
  }
  const body = await response.json().catch(() => ({}));
  throw new Error(body.error || "Draft Board sign-in failed.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  setStatus("Checking Draft Board access…");
  try {
    await openBoard(input.value);
  } catch (error) {
    button.disabled = false;
    input.select();
    setStatus(error.message, true);
  }
});

try {
  if (await signedIn()) window.location.replace("/thunder-bowl/board");
} catch {
  setStatus("Enter the shared Draft Board code. Read-only access cannot change the draft.");
}
