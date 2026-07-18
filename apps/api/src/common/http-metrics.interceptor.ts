import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Counter, Histogram, register } from 'prom-client';
import { Observable, finalize } from 'rxjs';

const requestCounter = (register.getSingleMetric('botparty_http_requests_total') as Counter<'method' | 'route' | 'status'> | undefined)
  ?? new Counter({
    name: 'botparty_http_requests_total',
    help: 'HTTP requests handled by the API',
    labelNames: ['method', 'route', 'status'] as const,
  });
const requestDuration = (register.getSingleMetric('botparty_http_request_duration_seconds') as Histogram<'method' | 'route'> | undefined)
  ?? new Histogram({
    name: 'botparty_http_request_duration_seconds',
    help: 'API request duration in seconds',
    labelNames: ['method', 'route'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  });

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{ method?: string; url?: string }>();
    const response = context.switchToHttp().getResponse<{ statusCode?: number }>();
    const method = request.method?.toUpperCase() || 'UNKNOWN';
    const route = this.normalizeRoute(request.url ?? '/');
    const end = requestDuration.startTimer({ method, route });
    return next.handle().pipe(finalize(() => {
      end();
      requestCounter.inc({ method, route, status: String(response.statusCode ?? 500) });
    }));
  }

  private normalizeRoute(url: string) {
    const path = url.split('?')[0] ?? '/';
    return path
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
      .replace(/\/\d+(?=\/|$)/g, '/:id')
      .slice(0, 160);
  }
}
