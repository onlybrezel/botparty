import { S3Client } from '@aws-sdk/client-s3';

export type S3CompatibleStorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle: boolean;
};
export type S3CompatibleStorageClient = Pick<S3Client, 'send'>;

export function resolveS3CompatibleStorageConfig(
  config: { get(key: string): unknown },
  envPrefix: string,
): S3CompatibleStorageConfig | null {
  const readString = (name: string): string | undefined => {
    const value = config.get(name);
    return typeof value === 'string' ? value.trim() : undefined;
  };
  const bucket = readString(`${envPrefix}BUCKET`);
  const region = readString(`${envPrefix}REGION`);
  const accessKeyId = readString(`${envPrefix}ACCESS_KEY_ID`);
  const secretAccessKey = readString(`${envPrefix}SECRET_ACCESS_KEY`);

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const endpoint = readString(`${envPrefix}ENDPOINT`);
  const sessionToken = readString(`${envPrefix}SESSION_TOKEN`);

  return {
    bucket,
    region,
    ...(endpoint && endpoint.length > 0 ? { endpoint } : {}),
    accessKeyId,
    secretAccessKey,
    ...(sessionToken && sessionToken.length > 0 ? { sessionToken } : {}),
    forcePathStyle: readBooleanFlag(readString(`${envPrefix}FORCE_PATH_STYLE`)),
  };
}

export function createS3CompatibleStorageClient(config: S3CompatibleStorageConfig): S3CompatibleStorageClient {
  return new S3Client({
    region: config.region,
    ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
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
