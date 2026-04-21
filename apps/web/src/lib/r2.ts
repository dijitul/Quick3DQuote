import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/lib/env';

let cached: S3Client | null = null;

/**
 * S3-compatible client pointed at the Cloudflare R2 endpoint. R2 uses the
 * account-scoped URL `https://<account>.r2.cloudflarestorage.com`.
 */
export function getR2Client(): S3Client {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 credentials are not configured.');
  }

  if (!cached) {
    cached = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  return cached;
}

export interface PresignedUpload {
  url: string;
  key: string;
  expiresAt: string;
}

/**
 * Create a presigned PUT URL (10-minute TTL) scoped to an exact object key.
 */
export async function presignUpload(params: {
  key: string;
  contentType: string;
  maxBytes: number;
}): Promise<PresignedUpload> {
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_MESHES,
    Key: params.key,
    ContentType: params.contentType,
    ContentLength: params.maxBytes,
  });

  const url = await getSignedUrl(getR2Client(), command, { expiresIn: 600 });

  return {
    url,
    key: params.key,
    expiresAt: new Date(Date.now() + 600 * 1000).toISOString(),
  };
}

/**
 * Create a presigned GET URL (default 24h) for the shop-side download link.
 */
export async function presignDownload(key: string, expiresInSeconds = 86400): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET_MESHES,
    Key: key,
  });
  return getSignedUrl(getR2Client(), command, { expiresIn: expiresInSeconds });
}

/** Verify an object exists (returned by HEAD) and the size is within limits. */
export async function headObject(key: string): Promise<{ size: number; contentType?: string }> {
  const response = await getR2Client().send(
    new HeadObjectCommand({ Bucket: env.R2_BUCKET_MESHES, Key: key }),
  );
  return {
    size: response.ContentLength ?? 0,
    contentType: response.ContentType,
  };
}
