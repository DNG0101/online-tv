export const DEFAULT_PLAYLIST_URL = "https://iptv-org.github.io/iptv/index.m3u";
const MAX_RENDERED_CHANNELS = 200;
const RECENT_LIMIT = 12;

const state = {
  playlistUrl: DEFAULT_PLAYLIST_URL,
  channels: [],
  filteredChannels: [],
  selectedChannel: null,
  selectedView: "all",
  selectedGroup: "all",
  searchTerm: "",
  visibleLimit: MAX_RENDERED_CHANNELS,
  favorites: readStorage("streamdeck-favorites", []),
  recent: readStorage("streamdeck-recent", []),
  hls: null,
  playbackToken: 0,
  lastError: "",
  localPlaylistText: ""
};

export function parseM3U(text, baseUrl = "") {
  const channels = [];
  if (typeof text !== "string") return channels;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let pending = null;
  let pendingGroup = "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      pending = parseExtinf(line);
      pendingGroup = "";
      continue;
    }
    if (line.startsWith("#EXTGRP:")) {
      pendingGroup = line.slice("#EXTGRP:".length).trim();
      continue;
    }
    if (line.startsWith("#EXTVLCOPT:") && pending) {
      const option = line.slice("#EXTVLCOPT:".length).trim();
      pending.attributes[`extvlcopt:${option.split("=", 1)[0]}`] = option;
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!pending) continue;
    const url = resolveStreamUrl(line, baseUrl);
    const identity = `${pending.tvgId || pending.name}|${url}|${channels.length}`;
    channels.push({
      id: stableId(identity),
      name: pending.name || pending.tvgName || pending.tvgId || "Unnamed channel",
      url,
      logo: pending.logo || "",
      group: pending.group || pendingGroup || "Uncategorized",
      tvgId: pending.tvgId || "",
      tvgName: pending.tvgName || "",
      country: pending.country || pending["tvg-country"] || "",
      language: pending.language || pending["tvg-language"] || "",
      category: pending.category || "",
      attributes: { ...pending.attributes },
    });
    pending = null;
    pendingGroup = "";
  }
  return channels;
}

export function parseExtinf(line) {
  const comma = line.indexOf(",");
  const metadata = comma >= 0 ? line.slice(0, comma) : line;
  const suffixName = comma >= 0 ? line.slice(comma + 1).trim() : "";
  const attributes = {};
  const attrPattern = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match;
  while ((match = attrPattern.exec(metadata))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  const name = suffixName || attributes["tvg-name"] || attributes.name || attributes["channel-name"] || "";
  return {
    name,
    tvgId: attributes["tvg-id"] || "",
    tvgName: attributes["tvg-name"] || "",
    logo: attributes["tvg-logo"] || attributes.logo || "",
    group: attributes["group-title"] || attributes.group || "",
    country: attributes.country || attributes["tvg-country"] || "",
    language: attributes.language || attributes["tvg-language"] || "",
    category: attributes.category || "",
    attributes
  };
}

export function filterChannels(channels, { search = "", group = "all", view = "all", favorites = [], recent = [] } = {}) {
  const term = search.trim().toLocaleLowerCase();
  const favoriteSet = new Set(favorites);
  const recentSet = new Set(recent);
  return channels.filter((channel) => {
    const text = [channel.name, channel.group, channel.country, channel.language, channel.category, channel.tvgId].join(" ").toLocaleLowerCase();
    return (!term || text.includes(term))
      && (group === "all" || channel.group === group)
      && (view !== "favorites" || favoriteSet.has(channel.id))
      && (view !== "recent" || recentSet.has(channel.id));
  });
}

export function classifyStream(url, pageProtocol = globalThis.location?.protocol || "https:") {
  let parsed;
  try { parsed = new URL(url, globalThis.location?.href || "https://localhost/"); } catch {
    return { kind: "invalid", protocol: "", extension: "", mixedContent: false };
  }
  const path = parsed.pathname.toLowerCase();
  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
  const kind = extension === ".m3u8" || parsed.search.toLowerCase().includes(".m3u8") ? "hls"
    : [".mp4", ".m4v", ".mov"].includes(extension) ? "mp4"
    : [".webm", ".ogv"].includes(extension) ? "webm"
    : ["http:", "https:"].includes(parsed.protocol) ? "unknown-http" : "unsupported";
  return { kind, protocol: parsed.protocol, extension, mixedContent: pageProtocol === "https:" && parsed.protocol === "http:" };
}

export function isSafeHttpUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function resolveStreamUrl(value, baseUrl) {
  if (!baseUrl) return value;
  try { return new URL(value, baseUrl).href; } catch { return value; }
}

function stableId(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `ch-${(hash >>> 0).toString(36)}`;
}

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(value) ? value : fallback;
  } catch { return fallback; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode is valid */ }
}

