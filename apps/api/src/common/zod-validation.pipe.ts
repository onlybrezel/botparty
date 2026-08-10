import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodIssue } from 'zod';

type ParseResult =
  | { success: true; data: unknown }
  | { success: false; error: { issues: ZodIssue[] } };

type SchemaLike = { safeParse(value: unknown): ParseResult };

function formatIssues(issues: ZodIssue[]) {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

@Injectable()
export class ZodValidationPipe<TSchema extends SchemaLike> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown) {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }

    throw new BadRequestException({
      message: 'Validation failed',
      errors: formatIssues(parsed.error.issues),
    });
  }
}
