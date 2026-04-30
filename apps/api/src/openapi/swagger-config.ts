import { DocumentBuilder } from '@nestjs/swagger';

export function createSwaggerDocumentConfig() {
  return new DocumentBuilder()
    .setTitle('BotParty API')
    .setDescription('Real-time robot teleoperation platform API')
    .setVersion('0.1.3')
    .addBearerAuth()
    .addTag('auth', 'Authentication & authorization')
    .addTag('users', 'User management')
    .addTag('robots', 'Robot management')
    .addTag('sessions', 'Session management')
    .addTag('queue', 'Queue system')
    .addTag('livekit', 'LiveKit token generation')
    .build();
}