function qs(selector) { return document.querySelector(selector); }
function setText(selector, value) { const node = qs(selector); if (node) node.textContent = value; }

function bootstrap() {
  bindEvents();
  applySavedTheme();
  updateCounts();
  updateDiagnostics();
  const startupUrl = getStartupPlaylistUrl();
  qs("#playlistUrl").value = startupUrl || DEFAULT_PLAYLIST_URL;
  loadPlaylist(startupUrl || DEFAULT_PLAYLIST_URL);
}

function bindEvents() {
  qs("#playlistForm").addEventListener("submit", (event) => {
    event.preventDefault();
    loadPlaylist(qs("#playlistUrl").value.trim());
  });
  qs("#resetPlaylistButton").addEventListener("click", () => {
    qs("#playlistUrl").value = DEFAULT_PLAYLIST_URL;
    loadPlaylist(DEFAULT_PLAYLIST_URL);
  });
  qs("#playlistFile").addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (file) loadPlaylistFile(file);
    event.target.value = "";
  });
  qs("#reloadButton").addEventListener("click", reloadCurrentPlaylist);
  qs("#searchInput").addEventListener("input", debounce((event) => {
    state.searchTerm = event.target.value;
    state.visibleLimit = MAX_RENDERED_CHANNELS;
    qs("#clearSearch").hidden = !state.searchTerm;
    renderDirectory();
  }, 120));
  qs("#clearSearch").addEventListener("click", () => {
    qs("#searchInput").value = "";
    state.searchTerm = "";
    qs("#clearSearch").hidden = true;
    renderDirectory();
  });
  qs("#groupSelect").addEventListener("change", (event) => {
    state.selectedGroup = event.target.value;
    state.visibleLimit = MAX_RENDERED_CHANNELS;
    renderDirectory();
  });
  document.querySelectorAll(".filter-tab").forEach((button) => button.addEventListener("click", () => {
    state.selectedView = button.dataset.view;
    state.visibleLimit = MAX_RENDERED_CHANNELS;
    document.querySelectorAll(".filter-tab").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    renderDirectory();
  }));
  qs("#loadMoreButton").addEventListener("click", () => {
    state.visibleLimit += MAX_RENDERED_CHANNELS;
    renderDirectory();
  });
  qs("#retryButton").addEventListener("click", () => state.selectedChannel && playChannel(state.selectedChannel));
  qs("#copyUrlButton").addEventListener("click", copySelectedUrl);
  qs("#dismissMessage").addEventListener("click", () => { qs("#playerMessage").hidden = true; });
  qs("#videoPlayer").addEventListener("loadstart", () => showPlayerLoading(true, "Loading stream…"));
  qs("#videoPlayer").addEventListener("loadedmetadata", () => {
    showPlayerLoading(false);
    updateConnection("success", "Playing");
    setText("#playerEyebrow", "NOW PLAYING");
  });
  qs("#videoPlayer").addEventListener("playing", () => {
    showPlayerLoading(false);
    updateConnection("success", "Playing");
  });
  qs("#videoPlayer").addEventListener("waiting", () => showPlayerLoading(true, "Buffering stream…"));
  qs("#videoPlayer").addEventListener("error", () => handleMediaError(qs("#videoPlayer").error));
  qs("#themeToggle").addEventListener("click", toggleTheme);
  qs("#aboutButton").addEventListener("click", () => qs("#aboutDialog").showModal());
  qs("#closeAbout").addEventListener("click", () => qs("#aboutDialog").close());
  qs("#closeAboutButton").addEventListener("click", () => qs("#aboutDialog").close());
}

