import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();
const port = Number(process.env.PORT ?? 3100);
await app.listen(port);
new Logger('Bootstrap').log(`mesh incidents api → http://localhost:${port}/api/incidents/stats`);
