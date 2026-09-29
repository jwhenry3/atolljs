import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAtoll } from '@atolljs/angular';
import { incidents } from '@atolljs/incidents';
import { AppComponent } from './app.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    // The domain package owns the typed worker client; provideAtoll registers
    // it for DI and terminates it on app teardown/HMR (it re-spawns lazily).
    provideAtoll({ pools: [{ name: 'incidents', client: incidents }] }),
  ],
}).catch(console.error);