async function loadPlaylist(url) {
  state.localPlaylistText = "";
  if (!isSafeHttpUrl(url)) {
    showPlaylistError("Enter a valid http:// or https:// playlist URL.");
    return;
  }
  const loadToken = ++state.playbackToken;
  state.playlistUrl = url;
  qs("#playlistUrl").value = url;
  setLoading(true, "Downloading playlist…");
  updateConnection("loading", "Loading");
  clearPlayer();
  try {
    const response = await fetchWithTimeout(url, 25000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (loadToken !== state.playbackToken) return;
    setLoading(true, "Parsing channels…");
    installPlaylist(text, url, loadToken);
  } catch (error) {
    if (loadToken !== state.playbackToken) return;
    setLoading(false);
    state.channels = [];
    renderDirectory();
    updateConnection("error", "Load failed");
    showPlaylistError(classifyPlaylistError(error));
  }
}

async function loadPlaylistFile(file) {
  const loadToken = ++state.playbackToken;
  setLoading(true, `Reading ${file.name}…`);
  updateConnection("loading", "Reading file");
  clearPlayer();
  try {
    const text = await file.text();
    if (loadToken !== state.playbackToken) return;
    setLoading(true, "Parsing channels…");
    installPlaylist(text, "", loadToken, file.name);
  } catch {
    setLoading(false);
    state.channels = [];
    renderDirectory();
    updateConnection("error", "File failed");
    showPlaylistError("The selected playlist file could not be read.");
  }
}

function installPlaylist(text, baseUrl, loadToken, sourceLabel = baseUrl) {
  const channels = parseM3U(text, baseUrl);
  if (!channels.length) throw new Error("The playlist contains no valid channel entries.");
  state.localPlaylistText = baseUrl ? "" : text;
  state.playlistUrl = sourceLabel;
  state.channels = channels;
  state.selectedChannel = null;
  state.selectedGroup = "all";
  state.selectedView = "all";
  state.searchTerm = "";
  state.visibleLimit = MAX_RENDERED_CHANNELS;
  qs("#searchInput").value = "";
  qs("#clearSearch").hidden = true;
  populateGroups();
  renderDirectory();
  setLoading(false);
  updateConnection("success", `${channels.length.toLocaleString()} channels`);
  setText("#playerEyebrow", "DIRECTORY READY");
  setText("#playerMeta", `${channels.length.toLocaleString()} channels loaded from ${sourceLabel || "local file"}.`);
  updateDiagnostics();
}

function reloadCurrentPlaylist() {
  if (state.localPlaylistText) {
    const token = ++state.playbackToken;
    setLoading(true, "Rebuilding local playlist…");
    clearPlayer();
    try {
      installPlaylist(state.localPlaylistText, "", token, state.playlistUrl);
    } catch (error) {
      setLoading(false);
      showPlaylistError(classifyPlaylistError(error));
    }
    return;
  }
  loadPlaylist(state.playlistUrl);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal, mode: "cors", cache: "no-store" }); }
  catch (error) {
    if (error.name === "AbortError") throw new Error("The request timed out.");
    throw error;
  } finally { clearTimeout(timeout); }
}

