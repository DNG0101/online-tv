import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PLAYLIST_URL, filterChannels, isSafeHttpUrl, parseExtinf, parseM3U, classifyStream } from "../app.js";

const sample = `#EXTM3U
#EXTINF:-1 tvg-id="news.one" tvg-name="News One" tvg-logo="https://img.example/logo.png" group-title="News" tvg-country="US" tvg-language="English",News One
https://stream.example/news.m3u8

# a comment
#EXTINF:-1 group-title="Sports",Sports HD
https://stream.example/sports.mp4
#EXTINF:-1,Unnamed fallback
https://stream.example/fallback.webm
#EXTINF:-1 group-title="Broken"
not-a-valid-stream
#EXTINF:-1 group-title="Legacy",Legacy VLC
rtsp://stream.example/live
`;

test("keeps the official default playlist immutable", () => {
  assert.equal(DEFAULT_PLAYLIST_URL, "https://iptv-org.github.io/iptv/index.m3u");
});

test("parses metadata and normalizes missing fields", () => {
  const channels = parseM3U(sample);
  assert.equal(channels.length, 5);
  assert.deepEqual(channels[0], {
    id: channels[0].id,
    name: "News One",
    url: "https://stream.example/news.m3u8",
    logo: "https://img.example/logo.png",
    group: "News",
    tvgId: "news.one",
    tvgName: "News One",
    country: "US",
    language: "English",
    category: "",
    attributes: {
      "tvg-id": "news.one", "tvg-name": "News One", "tvg-logo": "https://img.example/logo.png",
      "group-title": "News", "tvg-country": "US", "tvg-language": "English"
    }
  });
  assert.equal(channels[1].group, "Sports");
  assert.equal(channels[2].group, "Uncategorized");
  assert.ok(channels.every((channel) => channel.id));
});

test("handles single quotes, unquoted attributes, and a missing display name", () => {
  const parsed = parseExtinf("#EXTINF:-1 tvg-id='x' group-title=Kids tvg-name='Cartoon',");
  assert.equal(parsed.name, "Cartoon");
  assert.equal(parsed.group, "Kids");
  assert.equal(parsed.tvgId, "x");
});

test("resolves relative stream URLs and EXTGRP metadata against the playlist URL", () => {
  const channels = parseM3U("#EXTM3U\n#EXTINF:-1 tvg-id=\"relative\"\n#EXTGRP:Regional\nstreams/live.m3u8", "https://example.com/lists/index.m3u");
  assert.equal(channels[0].group, "Regional");
  assert.equal(channels[0].url, "https://example.com/lists/streams/live.m3u8");
});

test("isolates malformed entries and retains unsupported protocols for a clear UI message", () => {
  const channels = parseM3U("#EXTM3U\n#EXTINF:-1,Good\nhttps://a.example/a.m3u8\n#EXTINF:-1,Bad\n");
  assert.equal(channels.length, 1);
  assert.equal(parseM3U("#EXTM3U\n#EXTINF:-1,Bad\njavascript:alert(1)").length, 1);
  assert.equal(classifyStream("rtsp://stream.example/live").kind, "unsupported");
});

test("filters by search, group, favorites, and recent view", () => {
  const channels = parseM3U(sample);
  assert.equal(filterChannels(channels, { search: "english" }).length, 1);
  assert.equal(filterChannels(channels, { group: "Sports" }).length, 1);
  assert.equal(filterChannels(channels, { view: "favorites", favorites: [channels[2].id] }).length, 1);
  assert.equal(filterChannels(channels, { view: "recent", recent: [channels[4].id] })[0].name, "Legacy VLC");
});

test("validates playlist URLs without accepting executable schemes", () => {
  assert.equal(isSafeHttpUrl(DEFAULT_PLAYLIST_URL), true);
  assert.equal(isSafeHttpUrl("https://example.com/list.m3u"), true);
  assert.equal(isSafeHttpUrl("javascript:alert(1)"), false);
  assert.equal(isSafeHttpUrl("data:text/plain,playlist"), false);
});

test("classifies HLS, native media, mixed content, and unknown HTTP streams", () => {
  assert.equal(classifyStream("https://example.com/live.m3u8").kind, "hls");
  assert.equal(classifyStream("https://example.com/movie.mp4").kind, "mp4");
  assert.equal(classifyStream("https://example.com/clip.webm").kind, "webm");
  assert.equal(classifyStream("http://example.com/live.m3u8").mixedContent, true);
  assert.equal(classifyStream("https://example.com/live").kind, "unknown-http");
});

test("supports large playlists without losing duplicate display names", () => {
  const text = "#EXTM3U\n" + Array.from({ length: 10000 }, (_, i) => `#EXTINF:-1 group-title="Group ${i % 10}",Same Name\nhttps://example.com/${i}.m3u8`).join("\n");
  const channels = parseM3U(text);
  assert.equal(channels.length, 10000);
  assert.equal(new Set(channels.map((channel) => channel.id)).size, 10000);
});