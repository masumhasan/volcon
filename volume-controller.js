(function (root) {
  const fades = new WeakMap();

  function clampVolume(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
  }

  function getTargetForAction(media, target, action) {
    const desired = clampVolume(target);
    return action === "raise" ? Math.max(media.volume, desired) : desired;
  }

  function fadeMedia(media, target, duration, action) {
    const desired = getTargetForAction(media, target, action);
    const existing = fades.get(media);
    if (existing) cancelAnimationFrame(existing.frame);

    const startVolume = media.volume;
    const difference = desired - startVolume;
    const record = { frame: null };
    fades.set(media, record);

    if (duration <= 0 || difference === 0) {
      media.volume = desired;
      fades.delete(media);
      return;
    }

    const started = performance.now();
    function step(now) {
      const progress = Math.min(1, (now - started) / duration);
      media.volume = clampVolume(startVolume + difference * progress);
      if (progress < 1) {
        record.frame = requestAnimationFrame(step);
      } else {
        media.volume = desired;
        fades.delete(media);
      }
    }
    record.frame = requestAnimationFrame(step);
  }

  const VolumeController = {
    clampVolume,
    getTargetForAction,
    fadeMedia
  };

  if (typeof module !== "undefined" && module.exports) module.exports = VolumeController;
  root.VolumeController = VolumeController;
})(typeof globalThis !== "undefined" ? globalThis : this);
