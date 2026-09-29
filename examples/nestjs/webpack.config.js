// webpackConfigFactory — `nest build` calls this with its default config.
// Only addition: TsconfigPathsPlugin resolves the @atolljs/core/* aliases.
// Worker bundles need no entries here — webpack detects every literal
// `new Worker(new URL('./x.worker.ts', import.meta.url))` in the feature
// modules and emits each as its own chunk automatically.
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

module.exports = (config) => {
  config.resolve.plugins = [
    ...(config.resolve.plugins ?? []),
    new TsconfigPathsPlugin({ configFile: 'tsconfig.json' }),
  ];
  return config;
};
