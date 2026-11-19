import { TARGET_PERCENT_MAX, TARGET_PERCENT_MIN } from '../../dsp/constants';
import { PRESET_VALUES, targetPercentToLufs, type PresetName } from '../../dsp/presets';
import { debounce } from '../../shared/debounce';
import { applyI18n, t } from '../../shared/i18n';
import {
  CAPTURE_PORT_PREFIX,
  hostnameOfPattern,
  parseFrameStatus,
  STATUS_PORT,
  toSitePattern,
  type FrameStatus,
} from '../../shared/messages';
import { logger } from '../../shared/logger';
import { withoutSite, type Settings } from '../../shared/settings';
import {
  getPausedUntil,
  loadSettings,
  setPausedUntil,
  updateSettings,
} from '../../shared/settings-service';
import { applyTheme, byId, inputById, sendToBackground } from '../dom';
import { describeStatus, formatDb, meterFraction, pickFrame } from './view-model';

const DIAL_CIRCUMFERENCE = 477.52; // 2π × 76 (matches the SVG radius)
const STEP_PERCENT = 2;
const PAUSE_MS = 15 * 60 * 1000;
const PRESET_ORDER: readonly PresetName[] = ['night', 'normal', 'cinema', 'custom'];

interface PopupState {
  settings: Settings;
  pausedUntil: number;
  tabId: number | null;
  pattern: string | null;
  host: string | null;
  noAccess: boolean;
  persistent: boolean;
  /** Compatibility mode (tab capture) is running for this tab. */
  captureActive: boolean;
  frames: Map<string, FrameStatus>;
  lastStatusKey: string;
}

const state: PopupState = {
  settings: undefined as unknown as Settings, // set in init() before first render
  pausedUntil: 0,
  tabId: null,
  pattern: null,
  host: null,
  noAccess: false,
  persistent: false,
  captureActive: false,
  frames: new Map(),
  lastStatusKey: '',
};

const CAPTURE_FRAME_ID = 'capture';
const CAPTURE_PERMISSIONS: chrome.runtime.ManifestPermission[] = ['tabCapture', 'offscreen'];

const isPaused = (): boolean => state.pausedUntil > Date.now();

/** True when a page frame (not the capture session) reported media we cannot process. */
function pageIsBlocked(): boolean {
  return [...state.frames.values()].some(
    (frame) => frame.frame !== CAPTURE_FRAME_ID && frame.mediaState === 'blocked',
  );
}

// ---------- rendering ----------

function renderStatus(): void {
  const view = describeStatus({
    restricted: state.pattern === null,
    noAccess: state.noAccess,
    enabled: state.settings.enabled,
    paused: isPaused(),
    siteEnabled: state.host === null || state.settings.sites[state.host] !== false,
    frame: pickFrame(state.frames.values()),
  });
  const status = byId('status');
  status.dataset['kind'] = view.kind;
  // Only touch the live region when the sentence changes, so screen readers are not spammed.
  if (state.lastStatusKey !== view.messageKey) {
    byId('status-text').textContent = t(view.messageKey);
    state.lastStatusKey = view.messageKey;
  }
  const pill = byId('status-gain');
  pill.hidden = view.gainDb === null;
  if (view.gainDb !== null) {
    const arrow = view.kind === 'lowering' ? ' ↓' : view.kind === 'raising' ? ' ↑' : '';
    pill.textContent = `${formatDb(view.gainDb)} dB${arrow}`;
  }
}

function renderMeters(): void {
  const frame = pickFrame(state.frames.values());
  const running = frame?.mediaState === 'running' && state.settings.enabled && !isPaused();
  const source = running ? frame.sourceLufs : null;
  const output = source !== null && frame ? source + frame.gainDb : null;
  byId('source-bar').style.transform = `scaleX(${meterFraction(source)})`;
  byId('output-bar').style.transform = `scaleX(${meterFraction(output)})`;
  byId('source-db').textContent = source === null ? '' : `${formatDb(source)} dB`;
  byId('output-db').textContent = output === null ? '' : `${formatDb(output)} dB`;
}

function renderDial(): void {
  const { targetPercent } = state.settings;
  const lufs = targetPercentToLufs(targetPercent);
  byId('target-value').textContent = String(Math.round(targetPercent));
  byId('target-lufs').textContent = `${lufs.toFixed(1)} LUFS`;
  byId('dial-arc').style.strokeDashoffset = (
    DIAL_CIRCUMFERENCE *
    (1 - targetPercent / 100)
  ).toFixed(2);
  const range = inputById('target-range');
  range.value = String(targetPercent);
  range.setAttribute('aria-valuetext', t('popupTargetValue', String(Math.round(targetPercent))));
  byId('target-line').style.left = `${(meterFraction(lufs) * 100).toFixed(1)}%`;
}

