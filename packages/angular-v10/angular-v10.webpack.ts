import { BuilderContext } from '@angular-devkit/architect';
import { DevServerBuilderOptions } from '@angular-devkit/build-angular';
import {
  getBrowserConfig,
  getCommonConfig,
  getStatsConfig,
  getStylesConfig,
  getAotConfig,
  getNonAotConfig
} from '@angular-devkit/build-angular/src/angular-cli-files/models/webpack-configs';
import {
  WebpackConfigOptions
} from '@angular-devkit/build-angular/src/angular-cli-files/models/build-options';
import {
  OutputHashing,
  Schema as BrowserBuilderSchema
} from '@angular-devkit/build-angular/src/browser/schema';
import { buildServerConfig } from '@angular-devkit/build-angular/src/dev-server';
import { normalizeBrowserSchema } from '@angular-devkit/build-angular/src/utils';
import { generateEntryPoints } from '@angular-devkit/build-angular/src/angular-cli-files/utilities/package-chunk-sort';
import {
  BrowserWebpackConfigOptions,
  generateWebpackConfig,
  getIndexOutputFile
} from '@angular-devkit/build-angular/src/utils/webpack-browser-config';
import { IndexHtmlWebpackPlugin } from '@angular-devkit/build-angular/src/angular-cli-files/plugins/index-html-webpack-plugin';
import { getSystemPath, logging, normalize, tags } from '@angular-devkit/core';
import { NodeJsSyncHost } from '@angular-devkit/core/node';
import { AngularWebpack, optionValue, WebpackSetup } from '@teambit/angular';
import { BundlerContext, DevServerContext } from '@teambit/bundler';
import { Logger } from '@teambit/logger';
import { WebpackConfigWithDevServer, WebpackMain } from '@teambit/webpack';
import { Workspace } from '@teambit/workspace';
import { PkgMain } from '@teambit/pkg';
import path from 'path';
import webpack, { Configuration } from 'webpack';
import WsDevServer, { addDevServerEntrypoints } from 'webpack-dev-server';
import { AngularV10Aspect } from './angular-v10.aspect';
import { webpack4BuildConfigFactory } from './webpack/webpack4.build.config';
import { webpack4ServeConfigFactory } from './webpack/webpack4.serve.config';

function getCompilerConfig(wco: WebpackConfigOptions): webpack.Configuration {
  if (wco.buildOptions.main || wco.buildOptions.polyfills) {
    return wco.buildOptions.aot ? getAotConfig(wco) : getNonAotConfig(wco);
  }

  return {};
}

export class AngularV10Webpack extends AngularWebpack {
  enableIvy = true;
  webpackDevServer = WsDevServer;
  webpackServeConfigFactory = webpack4ServeConfigFactory;
  webpackBuildConfigFactory = webpack4BuildConfigFactory;
  webpack: typeof webpack;

  constructor(workspace: Workspace | undefined, webpackMain: WebpackMain, pkg: PkgMain) {
    super(workspace, webpackMain, pkg, AngularV10Aspect);
    // resolving to the webpack used by angular devkit to avoid multiple instances of webpack
    // otherwise, if we use a different version, it would break
    const buildAngular = require.resolve('@angular-devkit/build-angular');
    const webpackPath = require.resolve('webpack', { paths: [buildAngular] });
    this.webpack = require(webpackPath);
  }

  /**
   * Migrate options from webpack-dev-server 3 to 4
   */
  private migrateConfiguration(webpackConfig: Configuration): Configuration {
    /**
     * Removed contentBase in favor of the static option
     */
    // @ts-ignore
    delete webpackConfig.devServer.contentBase;

    return webpackConfig;
  }

