import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Template {
  Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
  Outputs?: Record<string, { Value: unknown; Export?: { Name: unknown } }>;
}

function load(path: string): Template {
  return parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { logLevel: 'error' }) as Template;
}

describe('infra/artifacts.yaml', () => {
  const t = load('infra/artifacts.yaml');
  const resources = Object.values(t.Resources);

  it('defines exactly one S3 bucket', () => {
    expect(resources).toHaveLength(1);
    expect(resources[0]!.Type).toBe('AWS::S3::Bucket');
    expect(resources[0]!.Properties).not.toHaveProperty('BucketName');
  });

  it('blocks all public access', () => {
    expect(resources[0]!.Properties!.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
  });

  it('encrypts with SSE-S3 and has no versioning', () => {
    const props = resources[0]!.Properties!;
    expect(props).toMatchObject({
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
      },
    });
    expect(props).not.toHaveProperty('VersioningConfiguration');
  });

  it('exports the bucket name', () => {
    expect(t.Outputs!.BucketName!.Value).toBe('ArtifactsBucket');
    expect(t.Outputs!.BucketName!.Export).toBeDefined();
  });
});
