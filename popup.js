const target = document.querySelector("#target");
const duration = document.querySelector("#duration");
const targetOutput = document.querySelector("#target-output");
const durationOutput = document.querySelector("#duration-output");
const status = document.querySelector("#status");

chrome.storage.local.get(["targetVolume", "fadeDuration"], (settings) => {
  if (Number.isFinite(settings.targetVolume)) target.value = String(settings.targetVolume);
  if (Number.isFinite(settings.fadeDuration)) duration.value = String(settings.fadeDuration);
  updateOutputs();
});

function updateOutputs() {
  targetOutput.value = `${target.value}%`;
  durationOutput.value = `${duration.value} seconds`;
}

target.addEventListener("input", () => {
  updateOutputs();
  chrome.storage.local.set({ targetVolume: Number(target.value) });
});

duration.addEventListener("input", () => {
  updateOutputs();
  chrome.storage.local.set({ fadeDuration: Number(duration.value) });
});

async function apply(action) {
  const message = {
    type: "set-volume",
    action,
    target: Number(target.value) / 100,
    duration: Number(duration.value) * 1000
  };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    status.textContent = "No active tab.";
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    status.textContent = response?.changed
      ? `${action === "raise" ? "Raised" : "Faded"} ${response.changed} media element(s).`
      : "No media found in this tab.";
  } catch {
    status.textContent = "This page cannot be controlled.";
  }
}

document.querySelector("#raise").addEventListener("click", () => apply("raise"));
document.querySelector("#fade").addEventListener("click", () => apply("fade"));
updateOutputs();
