import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '@botparty/shared';

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | string => {
    const request = ctx.switchToHttp().getRequest();
    const user: JwtPayload = request.user;
    return data ? user[data] : user;
  },
);
