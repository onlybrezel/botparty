import { ConfigService } from '@nestjs/config';
import { RuntimeTelemetryCadvisorService } from './runtime-telemetry-cadvisor.service';

describe('RuntimeTelemetryCadvisorService label parsing', () => {
  const service = new RuntimeTelemetryCadvisorService(new ConfigService());
  const parse = (line: string) =>
    (service as unknown as {
      parsePrometheusLine(input: string): { labels: Record<string, string>; value: number } | null;
    }).parsePrometheusLine(line);

  it('decodes escaped quotes, backslashes and newlines', () => {
    const result = parse(String.raw`metric{quote="say\"hi",path="a\\b",line="a\nb"} 1`);
    expect(result?.labels).toEqual({ quote: 'say"hi', path: 'a\\b', line: 'a\nb' });
    expect(result?.value).toBe(1);
  });

  it('handles a long unterminated escaped label without exponential backtracking', () => {
    const started = performance.now();
    const result = parse(`metric{label="${'\\!'.repeat(20_000)}} 1`);
    expect(result?.labels).toEqual({});
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
