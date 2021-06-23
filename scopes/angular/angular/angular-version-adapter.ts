import { ParsedConfiguration } from '@angular/compiler-cli';
import { BundlerContext, DevServerContext } from '@teambit/bundler';
import { VariantPolicyConfigObject } from '@teambit/dependency-resolver';
import { Logger } from '@teambit/logger';
import { PubsubMain } from '@teambit/pubsub';
import { WebpackConfigWithDevServer } from '@teambit/webpack';
import webpack, { Configuration } from 'webpack';
import WsDevServer from 'webpack-dev-server';

export interface NgPackagr {
  /**
   * Sets the path to the user's "ng-package" file (either `package.json`, `ng-package.json`, or `ng-package.js`)
   *
   * @param project File path
   * @return Self instance for fluent API
   */
  forProject(project: string): NgPackagr;
  /**
   * Overwrites the default TypeScript configuration.
   *
   * @param defaultValues A tsconfig providing default values to the compilation.
   * @return Self instance for fluent API
   */
  withTsConfig(defaultValues: ParsedConfiguration | string): NgPackagr;
  /**
   * Builds the project by kick-starting the 'build' transform over an (initially) empty `BuildGraph``
   *
   * @return A promisified result of the transformation pipeline.
   */
  build(): Promise<void>;
}

export enum WebpackSetup {
  Serve = 'serve',
  Build = 'build'
}

export interface AngularVersionAdapter {
  /**
   * List of dependencies
   * Required for any task
   */
  dependencies: VariantPolicyConfigObject | Promise<VariantPolicyConfigObject>;

  ngPackagr: NgPackagr;

  webpack: Partial<typeof webpack>;

  webpackDevServer: Partial<typeof WsDevServer>;

  webpackServeConfigFactory: (devServerID: string, workspaceDir: string, entryFiles: string[], publicRoot: string, publicPath: string, pubsub: PubsubMain) => WebpackConfigWithDevServer
  webpackBuildConfigFactory: (entryFiles: string[], rootPath: string) => Configuration

  /**
   * Get the default Angular webpack config.
   */
  getWebpackConfig(context: DevServerContext | BundlerContext, entryFiles: string[], tsConfigPath: string, rootPath: string, logger: Logger, setup: WebpackSetup, extraOptions: Partial<WebpackConfigWithDevServer>): Promise<WebpackConfigWithDevServer | Configuration>;
}