function renderPresets(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.preset')) {
    button.setAttribute('aria-pressed', String(button.dataset['preset'] === state.settings.preset));
  }
}

function renderSite(): void {
  const card = byId('site-card');
  card.hidden = state.host === null;
  byId('site-name').textContent = state.host ?? t('siteRestricted');
  byId('site-hint').textContent = state.host === null ? t('siteRestrictedHint') : '';
  if (state.host === null) return;
  byId('site-toggle-label').textContent = t('siteAlways', state.host);
  byId('site-toggle-hint').textContent = t(
    state.persistent ? 'siteAlwaysOnHint' : 'siteAlwaysOffHint',
  );
  inputById('site-toggle').checked = state.persistent;
}

/** The compatibility card only appears when it can help (blocked page) or is already on. */
function renderCompat(): void {
  const visible = state.pattern !== null && (state.captureActive || pageIsBlocked());
  byId('compat-card').hidden = !visible;
  if (!visible) return;
  byId('compat-hint').textContent = t(state.captureActive ? 'compatActiveHint' : 'compatHint');
  byId('compat-button').textContent = t(state.captureActive ? 'compatOff' : 'compatOn');
}

function showCompatError(messageKey: string | null): void {
  const element = byId('compat-error');
  element.hidden = messageKey === null;
  element.textContent = messageKey === null ? '' : t(messageKey);
}

function renderPause(): void {
  byId('pause-label').textContent = t(isPaused() ? 'popupResume' : 'popupPause');
}

function renderAll(): void {
  inputById('master-toggle').checked = state.settings.enabled;
  applyTheme(state.settings.theme);
  renderSite();
  renderDial();
  renderPresets();
  renderPause();
  renderCompat();
  renderStatus();
  renderMeters();
}

// ---------- actions ----------

const saveTarget = debounce((targetPercent: number) => {
  void updateSettings({ targetPercent, preset: 'custom' });
}, 250);

function setTarget(percent: number): void {
  const targetPercent = Math.min(
    Math.max(Math.round(percent), TARGET_PERCENT_MIN),
    TARGET_PERCENT_MAX,
  );
  state.settings = { ...state.settings, targetPercent, preset: 'custom' };
  renderDial();
  renderPresets();
  saveTarget(targetPercent);
}

function applyPreset(name: PresetName): void {
  saveTarget.cancel(); // a pending dial save must not overwrite the preset we are applying
  if (name === 'custom') {
    state.settings = { ...state.settings, preset: 'custom' };
    void updateSettings({ preset: 'custom' });
  } else {
    const values = PRESET_VALUES[name];
    state.settings = { ...state.settings, ...values, preset: name };
    void updateSettings({ ...values, preset: name });
  }
  renderDial();
  renderPresets();
}

async function toggleSite(checked: boolean): Promise<void> {
  const { pattern, host } = state;
  if (!pattern || !host) return;
  if (checked) {
    // Must be the first await in the click handler: permission prompts need a user gesture.
    const granted = await chrome.permissions.request({ origins: [pattern] });
    const registered = granted && (await sendToBackground({ type: 'register-site', pattern })).ok;
    state.persistent = registered;
    if (registered) {
      const sites = { ...state.settings.sites, [host]: true };
      state.settings = { ...state.settings, sites };
      await updateSettings({ sites });
    }
  } else {
    await sendToBackground({ type: 'unregister-site', pattern });
    state.persistent = false;
    const sites = withoutSite(state.settings.sites, host);
    state.settings = { ...state.settings, sites };
    await updateSettings({ sites });
  }
  renderSite();
  renderStatus();
}

/** Turns compatibility mode (tab capture) on or off for the active tab. */
async function toggleCapture(): Promise<void> {
  const tabId = state.tabId;
  if (tabId === null) return;
  showCompatError(null);

  if (state.captureActive) {
    await sendToBackground({ type: 'capture-stop', tabId });
    state.captureActive = false;
    state.frames.delete(CAPTURE_FRAME_ID);
  } else {
    // Must be the first await in the click handler: permission prompts need a user gesture.
    const granted = await chrome.permissions.request({ permissions: CAPTURE_PERMISSIONS });
    if (!granted) {
      showCompatError('compatDenied');
      return;
    }
    const started = await sendToBackground({ type: 'capture-start', tabId });
    if (!started.ok) {
      showCompatError('compatError');
      return;
    }
    state.captureActive = true;
    connectCapture(tabId);
  }
  renderCompat();
  renderStatus();
  renderMeters();
}

