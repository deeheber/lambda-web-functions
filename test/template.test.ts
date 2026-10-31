import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Resource {
  Type: string;
  Properties?: Record<string, unknown>;
}
interface Template {
  Parameters: Record<string, Record<string, unknown>>;
  Resources: Record<string, Resource>;
  Outputs: Record<string, { Value: unknown }>;
}

const t = parse(readFileSync(new URL('../template.yaml', import.meta.url), 'utf8'), {
  customTags: [
    { tag: '!Ref', resolve: (value: string) => ({ Ref: value }) },
    { tag: '!Sub', resolve: (value: string) => ({ 'Fn::Sub': value }) },
  ],
}) as Template;
const functions = Object.values(t.Resources).filter((r) => r.Type === 'AWS::Serverless::WebFunction');

function byAuth(authType: string): Resource {
  const found = functions.filter((f) => f.Properties?.AuthType === authType);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe('template.yaml deployment contracts', () => {
  it('uses iam mode on the IAM endpoint without Cognito configuration', () => {
    const env = byAuth('IamAuth').Properties!.EnvironmentVariables;
    expect(env).toMatchObject({ AUTH_MODE: 'iam' });
    expect(env).not.toHaveProperty('COGNITO_USER_POOL_ID');
    expect(env).not.toHaveProperty('COGNITO_CLIENT_ID');
  });

  it('uses jwt mode on the application-managed endpoint with the deployed Cognito resources', () => {
    expect(byAuth('ApplicationManaged').Properties!.EnvironmentVariables).toMatchObject({
      AUTH_MODE: 'jwt',
      COGNITO_USER_POOL_ID: { Ref: 'UserPool' },
      COGNITO_CLIENT_ID: { Ref: 'UserPoolClient' },
    });
  });

  it('connects the Cognito client to the pool and permits the test-user login flow without a secret', () => {
    expect(t.Resources.UserPoolClient!.Properties).toMatchObject({
      UserPoolId: { Ref: 'UserPool' },
      GenerateSecret: false,
      ExplicitAuthFlows: expect.arrayContaining(['ALLOW_USER_PASSWORD_AUTH']),
    });
  });

  it('defaults to application INFO and system WARN and wires both levels into each function', () => {
    expect(t.Parameters.ApplicationLogLevel!.Default).toBe('INFO');
    expect(t.Parameters.SystemLogLevel!.Default).toBe('WARN');
    for (const f of functions) {
      expect(f.Properties!.LoggingConfig).toMatchObject({
        ApplicationLogLevel: { Ref: 'ApplicationLogLevel' },
        SystemLogLevel: { Ref: 'SystemLogLevel' },
      });
    }
  });

  it('applies the configured environment and request rate caps to each function', () => {
    expect(t.Parameters.MaxEnvironments!.Default).toBe(2);
    expect(t.Parameters.RateLimit!.Default).toBe(100);
    for (const f of functions) {
      expect(f.Properties!.ScalingConfig).toMatchObject({ MaxEnvironments: { Ref: 'MaxEnvironments' } });
      expect(f.Properties!.ThrottleConfig).toMatchObject({ RateLimit: { Ref: 'RateLimit' } });
    }
  });

  it('exposes resolved endpoint URLs and Cognito IDs consumed by the scripts', () => {
    expect(t.Outputs).toMatchObject({
      IamEndpointUrl: { Value: { 'Fn::Sub': 'https://${IamFunctionEndpoint.DomainName}' } },
      PublicEndpointUrl: { Value: { 'Fn::Sub': 'https://${PublicFunctionEndpoint.DomainName}' } },
      UserPoolId: { Value: { Ref: 'UserPool' } },
      UserPoolClientId: { Value: { Ref: 'UserPoolClient' } },
    });
  });
});
