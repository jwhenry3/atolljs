import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideMesh } from '@jwhenry123/mesh-angular';
import { getIncidentsPool } from '@jwhenry123/mesh-incidents';
import { AppComponent } from './app.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    // The domain package owns the pool definition; provideMesh registers that
    // same singleton for DI and terminates it on app teardown/HMR.
    provideMesh({ pools: [{ name: 'incidents', pool: getIncidentsPool }] }),
  ],
}).catch(console.error);
