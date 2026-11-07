import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

function template(file: string) {
  return parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    customTags: [
      { tag: '!Ref', resolve: (v: string) => ({ Ref: v }) },
      { tag: '!Sub', resolve: (v: string) => ({ 'Fn::Sub': v }) },
      { tag: '!GetAtt', resolve: (v: string) => ({ 'Fn::GetAtt': v.split('.') }) },
      { tag: '!If', collection: 'seq', resolve: (v: { toJSON(): unknown }) => ({ 'Fn::If': v.toJSON() }) },
      { tag: '!And', collection: 'seq', resolve: (v: { toJSON(): unknown }) => ({ 'Fn::And': v.toJSON() }) },
      { tag: '!Not', collection: 'seq', resolve: (v: { toJSON(): unknown }) => ({ 'Fn::Not': v.toJSON() }) },
      { tag: '!Equals', collection: 'seq', resolve: (v: { toJSON(): unknown }) => ({ 'Fn::Equals': v.toJSON() }) },
    ],
  });
}
const t = template('template.yaml');
const certificate = template('certificate.yaml');

function evaluate(value: unknown, parameters: Record<string, string>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const [op, args] = Object.entries(value)[0]!;
  if (op === 'Ref') return parameters[args as string];
  if (!Array.isArray(args)) throw new Error(`Unsupported rule: ${op}`);
  const values = args.map((arg: unknown) => evaluate(arg, parameters));
  switch (op) {
    case 'Fn::Equals': return values[0] === values[1];
    case 'Fn::Not': return !values[0];
    case 'Fn::And': return values.every(Boolean);
    case 'Fn::Or': return values.some(Boolean);
    default: throw new Error(`Unsupported rule: ${op}`);
  }
}

