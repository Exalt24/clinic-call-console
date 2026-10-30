import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { ValidationFailedException, ProblemDetailsFilter } from './common/problem-details.filter';
import { requestHygiene } from './common/request-hygiene.middleware';
import { AppConfig } from './config/config';

function messagesOf(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => [...Object.values(e.constraints ?? {}), ...messagesOf(e.children ?? [])]);
}

/** Everything that is configured on the app rather than in a module, shared by main.ts and the tests so both run the same stack. */
export function configureApp(app: INestApplication, cfg: AppConfig): void {
  app.use(requestHygiene);
  app.enableCors({
    origin: cfg.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: (errors) => new ValidationFailedException(messagesOf(errors)),
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
}
