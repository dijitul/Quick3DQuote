import 'server-only';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { serverEnv } from '@/lib/env';

/**
 * Cloudflare R2 (S3-compatible) client, used only to mint presigned PUT
 * URLs for browser-direct mesh uploads. We never proxy bytes through our
 * server — that's the whole point of R2 for STL files.
 */

let _client: S3Client | null = null;

function r2(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${serverEnv.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: serverEnv.R2_ACCESS_KEY_ID,
      secretAccessKey: serverEnv.R2_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

export async function presignUpload(opts: {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: serverEnv.R2_BUCKET,
    Key: opts.key,
    ContentType: opts.contentType,
    ContentLength: opts.contentLength,
  });
  return getSignedUrl(r2(), cmd, { expiresIn: opts.expiresInSeconds ?? 600 });
}

export async function headObject(key: string) {
  const cmd = new HeadObjectCommand({ Bucket: serverEnv.R2_BUCKET, Key: key });
  return r2().send(cmd);
}