function renderDirectory() {
  state.filteredChannels = filterChannels(state.channels, {
    search: state.searchTerm, group: state.selectedGroup, view: state.selectedView,
    favorites: state.favorites, recent: state.recent
  });
  const list = qs("#channelList");
  list.textContent = "";
  if (!state.filteredChannels.length) {
    const empty = document.createElement("div");
    empty.className = "list-placeholder";
    const icon = document.createElement("span"); icon.className = "placeholder-icon"; icon.textContent = state.channels.length ? "⌕" : "⌁";
    const message = document.createElement("p"); message.textContent = state.channels.length ? "No channels match this view." : "Load a playlist to see channels.";
    empty.append(icon, message); list.append(empty);
  } else {
    const fragment = document.createDocumentFragment();
    state.filteredChannels.slice(0, state.visibleLimit).forEach((channel) => fragment.append(createChannelItem(channel)));
    list.append(fragment);
  }
  qs("#loadMoreButton").hidden = state.filteredChannels.length <= state.visibleLimit;
  setText("#directorySummary", state.channels.length ? `${state.filteredChannels.length.toLocaleString()} result${state.filteredChannels.length === 1 ? "" : "s"}` : "No channels loaded");
  setText("#directoryStats", state.channels.length ? `${state.channels.length.toLocaleString()} total` : "");
  updateCounts();
}

function createChannelItem(channel) {
  const item = document.createElement("div");
  item.className = "channel-item" + (state.selectedChannel?.id === channel.id ? " selected" : "");
  item.setAttribute("role", "listitem");
  item.tabIndex = 0;
  item.setAttribute("aria-label", `Play ${channel.name}`);
  item.addEventListener("click", () => playChannel(channel));
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      playChannel(channel);
    }
  });
  const logo = createLogo(channel, false);
  const copy = document.createElement("span"); copy.className = "channel-copy";
  const name = document.createElement("span"); name.className = "channel-name"; name.textContent = channel.name;
  const subtitle = document.createElement("span"); subtitle.className = "channel-subtitle"; subtitle.textContent = [channel.group, channel.country || channel.language].filter(Boolean).join(" · ");
  copy.append(name, subtitle);
  const favorite = document.createElement("button");
  favorite.className = "favorite-button" + (state.favorites.includes(channel.id) ? " is-favorite" : "");
  favorite.type = "button"; favorite.textContent = state.favorites.includes(channel.id) ? "★" : "☆";
  favorite.setAttribute("aria-label", state.favorites.includes(channel.id) ? `Remove ${channel.name} from favorites` : `Add ${channel.name} to favorites`);
  favorite.addEventListener("click", (event) => { event.stopPropagation(); toggleFavorite(channel.id); });
  item.append(logo, copy, favorite);
  return item;
}

function createLogo(channel, large) {
  const logo = document.createElement("span");
  logo.className = `channel-logo${large ? " large" : ""}`;
  if (large) logo.id = "playerLogo";
  const fallback = document.createElement("span");
  fallback.textContent = channel.name.slice(0, 2).toUpperCase() || "TV";
  logo.append(fallback);
  if (isSafeHttpUrl(channel.logo)) {
    const image = document.createElement("img");
    image.src = channel.logo; image.alt = ""; image.loading = "lazy";
    image.addEventListener("error", () => { image.remove(); });
    logo.append(image);
  }
  return logo;
}

