import { MAX_BOOST_DB_LIMIT } from '../../dsp/constants';
import { PRESET_VALUES, type LimiterStrength } from '../../dsp/presets';
import { debounce } from '../../shared/debounce';
import { applyI18n, t } from '../../shared/i18n';
import { withoutSite, type Settings, type ThemeMode } from '../../shared/settings';
import { loadSettings, updateSettings } from '../../shared/settings-service';
import { applyTheme, byId, inputById, selectById, sendToBackground } from '../dom';

const HIGH_BOOST_WARNING_DB = 9;
const SAVED_MESSAGE_MS = 1500;

let settings: Settings;

const clearSavedMessage = debounce(() => {
  byId('save-status').textContent = '';
}, SAVED_MESSAGE_MS);

/** Persists a change, marks the preset as custom when tuning values moved, and confirms. */
async function save(patch: Partial<Settings>, isTuning: boolean): Promise<void> {
  const next: Partial<Settings> = isTuning ? { ...patch, preset: 'custom' } : patch;
  settings = { ...settings, ...next };
  settings = await updateSettings(next);
  byId('save-status').textContent = t('optionsSaved');
  clearSavedMessage();
}

function renderTuning(): void {
  const reaction = inputById('reaction-range');
  reaction.value = String(Math.round(settings.reactionSpeed * 100));
  byId('reaction-value').textContent = `${reaction.value}%`;

  const boost = inputById('boost-range');
  boost.max = String(MAX_BOOST_DB_LIMIT);
  boost.value = String(settings.maxBoostDb);
  byId('boost-value').textContent = `+${boost.value} dB`;
  byId('boost-warning').hidden = settings.maxBoostDb < HIGH_BOOST_WARNING_DB;

  const reduction = inputById('reduction-range');
  reduction.value = String(settings.maxReductionDb);
  byId('reduction-value').textContent = `-${reduction.value} dB`;

  selectById('limiter-select').value = settings.limiter;
  selectById('theme-select').value = settings.theme;
}

function siteRow(host: string): HTMLLIElement {
  const row = document.createElement('li');
  const name = document.createElement('span');
  name.textContent = host;

  const actions = document.createElement('div');
  actions.className = 'site-actions';

  const toggle = document.createElement('label');
  toggle.className = 'switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-label', t('optionsSiteToggle', host));
  input.checked = settings.sites[host] !== false;
  input.addEventListener('change', () => {
    void save({ sites: { ...settings.sites, [host]: input.checked } }, false);
  });
  const track = document.createElement('span');
  track.className = 'switch-track';
  track.setAttribute('aria-hidden', 'true');
  toggle.append(input, track);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn';
  remove.textContent = t('optionsRemoveSite');
  remove.setAttribute('aria-label', t('optionsRemoveSiteFor', host));
  remove.addEventListener('click', () => {
    void removeSite(host);
  });

  actions.append(toggle, remove);
  row.append(name, actions);
  return row;
}

async function removeSite(host: string): Promise<void> {
  for (const scheme of ['https', 'http']) {
    await sendToBackground({ type: 'unregister-site', pattern: `${scheme}://${host}/*` });
  }
  const sites = withoutSite(settings.sites, host);
  await save({ sites }, false);
  renderSites();
}

function renderSites(): void {
  const list = byId('sites-list');
  const hosts = Object.keys(settings.sites).sort();
  list.replaceChildren(...hosts.map(siteRow));
  byId('sites-empty').hidden = hosts.length > 0;
}

async function renderShortcut(): Promise<void> {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((command) => command.name === 'toggle-enabled')?.shortcut;
  byId('shortcut-keys').textContent = shortcut || t('shortcutNone');
}

function bindControls(): void {
  inputById('reaction-range').addEventListener('input', (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    byId('reaction-value').textContent = `${value}%`;
  });
  inputById('reaction-range').addEventListener('change', (event) => {
    void save({ reactionSpeed: Number((event.target as HTMLInputElement).value) / 100 }, true);
  });

  inputById('boost-range').addEventListener('input', (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    byId('boost-value').textContent = `+${value} dB`;
    byId('boost-warning').hidden = value < HIGH_BOOST_WARNING_DB;
  });
  inputById('boost-range').addEventListener('change', (event) => {
    void save({ maxBoostDb: Number((event.target as HTMLInputElement).value) }, true);
  });

  inputById('reduction-range').addEventListener('input', (event) => {
    byId('reduction-value').textContent = `-${(event.target as HTMLInputElement).value} dB`;
  });
  inputById('reduction-range').addEventListener('change', (event) => {
    void save({ maxReductionDb: Number((event.target as HTMLInputElement).value) }, true);
  });

  selectById('limiter-select').addEventListener('change', (event) => {
    void save({ limiter: (event.target as HTMLSelectElement).value as LimiterStrength }, true);
  });
  selectById('theme-select').addEventListener('change', (event) => {
    const theme = (event.target as HTMLSelectElement).value as ThemeMode;
    applyTheme(theme);
    void save({ theme }, false);
  });

  byId('reset-button').addEventListener('click', () => {
    void save({ ...PRESET_VALUES.normal, preset: 'normal' }, false).then(renderTuning);
  });
  byId('change-shortcut').addEventListener('click', () => {
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

async function init(): Promise<void> {
  applyI18n();
  document.title = t('optionsTitle');
  settings = await loadSettings();
  applyTheme(settings.theme);
  bindControls();
  renderTuning();
  renderSites();
  await renderShortcut();
}

void init();