describe('CloudFront deployment contracts', () => {
  it('retains the IAM endpoint and Cognito while enforcing JWTs in the sole app', () => {
    const functions = Object.entries(t.Resources).filter(([, r]) => (r as { Type: string }).Type === 'AWS::Serverless::WebFunction');
    expect(functions.map(([name]) => name)).toEqual(['IamFunction']);
    expect(t.Resources.IamFunction.Properties).toMatchObject({
      FunctionName: { 'Fn::Sub': '${AWS::StackName}-iam' },
      EndpointName: 'iam', EndpointType: 'HomeRegion', AuthType: 'IamAuth',
      EnvironmentVariables: { AUTH_MODE: 'jwt', COGNITO_USER_POOL_ID: { Ref: 'UserPool' }, COGNITO_CLIENT_ID: { Ref: 'UserPoolClient' } },
      ScalingConfig: { MaxEnvironments: { Ref: 'MaxEnvironments' } },
      ThrottleConfig: { RateLimit: { Ref: 'RateLimit' } },
    });
    expect(t.Resources.UserPool.Properties.AdminCreateUserConfig.AllowAdminCreateUserOnly).toBe(true);
    expect(t.Resources.UserPoolClient.Properties).toMatchObject({ UserPoolId: { Ref: 'UserPool' }, GenerateSecret: false });
    expect(t.Resources).not.toHaveProperty('PublicFunction');
    expect(t.Outputs).not.toHaveProperty('PublicEndpointUrl');
  });

  it('signs HTTPS origin requests while preserving viewer Authorization and replacing Host', () => {
    expect(t.Resources.OriginAccessControl.Properties.OriginAccessControlConfig).toMatchObject({
      OriginAccessControlOriginType: 'lambda', SigningProtocol: 'sigv4', SigningBehavior: 'always-amz-auth',
    });
    const d = t.Resources.Distribution.Properties.DistributionConfig;
    expect(d.Origins).toEqual([{
      Id: 'WebFunction', DomainName: { 'Fn::GetAtt': ['IamFunctionEndpoint', 'DomainName'] },
      OriginAccessControlId: { Ref: 'OriginAccessControl' },
      CustomOriginConfig: { OriginProtocolPolicy: 'https-only', OriginSSLProtocols: ['TLSv1.2'] },
    }]);
    expect(d.DefaultCacheBehavior).toMatchObject({
      TargetOriginId: 'WebFunction', ViewerProtocolPolicy: 'redirect-to-https',
      AllowedMethods: ['GET', 'HEAD'], CachedMethods: ['GET', 'HEAD'],
      CachePolicyId: { Ref: 'JwtCachePolicy' },
      OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac',
    });
    expect(t.Resources.JwtCachePolicy.Properties.CachePolicyConfig).toMatchObject({
      MinTTL: 0, DefaultTTL: 0, MaxTTL: 1,
      ParametersInCacheKeyAndForwardedToOrigin: {
        HeadersConfig: { HeaderBehavior: 'whitelist', Headers: ['Authorization'] },
      },
    });
  });

  it('scopes a single function policy to the endpoint and distribution', () => {
    expect(t.Resources.CloudFrontInvokePolicy).toEqual({
      Type: 'AWS::Lambda::ResourcePolicy',
      Properties: {
        ResourceArn: { 'Fn::GetAtt': ['IamFunctionEndpoint', 'FunctionArn'] },
        PolicyDocument: { Version: '2012-10-17', Statement: [{
          Sid: 'AllowDistribution', Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' },
          Action: 'lambda:InvokeWebFunctionEndpoint', Resource: { 'Fn::GetAtt': ['IamFunctionEndpoint', 'EndpointArn'] },
          Condition: { StringEquals: { 'aws:SourceArn': { 'Fn::Sub': 'arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}' } } },
        }] },
      },
    });
    expect(Object.values(t.Resources).filter((r) => (r as { Type: string }).Type === 'AWS::Lambda::Permission')).toEqual([]);
  });

  it('disables error caching without changing status codes or response pages', () => {
    expect(t.Resources.Distribution.Properties.DistributionConfig.CustomErrorResponses).toEqual(
      [404, 414, 500, 501, 502, 503, 504].map((code) => ({ ErrorCode: code, ErrorCachingMinTTL: 0 })),
    );
  });

  it('requires all domain parameters together and permits the default hostname', () => {
    const names = ['DomainName', 'CertificateArn', 'HostedZoneId'];
    for (let mask = 0; mask < 8; mask++) {
      const params = Object.fromEntries(names.map((name, i) => [name, mask & (1 << i) ? 'supplied' : '']));
      expect(evaluate(t.Rules.CustomDomainParameters.Assertions[0].Assert, params), `mask ${mask}`).toBe(mask === 0 || mask === 7);
    }
    for (const name of names) expect(t.Parameters[name].Default).toBe('');
    const pattern = new RegExp(t.Parameters.CertificateArn.AllowedPattern);
    const arn = 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789abc';
    expect(pattern.test('')).toBe(true);
    expect(pattern.test(arn)).toBe(true);
    expect(pattern.test(arn.replace('us-east-1', 'us-west-2'))).toBe(false);
    expect(pattern.test('not-an-arn')).toBe(false);
    expect(t.Conditions.HasCustomDomain).toEqual({ 'Fn::And': names.map((name) => ({ 'Fn::Not': [{ 'Fn::Equals': [{ Ref: name }, ''] }] })) });
    const d = t.Resources.Distribution.Properties.DistributionConfig;
    expect(d.Aliases).toEqual({ 'Fn::If': ['HasCustomDomain', [{ Ref: 'DomainName' }], { Ref: 'AWS::NoValue' }] });
    expect(d.ViewerCertificate).toEqual({ 'Fn::If': ['HasCustomDomain', {
      AcmCertificateArn: { Ref: 'CertificateArn' }, SslSupportMethod: 'sni-only', MinimumProtocolVersion: 'TLSv1.2_2021',
    }, { CloudFrontDefaultCertificate: true }] });
  });

  it('creates conditional IPv4 and IPv6 aliases without creating a hosted zone', () => {
    expect(t.Resources.Distribution.Properties.DistributionConfig.IPV6Enabled).toBe(true);
    expect(t.Resources.DomainRecords.Condition).toBe('HasCustomDomain');
    expect(t.Resources.DomainRecords.Properties).toEqual({
      HostedZoneId: { Ref: 'HostedZoneId' },
      RecordSets: ['A', 'AAAA'].map((Type) => ({ Name: { Ref: 'DomainName' }, Type, AliasTarget: {
        DNSName: { 'Fn::GetAtt': ['Distribution', 'DomainName'] }, HostedZoneId: 'Z2FDTNDATAQYW2', EvaluateTargetHealth: false,
      } })),
    });
    expect(Object.values(t.Resources).filter((r) => (r as { Type: string }).Type === 'AWS::Route53::HostedZone')).toEqual([]);
    expect(certificate.Resources.Certificate.Properties).toEqual({
      DomainName: { Ref: 'DomainName' }, ValidationMethod: 'DNS',
      DomainValidationOptions: [{ DomainName: { Ref: 'DomainName' }, HostedZoneId: { Ref: 'HostedZoneId' } }],
    });
    expect(certificate.Outputs.CertificateArn.Value).toEqual({ Ref: 'Certificate' });
  });

  it('exposes the URLs and identifiers used by scripts and exercises', () => {
    expect(t.Outputs).toMatchObject({
      IamEndpointUrl: { Value: { 'Fn::Sub': 'https://${IamFunctionEndpoint.DomainName}' } },
      CloudFrontEndpointUrl: { Value: { 'Fn::Sub': 'https://${Distribution.DomainName}' } },
      DistributionId: { Value: { Ref: 'Distribution' } },
      CustomDomainUrl: { Condition: 'HasCustomDomain', Value: { 'Fn::Sub': 'https://${DomainName}' } },
      UserPoolId: { Value: { Ref: 'UserPool' } }, UserPoolClientId: { Value: { Ref: 'UserPoolClient' } },
    });
  });
});
