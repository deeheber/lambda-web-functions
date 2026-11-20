import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

interface Resource {
  Type: string;
  Properties: Record<string, unknown>;
}

interface Template {
  Resources: Record<string, Resource>;
  Outputs: Record<string, { Value: unknown }>;
}

const template = parse(readFileSync(new URL('../template.yaml', import.meta.url), 'utf8'), {
  customTags: [
    { tag: '!Ref', resolve: (value: string) => ({ Ref: value }) },
    { tag: '!Sub', resolve: (value: string) => ({ 'Fn::Sub': value }) },
  ],
}) as Template;

it('deploys only the public Web Function and home-Region Cognito resources', () => {
  expect(Object.fromEntries(Object.entries(template.Resources).map(([id, resource]) => [id, resource.Type])))
    .toEqual({
      UserPool: 'AWS::Cognito::UserPool',
      UserPoolClient: 'AWS::Cognito::UserPoolClient',
      PublicFunction: 'AWS::Serverless::WebFunction',
    });
});

it('routes a fresh deployment to one revision in Oregon and Northern Virginia', () => {
  const { Properties: endpoint } = template.Resources.PublicFunction!;
  expect(endpoint).toMatchObject({
    EndpointName: 'public',
    EndpointType: 'MultiRegion',
    AuthType: 'ApplicationManaged',
    AutoDeploymentMode: 'Disabled',
    ReplicaRegions: ['us-east-1'],
  });
  expect(endpoint).not.toHaveProperty('RevisionWeights');
  expect(endpoint).not.toHaveProperty('EgressNetworkConnectorArn');
  expect(template.Outputs.PublicEndpointUrl?.Value).toEqual({
    'Fn::Sub': 'https://${PublicFunctionEndpoint.DomainName}',
  });
});

it('uses the stack Cognito pool and client for JWT validation and test-user sign-in', () => {
  expect(template.Resources.PublicFunction!.Properties.EnvironmentVariables).toEqual({
    AUTH_MODE: 'jwt',
    COGNITO_USER_POOL_ID: { Ref: 'UserPool' },
    COGNITO_CLIENT_ID: { Ref: 'UserPoolClient' },
  });
  expect(template.Resources.UserPool!.Properties.AdminCreateUserConfig).toEqual({
    AllowAdminCreateUserOnly: true,
  });
  expect(template.Resources.UserPoolClient!.Properties).toMatchObject({
    UserPoolId: { Ref: 'UserPool' },
    GenerateSecret: false,
    ExplicitAuthFlows: expect.arrayContaining(['ALLOW_USER_PASSWORD_AUTH']),
  });
  expect(template.Outputs).toMatchObject({
    UserPoolId: { Value: { Ref: 'UserPool' } },
    UserPoolClientId: { Value: { Ref: 'UserPoolClient' } },
  });
});
