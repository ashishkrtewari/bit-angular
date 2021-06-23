import { BuildContext, BuiltTaskResult, ComponentResult } from '@teambit/builder';
import { Compiler, TranspileComponentParams } from '@teambit/compiler';
import { Component } from '@teambit/component';
import PackageJsonFile from '@teambit/legacy/dist/consumer/component/package-json-file';
import AbstractVinyl from '@teambit/legacy/dist/consumer/component/sources/abstract-vinyl';
import DataToPersist from '@teambit/legacy/dist/consumer/component/sources/data-to-persist';
import { Logger } from '@teambit/logger';
import { Workspace } from '@teambit/workspace';
import { readDefaultTsConfig } from 'ng-packagr/lib/ts/tsconfig';
import { extname, join, resolve, posix } from 'path';
import removeFilesAndEmptyDirsRecursively
  from '@teambit/legacy/dist/utils/fs/remove-files-and-empty-dirs-recursively';
import { TsConfigSourceFile } from 'typescript';
import { NgPackagr } from '@teambit/angular';

import { NgPackagrOptions } from './ng-packagr-options';

export class NgPackagrCompiler implements Compiler {
  displayName = 'NgPackagr compiler';
  distDir: string;
  distGlobPatterns: string[];
  shouldCopyNonSupportedFiles: boolean;
  artifactName: string;

  constructor(
    readonly id: string,
    private ngPackagr: NgPackagr,
    private logger: Logger,
    private workspace: Workspace,
    // TODO(ocombe): use this to support custom tsConfig
    private tsConfig?: TsConfigSourceFile,
    private options: NgPackagrOptions = {}
  ) {
    this.distDir = options.distDir || 'dist';
    this.distGlobPatterns = options.distGlobPatterns || [`${this.distDir}/**`];
    this.shouldCopyNonSupportedFiles =
      typeof options.shouldCopyNonSupportedFiles === 'boolean' ? options.shouldCopyNonSupportedFiles : true;
    this.artifactName = options.artifactName || 'dist';
  }

  private async ngPackagrCompilation(pathToComponent: string, pathToOutputFolder: string): Promise<void> {
    // disable logger temporarily so that it doesn't mess up with ngPackagr logs
    this.logger.off();

    // update ngPackage entry in package.json for ngPackagr
    const packageJson = await PackageJsonFile.load(pathToOutputFolder, '');
    packageJson.addOrUpdateProperty('ngPackage', {
      lib: {
        entryFile: join(pathToComponent, 'public-api.ts')
      }
    });
    await packageJson.write();

    let ngPackage = this.ngPackagr;

    if (this.options.allowJs) {
      const parsedTsConfig = readDefaultTsConfig();
      parsedTsConfig.options.allowJs = true;
      ngPackage = ngPackage.withTsConfig(parsedTsConfig);
    }

    return ngPackage
      .forProject(join(pathToOutputFolder, 'package.json'))
      .build()
      .then(async() => {
        // copy over properties generated by ngPackagr
        const tempPackageJson = (await PackageJsonFile.load(pathToOutputFolder, this.distDir)).packageJsonObject;
        packageJson.mergePackageJsonObject({
          main: posix.join(this.distDir, tempPackageJson.main),
          module: posix.join(this.distDir, tempPackageJson.module),
          es2015: posix.join(this.distDir, tempPackageJson.es2015),
          esm2015: posix.join(this.distDir, tempPackageJson.esm2015),
          fesm2015: posix.join(this.distDir, tempPackageJson.fesm2015),
          typings: posix.join(this.distDir, tempPackageJson.typings),
          metadata: posix.join(this.distDir, tempPackageJson.metadata),
          sideEffects: tempPackageJson.sideEffects === 'true',
          ngPackage: undefined
        });
        await packageJson.write();
        // delete the package.json file generated by ngPackagr
        await removeFilesAndEmptyDirsRecursively([resolve(join(pathToOutputFolder, 'dist', 'package.json'))]);
      })
      .finally(() => {
        this.logger.on();
      });
  }

  /**
   * used by `bit compile`
   */
  async transpileComponent(params: TranspileComponentParams): Promise<void> {
    return this.ngPackagrCompilation(params.componentDir, params.distDir);
  }

  private getArtifactDefinition() {
    return [
      {
        generatedBy: this.id,
        name: this.artifactName,
        globPatterns: this.distGlobPatterns
      }
    ];
  }

  /**
   * used by `bit build`
   */
  async build(context: BuildContext): Promise<BuiltTaskResult> {
    const capsules = context.capsuleNetwork.seedersCapsules;
    const componentsResults: ComponentResult[] = [];

    await Promise.all(
      context.components.map(async(component: Component) => {
        const capsule = capsules.getCapsule(component.id);
        if (!capsule) {
          throw new Error(`No capsule found for ${component.id} in network graph`);
        }
        const currentComponentResult: ComponentResult = {
          component
        };
        try {
          await this.ngPackagrCompilation(capsule.path, capsule.path);
        } catch (e) {
          currentComponentResult.errors = [e];
        }

        if (this.shouldCopyNonSupportedFiles) {
          const dataToPersist = new DataToPersist();
          capsule.component.filesystem.files.forEach((file: AbstractVinyl) => {
            if (!this.isFileSupported(file.path)) {
              dataToPersist.addFile(file);
            }
          });
          dataToPersist.addBasePath(join(capsule.path, this.distDir));
          await dataToPersist.persistAllToFS();
        }

        componentsResults.push({ ...currentComponentResult });
      })
    );

    return {
      artifacts: this.getArtifactDefinition(),
      componentsResults
    };
  }

  /**
   * given a source file, return its parallel in the dists. e.g. index.ts => dist/index.js
   * used by `bit build`
   */
  getDistPathBySrcPath(srcPath: string): string {
    // we use the typescript compiler, so we just need to return the typescript src file path
    return srcPath;
  }

  /**
   * whether ngPackagr is able to compile the given path
   */
  isFileSupported(filePath: string): boolean {
    return filePath.endsWith('.ts') || (!!this.options.allowJs && filePath.endsWith('.js'));
  }

  private replaceFileExtToJs(filePath: string): string {
    if (!this.isFileSupported(filePath)) return filePath;
    const fileExtension = extname(filePath);
    return filePath.replace(new RegExp(`${fileExtension}$`), '.js'); // makes sure it's the last occurrence
  }

  version(): string {
    // eslint-disable-next-line global-require
    return require('ng-packagr/package.json').version;
  }
}
