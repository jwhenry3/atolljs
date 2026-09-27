import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideMesh } from '@jwhenry123/mesh-angular';
import { incidents } from '@jwhenry123/mesh-incidents';
import { AppComponent } from './app.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    // The domain package owns the typed worker client; provideMesh registers
    // it for DI and terminates it on app teardown/HMR (it re-spawns lazily).
    provideMesh({ pools: [{ name: 'incidents', client: incidents }] }),
  ],
}).catch(console.error);
