# VoiceKeepAlive

An experimental desktop plugin for voice calls that disconnect while Discord is hidden, minimized, covered, or on another desktop, then reconnect when Discord receives focus.

While a voice channel is selected, the plugin disables Electron's background throttling. By default, it also requests `prevent-app-suspension` to keep the system active while allowing the display to turn off. Disable **Prevent sleep** in the plugin settings if you only want background throttling disabled.

The plugin restores the previous throttling setting and releases its sleep blocker when you leave voice, disable the plugin, log out, reload Discord, or close the window. A renderer crash also releases these resources.

## Enable

1. Build Equicord with this userplugin included.
2. Fully quit Discord and reopen it. A reload alone cannot load the new native helper.
3. Enable **VoiceKeepAlive** under Settings > Equicord > Plugins.
4. Join a voice channel, then leave Discord offscreen for longer than the usual disconnect interval.

This targets background throttling and automatic sleep. It does not guarantee a fix for network failures, server disconnects, forced sleep, or closing a laptop lid. It does not send extra Discord requests or automatically rejoin voice channels. Keeping Discord active can increase CPU and battery use during calls.

API references: [Electron background throttling](https://www.electronjs.org/docs/latest/api/web-contents#contentssetbackgroundthrottlingallowed), [Electron power save blocker](https://www.electronjs.org/docs/latest/api/power-save-blocker).
