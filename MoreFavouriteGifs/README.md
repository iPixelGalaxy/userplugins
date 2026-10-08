# MoreFavouriteGifs

Equicord userplugin. Discord caps favourite GIFs by the size of your settings data (about 745 KB). Once that cap is hit, new favourites are saved by the plugin instead of showing the "limit reached" alert, and merged into the GIF picker's Favorites list.

## Install

1. Copy these files into `src/userplugins/moreFavouriteGifs/` in your Equicord checkout.
2. `pnpm build`, then restart Discord.
3. Enable **MoreFavouriteGifs** in Plugins.

The plugin uses `EquicordDevs.stormanzanii`, which is added to `src/utils/constants.ts` in the Equicord PR.

## Where the GIFs are stored

- Normal use: a plugin-owned key in Equicord's DataStore (`MoreFavouriteGifs_gifs`).
- **Equicord Cloud:** cloud settings sync already uploads the DataStore. Because DataStore writes don't count as settings changes, the plugin marks settings as changed and queues a push after each save. Turn this off with the **cloudSync** setting. It does nothing unless settings sync is enabled and connected in Equicord's Cloud settings.
- **Backup file:** use **Export Backup** and **Import Backup** in the plugin settings to save your local favourites to a JSON file or restore them. Importing keeps the GIFs you already have.

## Notes

- Local favourites are stored by Equicord, not by Discord, so they only show up in Discord clients that run this plugin. They are not part of your Discord account.
- Unfavouriting a local GIF removes it from the local list.
