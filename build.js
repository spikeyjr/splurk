const esbuild = require('esbuild')

esbuild.build({
  entryPoints: ['renderer/js/app.js'],
  bundle: true,
  outfile: 'renderer/js/bundle.js',
  platform: 'browser',
  format: 'iife',
  external: ['electron'],
  logLevel: 'info',
}).catch(() => process.exit(1))
