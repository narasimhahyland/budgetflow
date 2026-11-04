const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      additionalEntryPoints: [
        { entryName: 'migrate', entryPath: 'apps/api/src/migrate.ts' },
        { entryName: 'seed', entryPath: 'apps/api/src/seed.ts' },
      ],
      tsConfig: './tsconfig.app.json',
      assets: [{ input: 'libs/api/db/migrations', glob: '**/*', output: 'migrations' }],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