async function playChannel(channel) {
  const token = ++state.playbackToken;
  state.selectedChannel = channel;
  addRecent(channel.id);
  renderDirectory();
  clearPlayer();
  qs("#playerEmpty").hidden = true;
  qs("#videoPlayer").hidden = false;
  const currentLogo = qs("#playerLogo");
  if (currentLogo) currentLogo.replaceWith(createLogo(channel, true));
  setText("#playerEyebrow", "CONNECTING");
  setText("#playerTitle", channel.name);
  setText("#playerMeta", [channel.group, channel.country, channel.language].filter(Boolean).join(" · ") || "External stream");
  qs("#retryButton").disabled = false;
  qs("#copyUrlButton").disabled = false;
  showPlayerError("", "");
  updateDiagnostics(channel);
  const stream = classifyStream(channel.url);
  if (stream.mixedContent) {
    showPlayerError("Mixed content", "This HTTP stream may be blocked because GitHub Pages runs over HTTPS.");
  }
  if (stream.kind === "unsupported" || stream.kind === "invalid") {
    showPlayerError("Unsupported protocol", "This URL uses a protocol that browser media elements cannot open. VLC supports more protocols.");
    updateConnection("error", "Unsupported");
    return;
  }
  showPlayerLoading(true, "Connecting to stream…");
  const video = qs("#videoPlayer");
  const HlsPlayer = stream.kind === "hls" && !video.canPlayType("application/vnd.apple.mpegurl")
    ? await getHlsPlayer()
    : null;
  if (token !== state.playbackToken) return;
  if (stream.kind === "hls" && !video.canPlayType("application/vnd.apple.mpegurl") && HlsPlayer?.isSupported()) {
    state.hls = new HlsPlayer({ enableWorker: true, lowLatencyMode: true });
    state.hls.on(Hls.Events.ERROR, (_event, data) => {
      if (token !== state.playbackToken || !data?.fatal) return;
      const title = data.type === Hls.ErrorTypes.NETWORK_ERROR ? "HLS network error" : data.type === Hls.ErrorTypes.MEDIA_ERROR ? "Unsupported codec" : "HLS playback error";
      showPlayerError(title, "The browser could not play this HLS stream. It may be offline, blocked by CORS, or use an unsupported codec.");
      updateConnection("error", "Stream unavailable");
    });
    state.hls.loadSource(channel.url);
    state.hls.attachMedia(video);
  } else if (stream.kind !== "hls" || video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = channel.url;
    video.load();
  } else {
    showPlayerError("HLS unavailable", "This browser has no native HLS support and the hls.js fallback could not load. Check the network connection or use Safari.");
    updateConnection("error", "Unsupported");
    showPlayerLoading(false);
    return;
  }
  video.play().catch((error) => {
    if (token !== state.playbackToken) return;
    if (error.name === "NotAllowedError") showPlayerError("Press play to start", "The browser blocked autoplay with sound. Use the native player controls.");
  });
}

async function getHlsPlayer() {
  if (globalThis.Hls) return globalThis.Hls;
  const script = document.querySelector('script[src*="hls.min.js"]');
  if (!script) return null;
  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", finish, { once: true });
    setTimeout(finish, 2500);
  });
  return globalThis.Hls || null;
}

function clearPlayer() {
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  const video = qs("#videoPlayer");
  video.pause();
  video.removeAttribute("src");
  video.load();
  showPlayerLoading(false);
  qs("#playerEmpty").hidden = Boolean(state.selectedChannel);
}

function handleMediaError(mediaError) {
  if (!state.selectedChannel) return;
  const code = mediaError?.code;
  const title = code === 3 ? "Unsupported codec" : code === 4 ? "Unsupported format" : "Stream unavailable";
  showPlayerError(title, "The stream may be offline, blocked by CORS, or incompatible with this browser. The same URL may still work in VLC.");
  updateConnection("error", "Stream unavailable");
  showPlayerLoading(false);
}

function showPlaylistError(message) {
  setLoading(false);
  setText("#directorySummary", "Playlist unavailable");
  showPlayerError("Playlist error", message);
}

function classifyPlaylistError(error) {
  if (error.message.includes("no valid")) return error.message;
  if (error.message.includes("timed out")) return "The playlist request timed out. Check the URL or try again.";
  if (/HTTP 4\d\d|HTTP 5\d\d/.test(error.message)) return `The playlist server returned ${error.message.replace("HTTP ", "HTTP ")}.`;
  return "The playlist could not be fetched. The server may be offline or may not allow browser CORS requests.";
}

function showPlayerError(title, message) {
  const banner = qs("#playerMessage");
  banner.hidden = !title;
  setText("#playerMessageTitle", title);
  setText("#playerMessageText", message);
  state.lastError = title ? `${title}: ${message}` : "";
  updateDiagnostics(state.selectedChannel);
}

