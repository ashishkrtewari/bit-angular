// import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
// import { environment } from './environments/environment';

// if (environment.production) {
//   enableProdMode();
// }

// declare var compositions: Record<string, any>;

// console.log(compositions);

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));
