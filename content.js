chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "set-volume") return;

  const media = Array.from(document.querySelectorAll("audio, video"));
  media.forEach((element) => {
    window.VolumeController.fadeMedia(
      element,
      message.target,
      message.duration,
      message.action
    );
  });

  sendResponse({ changed: media.length });
  return true;
});
