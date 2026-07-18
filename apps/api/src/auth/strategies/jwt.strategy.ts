import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '@botparty/shared';
import { getAccessCookieName, parseCookie } from '../auth.cookies';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: { headers?: { cookie?: string } } | undefined) =>
          parseCookie(request?.headers?.cookie, getAccessCookieName(config)),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, tokenVersion: true, isActive: true },
    });
    if (!user?.isActive || user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Access token has been revoked');
    }
    return {
      sub: user.id,
      username: user.username,
      role: user.role as JwtPayload['role'],
      tokenVersion: user.tokenVersion,
    };
  }
}
