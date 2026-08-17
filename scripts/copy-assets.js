import { copyFile, mkdir } from 'node:fs/promises';

await mkdir(new URL('../stream/vendor/', import.meta.url), { recursive: true });
await Promise.all([
  copyFile(new URL('../node_modules/dashjs/dist/modern/umd/dash.all.min.js', import.meta.url), new URL('../stream/vendor/dash.js', import.meta.url)),
  copyFile(new URL('../node_modules/plyr/dist/plyr.css', import.meta.url), new URL('../stream/vendor/plyr.css', import.meta.url)),
  copyFile(new URL('../node_modules/plyr/dist/plyr.polyfilled.min.js', import.meta.url), new URL('../stream/vendor/plyr.js', import.meta.url)),
  copyFile(new URL('../node_modules/plyr/dist/plyr.svg', import.meta.url), new URL('../stream/vendor/plyr.svg', import.meta.url))
]);
