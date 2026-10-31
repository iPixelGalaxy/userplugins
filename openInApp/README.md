# OpenInApp userplugin

This standalone fork replaces Equicord's bundled OpenInApp without changing the
main repository. Keep both `openInApp` and `openInAppNative.desktop` in
`src/userplugins` and build Equicord normally.
Enable **OpenInApp** under **Show UserPlugins**, then restart Discord after loading
the new build. The existing enabled state and app settings are preserved.
The plugin card explicitly identifies this as an independent userplugin and shows
the **User Plugin** badge instead of Equicord's modified plugin badge.

The desktop helper registers as `OpenInAppNative`, which avoids colliding with
the bundled OpenInApp native helper. It is enabled automatically and has no
separate settings or toggle.

The **Spotify app** dropdown sits immediately below the **Spotify** toggle.
Choose **Spotify** or **Lyssna** (the default). Existing SpotiFlex selections
migrate to Lyssna automatically. The toggle controls whether
Spotify links open in an app at all. Changing the selected app takes effect
when settings are saved, without another restart.

Spotify links in messages, supported short links, and connected Spotify accounts
use the selected app. Steam, Epic Games, Tidal, iTunes, VRCX, and Telegram retain
their existing behavior. MusicControls' own Spotify URI setting is separate;
its player links are not handled by OpenInApp.

## Lyssna URL support

Lyssna's URL implementation accepts these URLs when starting and when already
running. The installed app must register the `lyssna` protocol with the OS:

```text
lyssna://track/<id>
lyssna://album/<id>
lyssna://artist/<id>
lyssna://playlist/<id>
lyssna://user/<id>
lyssna://episode/<id>
lyssna://show/<id>
```

Track links start playback. Album, artist, playlist, and user links open their
pages. Episode and show links bring Lyssna forward without playing a podcast.
Prerelease links use Spotify because Lyssna does not support them. Spotify
tracking query strings and fragments are omitted.

Pulling Lyssna source does not update its installed app or register the URL
handler. On macOS, rebuild and install the app with `CFBundleURLTypes` containing
the `lyssna` scheme, then launch it. A missing handler causes the plugin's
"Could not open Lyssna" message even when the source supports these URLs.

This fork does not launch a development checkout or require a hardcoded installation path. The
native helper opens only the listed Lyssna URLs, so no changes to Equicord's
global protocol allowlist are needed. Lyssna is available only on desktop.

The source is derived from Equicord's OpenInApp and retains its GPL-3.0-or-later
license and upstream attribution.
