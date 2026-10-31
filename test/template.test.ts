import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Resource {
  Type: string;
  Metadata?: unknown;
  Properties?: Record<string, unknown>;
}
interface Template {
  Transform?: unknown;
  Globals?: unknown;
  Parameters?: Record<string, Record<string, unknown>>;
  Resources: Record<string, Resource>;
  Outputs?: Record<string, { Value: unknown }>;
}

const text = readFileSync(new URL('../template.yaml', import.meta.url), 'utf8');
const t = parse(text, { logLevel: 'error' }) as Template;
const resources = Object.values(t.Resources);
const functions = resources.filter((r) => r.Type === 'AWS::Serverless::WebFunction');

function byAuth(authType: string): Resource {
  const found = functions.filter((f) => f.Properties?.AuthType === authType);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe('template.yaml', () => {
  it('uses the SAM transform and no Globals section', () => {
    expect(t.Transform).toBe('AWS::Serverless-2016-10-31');
    expect(t.Globals).toBeUndefined();
  });

  it('has exactly two AWS::Serverless::WebFunction resources and no AWS::Lambda::WebFunction* resources', () => {
    expect(functions).toHaveLength(2);
    expect(resources.filter((r) => r.Type.startsWith('AWS::Lambda::WebFunction'))).toEqual([]);
  });

  it('the IamAuth function sets AUTH_MODE iam and no Cognito env vars', () => {
    const p = byAuth('IamAuth').Properties!;
    expect(p.EnvironmentVariables).toEqual({ AUTH_MODE: 'iam' });
    expect(p.EndpointName).toBe('iam');
    expect(p.FunctionName).toBe('${AWS::StackName}-iam');
  });

  it('the ApplicationManaged function sets AUTH_MODE jwt and both Cognito env vars', () => {
    const p = byAuth('ApplicationManaged').Properties!;
    expect(p.EnvironmentVariables).toEqual({
      AUTH_MODE: 'jwt',
      COGNITO_USER_POOL_ID: 'UserPool',
      COGNITO_CLIENT_ID: 'UserPoolClient',
    });
    expect(p.EndpointName).toBe('public');
    expect(p.FunctionName).toBe('${AWS::StackName}-public');
  });

  it("every function's AUTH_MODE matches its AuthType", () => {
    const expected: Record<string, string> = { IamAuth: 'iam', ApplicationManaged: 'jwt' };
    for (const f of functions) {
      const authType = f.Properties?.AuthType as string;
      const env = f.Properties?.EnvironmentVariables as Record<string, string>;
      expect(Object.keys(expected)).toContain(authType);
      expect(env.AUTH_MODE).toBe(expected[authType]);
    }
  });

  it('both functions use nodejs24.x, src/server.ts and the esbuild CJS build', () => {
    for (const f of functions) {
      expect(f.Properties?.Runtime).toBe('nodejs24.x');
      expect(f.Properties?.CodeUri).toBe('./');
      expect(f.Properties?.EntryPoint).toBe('src/server.ts');
      expect(f.Metadata).toEqual({
        BuildMethod: 'esbuild',
        BuildProperties: { Format: 'cjs', Target: 'node24', EntryPoints: ['src/server.ts'] },
      });
    }
  });

  it('both functions take their tunables from the parameters', () => {
    for (const f of functions) {
      const p = f.Properties!;
      expect(p.Timeout).toBe('TimeoutSeconds');
      expect(p.MaxConcurrencyPerEnvironment).toBe('MaxConcurrencyPerEnvironment');
      expect(p.LoggingConfig).toEqual({
        ApplicationLogLevel: 'ApplicationLogLevel',
        SystemLogLevel: 'SystemLogLevel',
      });
      expect(p.ScalingConfig).toEqual({ MaxEnvironments: 'MaxEnvironments' });
      expect(p.ThrottleConfig).toEqual({ RateLimit: 'RateLimit' });
    }
  });

  it('both functions have a HomeRegion endpoint, the latest revision and a SAM-generated role', () => {
    for (const f of functions) {
      expect(f.Properties?.EndpointType).toBe('HomeRegion');
      for (const key of ['ExecutionRoleArn', 'AutoDeploymentMode', 'RevisionWeights']) {
        expect(f.Properties).not.toHaveProperty(key);
      }
    }
  });

  it('parameters have the SPEC defaults and ranges', () => {
    const p = t.Parameters!;
    expect(Object.keys(p).sort()).toEqual(
      ['ApplicationLogLevel', 'MaxConcurrencyPerEnvironment', 'MaxEnvironments', 'RateLimit', 'SystemLogLevel', 'TimeoutSeconds'],
    );
    expect(p.TimeoutSeconds).toMatchObject({ Type: 'Number', Default: 30, MinValue: 3, MaxValue: 900 });
    expect(p.MaxConcurrencyPerEnvironment).toMatchObject({ Type: 'Number', Default: 64, MinValue: 1, MaxValue: 128 });
    expect(p.MaxEnvironments).toMatchObject({ Type: 'Number', Default: 2, MinValue: 2 });
    expect(p.MaxEnvironments!.Description).toMatch(/ASSUMPTION/);
    expect(p.RateLimit).toMatchObject({
      Type: 'Number',
      Default: 100,
      AllowedValues: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
    });
    expect(p.RateLimit!.Description).toMatch(/ASSUMPTION/);
    expect(p.ApplicationLogLevel).toMatchObject({
      Type: 'String',
      Default: 'INFO',
      AllowedValues: ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'],
    });
    expect(p.SystemLogLevel).toMatchObject({
      Type: 'String',
      Default: 'WARN',
      AllowedValues: ['DEBUG', 'INFO', 'WARN'],
    });
  });

  it('the user pool uses email as username and the client has no secret', () => {
    const pool = resources.find((r) => r.Type === 'AWS::Cognito::UserPool')!;
    const client = resources.find((r) => r.Type === 'AWS::Cognito::UserPoolClient')!;
    expect(pool.Properties?.UsernameAttributes).toEqual(['email']);
    expect(client.Properties?.GenerateSecret).toBe(false);
    expect(client.Properties?.ExplicitAuthFlows).toEqual(['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']);
  });

  it('outputs the endpoint URLs, function names and Cognito ids', () => {
    const o = t.Outputs!;
    expect(Object.keys(o).sort()).toEqual(
      ['IamEndpointUrl', 'IamFunctionName', 'PublicEndpointUrl', 'PublicFunctionName', 'UserPoolClientId', 'UserPoolId'],
    );
    expect(o.IamEndpointUrl!.Value).toBe('https://${IamFunctionEndpoint.DomainName}');
    expect(o.PublicEndpointUrl!.Value).toBe('https://${PublicFunctionEndpoint.DomainName}');
    expect(o.IamFunctionName!.Value).toBe('${AWS::StackName}-iam');
    expect(o.PublicFunctionName!.Value).toBe('${AWS::StackName}-public');
    expect(o.UserPoolId!.Value).toBe('UserPool');
    expect(o.UserPoolClientId!.Value).toBe('UserPoolClient');
  });

  it('contains no account IDs, Region literals or lambda-web- text', () => {
    expect(text).not.toMatch(/[0-9]{12}/);
    expect(text).not.toMatch(/(us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+-[0-9]/);
    expect(text).not.toMatch(/lambda-web-/i);
  });
});

describe('samconfig.toml', () => {
  it('sets the stack name, Region and deploy options', () => {
    const toml = readFileSync(new URL('../samconfig.toml', import.meta.url), 'utf8');
    for (const part of [
      'version = 0.1',
      'stack_name = "lwf"',
      'region = "us-west-2"',
      'resolve_s3 = true',
      'capabilities = "CAPABILITY_IAM"',
      'confirm_changeset = false',
    ]) {
      expect(toml).toContain(part);
    }
  });
});