function showPlayerLoading(visible, text = "Loading stream…") {
  qs("#playerLoading").hidden = !visible;
  setText("#playerLoadingText", text);
}

function setLoading(visible, text = "Loading playlist…") {
  qs("#playlistProgress").hidden = !visible;
  setText("#progressText", text);
  qs("#loadPlaylistButton").disabled = visible;
  qs("#reloadButton").disabled = visible;
}

function updateConnection(stateName, text) {
  const connection = qs("#connectionState");
  connection.dataset.state = stateName;
  setText("#connectionText", text);
}

function populateGroups() {
  const select = qs("#groupSelect");
  select.textContent = "";
  const all = document.createElement("option"); all.value = "all"; all.textContent = `All groups (${state.channels.length.toLocaleString()})`; select.append(all);
  const groupCounts = new Map();
  state.channels.forEach((channel) => {
    const group = channel.group || "Uncategorized";
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
  });
  const groups = [...groupCounts.keys()].sort((a, b) => a.localeCompare(b));
  groups.forEach((group) => {
    const option = document.createElement("option"); option.value = group; option.textContent = `${group} (${groupCounts.get(group)})`; select.append(option);
  });
}

function getStartupPlaylistUrl() {
  try {
    const candidate = new URLSearchParams(globalThis.location.search).get("playlist");
    return candidate && isSafeHttpUrl(candidate) ? candidate : "";
  } catch { return ""; }
}

function updateCounts() {
  const allTab = document.querySelector('[data-view="all"] span');
  const favoritesTab = document.querySelector('[data-view="favorites"] span');
  if (allTab) allTab.textContent = state.channels.length.toLocaleString();
  if (favoritesTab) favoritesTab.textContent = state.favorites.filter((id) => state.channels.some((channel) => channel.id === id)).length;
}

function toggleFavorite(id) {
  state.favorites = state.favorites.includes(id) ? state.favorites.filter((item) => item !== id) : [...state.favorites, id];
  writeStorage("streamdeck-favorites", state.favorites);
  renderDirectory();
}

function addRecent(id) {
  state.recent = [id, ...state.recent.filter((item) => item !== id)].slice(0, RECENT_LIMIT);
  writeStorage("streamdeck-recent", state.recent);
}

async function copySelectedUrl() {
  if (!state.selectedChannel) return;
  try {
    await navigator.clipboard.writeText(state.selectedChannel.url);
    showToast("Stream URL copied");
  } catch { showToast("Clipboard access is unavailable"); }
}

function updateDiagnostics(channel = state.selectedChannel) {
  const grid = qs("#diagnosticsGrid");
  if (!grid) return;
  grid.textContent = "";
  const stream = channel ? classifyStream(channel.url) : null;
  const values = [
    ["Playlist", state.playlistUrl],
    ["Channel", channel?.name || "—"],
    ["Detected type", stream?.kind || "—"],
    ["Protocol", stream?.protocol || "—"],
    ["Native HLS", qs("#videoPlayer")?.canPlayType("application/vnd.apple.mpegurl") || "no"],
    ["hls.js", globalThis.Hls ? "available" : "not loaded"],
    ["Last error", state.lastError || "—"]
  ];
  values.forEach(([key, value]) => {
    const row = document.createElement("div");
    const label = document.createElement("span"); label.textContent = key;
    const data = document.createElement("span"); data.textContent = value;
    row.append(label, data); grid.append(row);
  });
}

function toggleTheme() {
  document.documentElement.classList.toggle("light");
  try { localStorage.setItem("streamdeck-theme", document.documentElement.classList.contains("light") ? "light" : "dark"); } catch {}
}

function applySavedTheme() {
  try { if (localStorage.getItem("streamdeck-theme") === "light") document.documentElement.classList.add("light"); } catch {}
}

function showToast(message) {
  const toast = qs("#toast");
  toast.textContent = message; toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function debounce(callback, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), delay); };
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", bootstrap);
}