function bindControls(): void {
  inputById('master-toggle').addEventListener('change', (event) => {
    const enabled = (event.target as HTMLInputElement).checked;
    state.settings = { ...state.settings, enabled };
    void updateSettings({ enabled });
    renderStatus();
    renderMeters();
  });
  byId('open-options').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
    window.close();
  });
  byId('btn-decrease').addEventListener('click', () => {
    setTarget(state.settings.targetPercent - STEP_PERCENT);
  });
  byId('btn-increase').addEventListener('click', () => {
    setTarget(state.settings.targetPercent + STEP_PERCENT);
  });
  inputById('target-range').addEventListener('input', (event) => {
    setTarget(Number((event.target as HTMLInputElement).value));
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('.preset')) {
    button.addEventListener('click', () => {
      const name = PRESET_ORDER.find((candidate) => candidate === button.dataset['preset']);
      if (name) applyPreset(name);
    });
  }
  byId('pause-button').addEventListener('click', () => {
    state.pausedUntil = isPaused() ? 0 : Date.now() + PAUSE_MS;
    void setPausedUntil(state.pausedUntil);
    renderPause();
    renderStatus();
    renderMeters();
  });
  inputById('site-toggle').addEventListener('change', (event) => {
    void toggleSite((event.target as HTMLInputElement).checked);
  });
  byId('compat-button').addEventListener('click', () => {
    void toggleCapture();
  });
}

// ---------- live status from the page ----------

/** Opens the status port, retrying briefly because the content script may still be starting. */
function connectStatus(tabId: number, attempt = 0): void {
  const port = chrome.tabs.connect(tabId, { name: STATUS_PORT });
  let received = false;
  port.onMessage.addListener((message: unknown) => {
    const status = parseFrameStatus(message);
    if (!status) return;
    received = true;
    state.frames.set(status.frame, status);
    renderCompat();
    renderStatus();
    renderMeters();
  });
  port.onDisconnect.addListener(() => {
    // Reading lastError stops Chrome from logging an unchecked error.
    logger.debug('status port closed', chrome.runtime.lastError?.message);
    if (!received && attempt < 4) {
      setTimeout(() => {
        connectStatus(tabId, attempt + 1);
      }, 300);
    }
  });
}

/** Streams live status from the offscreen document while compatibility mode is on. */
function connectCapture(tabId: number, attempt = 0): void {
  const port = chrome.runtime.connect({ name: `${CAPTURE_PORT_PREFIX}${String(tabId)}` });
  let received = false;
  port.onMessage.addListener((message: unknown) => {
    const status = parseFrameStatus(message);
    if (!status) return;
    received = true;
    state.frames.set(CAPTURE_FRAME_ID, status);
    renderStatus();
    renderMeters();
  });
  port.onDisconnect.addListener(() => {
    logger.debug('capture port closed', chrome.runtime.lastError?.message);
    if (!received && state.captureActive && attempt < 4) {
      setTimeout(() => {
        connectCapture(tabId, attempt + 1);
      }, 300);
    }
  });
}

async function inspectActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id ?? null;
  state.pattern = tab?.url ? toSitePattern(tab.url) : null;
  state.host = state.pattern ? hostnameOfPattern(state.pattern) : null;
  if (state.tabId === null || state.pattern === null) return;

  state.persistent = await chrome.permissions.contains({ origins: [state.pattern] });
  const injected = await sendToBackground({ type: 'inject-tab', tabId: state.tabId });
  state.noAccess = !injected.ok;
  if (injected.ok) connectStatus(state.tabId);

  const capture = await sendToBackground({ type: 'capture-state', tabId: state.tabId });
  if (capture.ok && capture.active === true) {
    state.captureActive = true;
    connectCapture(state.tabId);
  }
}

async function renderShortcut(): Promise<void> {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((command) => command.name === 'toggle-enabled')?.shortcut;
  byId('shortcut').textContent = shortcut || t('shortcutNone');
}

async function init(): Promise<void> {
  applyI18n();
  document.title = t('extName');
  byId('version').textContent = `v${chrome.runtime.getManifest().version}`;
  const range = inputById('target-range');
  range.min = String(TARGET_PERCENT_MIN);
  range.max = String(TARGET_PERCENT_MAX);

  [state.settings, state.pausedUntil] = await Promise.all([loadSettings(), getPausedUntil()]);
  bindControls();
  // The popup closes the moment the user clicks away: never lose the last dial change.
  window.addEventListener('pagehide', saveTarget.flush);
  renderAll();
  void renderShortcut();

  await inspectActiveTab();
  renderAll();
}

void init();
