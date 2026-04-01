import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '@botparty/shared';

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: JwtPayload = request.user as JwtPayload;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data ? (user as any)[data] : user;
  },
);