  async getWebpackConfig(
    context: DevServerContext | BundlerContext,
    entryFiles: string[],
    tsconfigPath: string,
    workspaceRoot: string,
    logger: Logger,
    setup: WebpackSetup,
    webpackOptions: Partial<WebpackConfigWithDevServer | Configuration> = {},
    angularOptions: Partial<BrowserBuilderSchema> = {}
  ): Promise<WebpackConfigWithDevServer | Configuration> {
    // Options from angular.json
    const browserOptions: BrowserBuilderSchema = {
      ...angularOptions,
      baseHref: path.posix.join('/', context.rootPath!, context.publicPath!),
      preserveSymlinks: false,
      outputPath: 'public', // doesn't matter because it will be deleted from the config
      index: 'src/index.html',
      main: 'src/main.ts',
      polyfills: 'src/polyfills.ts',
      tsConfig: tsconfigPath,
      assets: ['src/favicon.ico', 'src/assets', ...(angularOptions.assets || [])],
      styles: ['src/styles.scss', ...(angularOptions.styles || [])],
      scripts: angularOptions.scripts,
      vendorChunk: optionValue(angularOptions.vendorChunk, true),
      namedChunks: optionValue(angularOptions.namedChunks, true),
      optimization: optionValue(angularOptions.optimization, setup === WebpackSetup.Build),
      buildOptimizer: optionValue(angularOptions.buildOptimizer, setup === WebpackSetup.Build),
      aot: optionValue(angularOptions.aot, true),
      deleteOutputPath: optionValue(angularOptions.deleteOutputPath, true),
      sourceMap: optionValue(angularOptions.sourceMap, setup === WebpackSetup.Serve),
      outputHashing: optionValue(angularOptions.outputHashing, setup === WebpackSetup.Build ? OutputHashing.All : OutputHashing.None),
      watch: setup === WebpackSetup.Serve,
      allowedCommonJsDependencies: ['@teambit/harmony', 'graphql', '@teambit/documenter.ng.content.copy-box', ...(angularOptions.allowedCommonJsDependencies || [])],
    };

    const normalizedWorkspaceRoot = normalize(workspaceRoot);
    const projectRoot = normalize('');
    const sourceRoot = normalize('src');

    const host = new NodeJsSyncHost();
    const normalizedOptions = normalizeBrowserSchema(host, normalizedWorkspaceRoot, projectRoot, sourceRoot, {
      ...browserOptions,
      ...(webpackOptions as Partial<BrowserBuilderSchema & DevServerBuilderOptions>),
    });

    const loggerApi = {
      createChild: () => logger as any,
      ...logger,
      log: logger.console,
    } as any as logging.LoggerApi;

    const webpackConfig: any = await generateWebpackConfig(
      {builder: {
        builderName: 'browser'
      }} as BuilderContext,
      getSystemPath(normalizedWorkspaceRoot),
      getSystemPath(projectRoot),
      getSystemPath(sourceRoot),
      normalizedOptions,
      (wco: BrowserWebpackConfigOptions) => [
        getCommonConfig(wco),
        getBrowserConfig(wco),
        getStylesConfig(wco), // TODO
        getStatsConfig(wco),
        getCompilerConfig(wco),
      ],
      loggerApi
    );

    if(setup === WebpackSetup.Serve) {
      webpackConfig.devServer = buildServerConfig(
        normalizedWorkspaceRoot,
        webpackOptions as DevServerBuilderOptions,
        browserOptions,
        loggerApi
      );
    }

    // Add bit generated files to the list of entries
    webpackConfig.entry.main.unshift(...entryFiles);

    // @ts-ignore
    if (webpackOptions.liveReload && !webpackOptions.hmr) {
      // This is needed because we cannot use the inline option directly in the config
      // because of the SuppressExtractedTextChunksWebpackPlugin
      // Consider not using SuppressExtractedTextChunksWebpackPlugin when liveReload is enable.
      // tslint:disable-next-line: no-any
      addDevServerEntrypoints(webpackConfig as any, {
        ...(webpackConfig as any).devServer,
        inline: true,
      });

      // Remove live-reload code from all entrypoints but not main.
      // Otherwise this will break SuppressExtractedTextChunksWebpackPlugin because
      // 'addDevServerEntrypoints' adds additional entry-points to all entries.
      if (
        webpackConfig.entry &&
        typeof webpackConfig.entry === 'object' &&
        !Array.isArray(webpackConfig.entry) &&
        webpackConfig.entry.main
      ) {
        for (const [key, value] of Object.entries(webpackConfig.entry)) {
          if (key === 'main' || !Array.isArray(value)) {
            // eslint-disable-next-line no-continue
            continue;
          }

          const webpackClientScriptIndex = value.findIndex((x) => x.includes('webpack-dev-server/client/index.js'));
          if (webpackClientScriptIndex >= 0) {
            // Remove the webpack-dev-server/client script from array.
            value.splice(webpackClientScriptIndex, 1);
          }
        }
      }
    }

    // @ts-ignore
    if (webpackOptions.hmr) {
      logger.warn(tags.stripIndents`NOTICE: Hot Module Replacement (HMR) is enabled for the dev server.
      See https://webpack.js.org/guides/hot-module-replacement for information on working with HMR for Webpack.`);
    }

    const { scripts = [], styles = [] } = browserOptions;
    const entrypoints = generateEntryPoints({ scripts, styles });
    if (!webpackConfig.plugins) {
      webpackConfig.plugins = [];
    }
    webpackConfig.plugins.push(
      new IndexHtmlWebpackPlugin({
        input: path.resolve(workspaceRoot, browserOptions.index as string),
        output: getIndexOutputFile(browserOptions),
        baseHref: browserOptions.baseHref || '/',
        entrypoints,
        moduleEntrypoints: [],
        noModuleEntrypoints: ['polyfills-es5'],
        deployUrl: browserOptions.deployUrl,
        sri: browserOptions.subresourceIntegrity,
        crossOrigin: browserOptions.crossOrigin,
        lang: 'en-US', // TODO(ocombe) support locale
      })
    );

    // don't use the output path from angular
    delete webpackConfig?.output?.path;
    webpackConfig.stats = 'errors-only';
    webpackConfig.context = workspaceRoot;

    if (setup === WebpackSetup.Serve) {
      return this.migrateConfiguration(webpackConfig);
    }


    return webpackConfig;
  }
}
