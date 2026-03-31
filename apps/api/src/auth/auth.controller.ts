import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { FastifyRequest } from 'fastify';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  async register(@Body() body: { username: string; email: string; password: string; displayName?: string }) {
    return this.authService.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email/password' })
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refreshToken(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout / revoke refresh tokens' })
  async logout(@Req() req: FastifyRequest & { user: { sub: string } }) {
    await this.authService.revokeRefreshTokens(req.user.sub);
    return { message: 'Logged out successfully' };
  }
}
