import { ComponentContext, ComponentFile } from '@teambit/generator';

export const moduleFile = (context: ComponentContext): ComponentFile => {
  const { name, namePascalCase: Name } = context;

  return {
    relativePath: `src/${name}.module.ts`,
    content: `import { NgModule } from '@angular/core';
import { ${Name}Component } from './${name}.component';

@NgModule({
  declarations: [
    ${Name}Component
  ],
  imports: [],
  exports: [
    ${Name}Component
  ]
})
export class ${Name}Module {}
`,
  };
};
