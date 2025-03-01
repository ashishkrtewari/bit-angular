import { AngularDeps, AngularMain } from '@teambit/angular';
import { AngularV8Aspect } from './angular-v8.aspect';
import { AngularV8Env } from './angular-v8.env';

export class AngularV8Main extends AngularMain {
  static async provider([
    jestAspect,
    compiler,
    tester,
    eslint,
    ngPackagr,
    generator,
    webpack,
    workspace,
    envs,
    isolator,
    pkg,
  ]: AngularDeps): Promise<AngularMain> {
    const angularV8Env = new AngularV8Env(
      jestAspect,
      compiler,
      tester,
      eslint,
      ngPackagr,
      generator,
      isolator,
      webpack,
      workspace,
      pkg,
    );
    return new AngularV8Main(envs, angularV8Env);
  }
}

AngularV8Aspect.addRuntime(AngularV8Main);
