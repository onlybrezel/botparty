import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';

export type S3CompatibleStorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle: boolean;
};

export function resolveS3CompatibleStorageConfig(
  config: ConfigService,
  envPrefix: string,
): S3CompatibleStorageConfig | null {
  const bucket = config.get<string>(`${envPrefix}BUCKET`)?.trim();
  const region = config.get<string>(`${envPrefix}REGION`)?.trim();
  const accessKeyId = config.get<string>(`${envPrefix}ACCESS_KEY_ID`)?.trim();
  const secretAccessKey = config.get<string>(`${envPrefix}SECRET_ACCESS_KEY`)?.trim();

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const endpoint = config.get<string>(`${envPrefix}ENDPOINT`)?.trim();
  const sessionToken = config.get<string>(`${envPrefix}SESSION_TOKEN`)?.trim();

  return {
    bucket,
    region,
    endpoint: endpoint && endpoint.length > 0 ? endpoint : undefined,
    accessKeyId,
    secretAccessKey,
    sessionToken: sessionToken && sessionToken.length > 0 ? sessionToken : undefined,
    forcePathStyle: readBooleanFlag(config.get<string>(`${envPrefix}FORCE_PATH_STYLE`)),
  };
}

export function createS3CompatibleStorageClient(config: S3CompatibleStorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    },
  });
}

function readBooleanFlag(value?: string): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}