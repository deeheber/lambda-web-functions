import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Template {
  Parameters?: Record<string, Record<string, unknown>>;
  Resources: Record<string, { Type: string; UpdateReplacePolicy?: string; Properties?: Record<string, unknown> }>;
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

describe('infra/app.yaml', () => {
  const t = load('infra/app.yaml');
  const byType = (type: string) => Object.values(t.Resources).filter((r) => r.Type === type);
  const revision = byType('AWS::Lambda::WebFunctionRevision')[0]!;
  const endpoints = byType('AWS::Lambda::WebFunctionEndpoint');
  const env = (revision.Properties as { ServiceConfig: { EnvironmentVariables: Record<string, string> } })
    .ServiceConfig.EnvironmentVariables;

  it('has exactly one WebFunction, one WebFunctionRevision and two endpoints', () => {
    expect(byType('AWS::Lambda::WebFunction')).toHaveLength(1);
    expect(byType('AWS::Lambda::WebFunctionRevision')).toHaveLength(1);
    expect(endpoints).toHaveLength(2);
  });

  it('AUTH_ENDPOINT_IAM names an IamAuth endpoint', () => {
    const match = endpoints.filter((e) => e.Properties!.EndpointName === env.AUTH_ENDPOINT_IAM);
    expect(match).toHaveLength(1);
    expect(match[0]!.Properties!.AuthType).toBe('IamAuth');
  });

  it('AUTH_ENDPOINT_JWT names an ApplicationManaged endpoint', () => {
    const match = endpoints.filter((e) => e.Properties!.EndpointName === env.AUTH_ENDPOINT_JWT);
    expect(match).toHaveLength(1);
    expect(match[0]!.Properties!.AuthType).toBe('ApplicationManaged');
  });

  it('both endpoints are HomeRegion and send 100% to the revision', () => {
    for (const e of endpoints) {
      expect(e.Properties!.EndpointType).toBe('HomeRegion');
      expect(e.Properties!.RevisionWeights).toEqual([{ RevisionId: 'HelloRevision.RevisionId', Weight: 100 }]);
    }
  });

  it('both endpoints take MaxEnvironments and RateLimit from parameters', () => {
    for (const e of endpoints) {
      expect(e.Properties!.ScalingConfig).toEqual({ MaxEnvironments: 'MaxEnvironments' });
      expect(e.Properties!.ThrottleConfig).toEqual({ RateLimit: 'RateLimit' });
    }
  });

  it('the revision runs nodejs24.x from CodeBucket/CodeKey and is retained on replacement', () => {
    expect(revision.UpdateReplacePolicy).toBe('Retain');
    expect(revision.Properties).toMatchObject({
      BuildConfig: {
        CodeConfig: { S3Object: { Bucket: 'CodeBucket', Key: 'CodeKey' } },
        RuntimeConfig: { Runtime: 'nodejs24.x' },
      },
    });
  });

  it('parameters have the SPEC defaults and ranges', () => {
    const p = t.Parameters!;
    expect(p.TimeoutSeconds).toMatchObject({ Default: 30, MinValue: 3, MaxValue: 900 });
    expect(p.MaxConcurrencyPerEnvironment).toMatchObject({ Default: 64, MinValue: 1, MaxValue: 128 });
    expect(p.MaxEnvironments).toMatchObject({ Default: 2, MinValue: 2 });
    expect(p.RateLimit!.Default).toBe(100);
    expect(p.RateLimit!.AllowedValues).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(p.ApplicationLogLevel!.Default).toBe('INFO');
    expect(p.ApplicationLogLevel!.AllowedValues).toEqual(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
    expect(p.CodeBucket).not.toHaveProperty('Default');
    expect(p.CodeKey).not.toHaveProperty('Default');
  });

  it('outputs the function name, both endpoint URLs and the Cognito ids', () => {
    expect(Object.keys(t.Outputs!).sort()).toEqual(
      ['FunctionName', 'IamEndpointUrl', 'PublicEndpointUrl', 'UserPoolClientId', 'UserPoolId'].sort(),
    );
  });

  it('the user pool client has no secret and allows USER_PASSWORD_AUTH', () => {
    const client = byType('AWS::Cognito::UserPoolClient')[0]!;
    expect(client.Properties!.GenerateSecret).toBe(false);
    expect(client.Properties!.ExplicitAuthFlows).toContain('ALLOW_USER_PASSWORD_AUTH');
  });
});
