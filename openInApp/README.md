# OpenInApp userplugin

This standalone fork replaces Equicord's bundled OpenInApp without changing the
main repository. Keep this directory in `src/userplugins` and build Equicord normally.
Enable **OpenInApp** under **Show UserPlugins**, then restart Discord after loading
the new build. The existing enabled state and app settings are preserved.

The **Spotify app** dropdown sits immediately below the **Spotify** toggle.
Choose **Spotify** or **SpotiFlex** (the default). The toggle controls whether
Spotify links open in an app at all. Changing the selected app takes effect
when settings are saved, without another restart.

Spotify links in messages, supported short links, and connected Spotify accounts
use the selected app. Steam, Epic Games, Tidal, iTunes, VRCX, and Telegram retain
their existing behavior. MusicControls' own Spotify URI setting is separate;
its player links are not handled by OpenInApp.

## SpotiFlex URL contract

SpotiFlex must register the `spotiflex` protocol with the operating system and
handle these URLs when starting and when already running:

```text
spotiflex://track/<id>
spotiflex://album/<id>
spotiflex://artist/<id>
spotiflex://playlist/<id>
spotiflex://user/<id>
spotiflex://episode/<id>
spotiflex://prerelease/<id>
```

Connected account usernames are percent encoded. Spotify tracking query strings
and fragments are omitted. The URL should navigate to the corresponding item;
opening a link should not automatically start playback.

This fork assumes the SpotiFlex maintainer supplies that support. It does not
launch a development checkout or require a hardcoded installation path. The
native helper opens only the listed SpotiFlex URLs, so no changes to Equicord's
global protocol allowlist are needed. SpotiFlex is available only on desktop.

The source is derived from Equicord's OpenInApp and retains its GPL-3.0-or-later
license and upstream attribution.
