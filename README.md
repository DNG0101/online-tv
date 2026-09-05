# Streamdeck IPTV

Streamdeck is a static, browser-based IPTV playlist player designed for GitHub Pages. It automatically loads the default M3U library, builds a searchable channel directory, and attempts playback with native HTML5 video or hls.js.

## Default playlist

The first load always attempts:

`https://iptv-org.github.io/iptv/index.m3u`

Use the URL field to load another `.m3u` or `.m3u8` playlist. **Reset** restores the default, and **Reload** refetches the current URL. You can also use **Open file** to load a playlist downloaded to your device; this is the browser-safe route when a remote playlist does not allow CORS. Favorites, recent channels, and the theme preference are stored locally in the browser; no account, database, or server is required.

For a direct-link variant, append an encoded playlist URL to the Pages URL:

`https://<username>.github.io/<repository>/?playlist=https%3A%2F%2Fexample.com%2Fchannels.m3u`

The hard-coded default remains unchanged when no valid `playlist` parameter is present.

## Run locally

Because browsers restrict some `file://` behavior, serve the folder with any static server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The site has no build step and no runtime backend.

## Deploy to GitHub Pages

1. Create a repository and copy the contents of this folder into its root.
2. Push the files to the default branch.
3. In **Settings → Pages**, choose **Deploy from a branch**, select the default branch and `/ (root)`, then save.
4. Open `https://<username>.github.io/<repository>/`.

All application asset references are relative, so the site works from a repository subdirectory. `.nojekyll` is included to avoid unnecessary Jekyll processing. A GitHub Actions workflow is also included if you prefer Actions-based Pages deployment.

## Browser limitations

- HLS plays natively in Safari and some other browsers. In browsers without native HLS, hls.js is loaded from jsDelivr and uses Media Source Extensions when available.
- MP4 and WebM playback depends on the browser's codecs.
- RTMP, RTSP, UDP, MPEG-TS, proprietary protocols, and unsupported codecs cannot be made browser-compatible by this static application.
- VLC supports substantially more protocols and codecs than a normal browser. A stream that plays in VLC may fail here.
- GitHub Pages is HTTPS. HTTP streams may be blocked as mixed content.
- Playlist fetching and media playback must satisfy the external provider's CORS policy. GitHub Pages does not proxy or bypass CORS. The local-file route avoids playlist-fetch CORS because the browser reads the file selected by the user; individual stream URLs still need browser access.
- Autoplay with sound may be blocked. Use the native player controls when prompted.

The app classifies common failures (playlist fetch errors, timeouts, HTTP errors, mixed content, unsupported protocols/codecs, HLS errors, and likely CORS/network failures) without taking down the rest of the directory.

## Supported input and playback routes

1. **Remote playlist URL:** fetches an HTTP(S) M3U/M3U8 playlist with a timeout and CORS-aware error handling.
2. **Local playlist file:** reads `.m3u`, `.m3u8`, or text files in the browser without uploading them anywhere.
3. **Native HLS:** used when `video.canPlayType()` reports support.
4. **hls.js HLS:** used when native HLS is unavailable and Media Source Extensions plus hls.js are available.
5. **Progressive media:** native HTML5 playback for MP4, WebM, OGV, and similar browser-supported files.
6. **Unsupported protocols:** RTSP, RTMP, UDP, MPEG-TS-only, and proprietary URLs stay visible in the directory but receive an honest compatibility message.

Relative stream URLs are resolved against the remote playlist URL. `#EXTGRP`, common `EXTINF` attributes, missing logos, duplicate names, and malformed individual entries are handled without stopping the remaining catalogue.

## Test suite

The pure parser, filtering, URL validation, and stream classification tests can be run with Node 18+:

```bash
npm test
```

The browser matrix still depends on the browser and external stream providers. The test suite intentionally does not claim that a live third-party channel is permanently online. Native HLS, hls.js, progressive media, autoplay, CORS, mixed-content, codec, offline, and rapid-switching paths are implemented defensively, but live-provider behavior must still be checked in the target browser.