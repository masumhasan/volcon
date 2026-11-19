/**
 * One AudioContext per frame, created lazily. It is deliberately never suspended: once an
 * element is attached to the graph its sound only flows while the context is running, so
 * suspending it could silence a video if resuming were later refused by autoplay policy.
 */
let sharedContext: AudioContext | undefined;

export function getAudioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  return sharedContext;
}

/**
 * Makes sure the context is running. Returns false when the browser refuses (no user
 * gesture yet). Callers must not attach a media element until this returns true, because
 * attaching to a suspended context would mute the video.
 */
export async function ensureRunning(): Promise<boolean> {
  const context = getAudioContext();
  if (context.state === 'running') return true;
  try {
    await context.resume();
  } catch {
    return false;
  }
  return stateOf(context) === 'running';
}

/** Reads the state through a function so TypeScript does not reuse the earlier narrowing. */
function stateOf(context: AudioContext): AudioContextState {
  return context.state;
}
