# CloudFront

Put CloudFront in front of a Lambda Web Function, authenticate users, then add an
optional custom domain. CloudFront uses origin access control (OAC) to sign requests;
Express verifies the user's Cognito access token, a JSON Web Token (JWT).

```text
Client + Cognito JWT
        |
CloudFront signs the origin request with OAC and forwards the JWT
        |
Lambda checks the signature and invoke permission (IamAuth)
        |
Express checks the user's JWT, then runs the route
```

`/health` needs no JWT. Every other path requires a Cognito access token; missing
or invalid tokens return 401 before routing.

Run all commands from `examples/02-cloudfront`, including in each new terminal.
Deploying this stage updates hello world's `lwf` stack in `us-west-2` and removes
its public function. See [changes from hello world](#changes-from-hello-world)
before deploying.

## Changes from hello world

- Keeps `IamFunction`, its endpoint name `iam`, and the Cognito pool and client.
  Existing test users remain. The app now accepts only `AUTH_MODE=jwt`.
- Deletes `PublicFunction`, its endpoint, revisions, and execution role. Its old
  endpoint stops working. CloudWatch logs can remain.
- Adds a distribution, OAC, a JWT cache policy, and a function resource policy
  allowing this distribution to invoke the IAM endpoint.
- Adds optional custom-domain records. The certificate lives in a separate stack
  in `us-east-1`; the existing public hosted zone is never created or deleted here.

Deploying hello world again removes CloudFront and restores IAM-only app behavior
on the IAM function. It recreates the public function, potentially with a new URL.
Distribution creation, changes, and deletion can take several minutes.

## Run locally

Requires Node 24. These commands use placeholder Cognito IDs:

```sh
npm ci
npm run dev
```

In another terminal:

```sh
curl -i localhost:3000/health
curl -i localhost:3000/whoami
```

Expect 200 and 401 respectively, both with `Cache-Control: no-store`.
Stop the dev server with Ctrl+C.

## Check locally

Build and template checks require SAM CLI 1.170+ and cfn-lint. These checks do not
call AWS; tests inject verifiers or signing keys for valid JWTs. Uncached
dependencies may need network access.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:bundle
cfn-lint template.yaml
cfn-lint --regions us-east-1 --template certificate.yaml
```

Use `npm run build` for a build alone. Bare `sam build` omits the generated ESM
package marker required by the bundled dependencies.

## 1. Observe origin access control

These commands access AWS. Requires AWS CLI v2 and credentials; set `AWS_PROFILE`
if needed. The IAM smoke check also requires `lambda:InvokeWebFunctionEndpoint`
permission. Start without custom-domain parameters:

```sh
npm run deploy
source scripts/env.sh
BASE="$(stack_output "$STACK_NAME" CloudFrontEndpointUrl)"
ORIGIN="$(stack_output "$STACK_NAME" IamEndpointUrl)"
curl -i "$BASE/health"
curl -i "$ORIGIN/health"
```

Expect CloudFront health to return 200 and the unsigned origin call to return 403.
The origin rejects the request before Express. If CloudFront returns 403 just
after deployment, wait for the distribution to finish deploying before retrying.
Persistent failures need investigation of the origin, OAC, and resource policy.

Inspect `OriginAccessControl`, `CloudFrontInvokePolicy`, and `Distribution` in
[template.yaml](template.yaml). The policy attaches to the function ARN but grants
invocation on the endpoint ARN, restricted by the distribution's `aws:SourceArn`.

The origin remains internet-reachable. Same-account IAM principals with invoke
permission can still call it directly with signed requests:

```sh
npm run smoke:iam
```

Expect signed `/health` to return 200, signed `/whoami` to return 401, and unsigned
`/health` to return 403. Lambda strips the AWS signature from `Authorization`;
that signature does not supply the JWT Express requires. The endpoint name `iam`
describes Lambda's authentication, while the app's `authMode` is `jwt`.

## 2. Forward a user's JWT

These commands access AWS. `get-jwt` and `smoke:jwt` create the test user if needed
and reset its password before signing in. They use hello world's Cognito pool.

```sh
npm run smoke:jwt -- you@example.com
```

For manual calls:

```sh
source scripts/env.sh
BASE="$(stack_output "$STACK_NAME" CloudFrontEndpointUrl)"
TOKEN="$(npm run --silent get-jwt -- you@example.com)"
curl -i "$BASE/whoami"
curl -i "$BASE/whoami" -H 'Authorization: Bearer invalid'
curl -i "$BASE/whoami" -H "Authorization: Bearer $TOKEN"
curl -i -N "$BASE/stream" -H "Authorization: Bearer $TOKEN"
```

Expect 401, 401, then 200 with `authMode: jwt` and the user's subject. Stream ticks
should arrive over time. Cognito issues the token before the HTTP request.
The app uses Cognito's public signing keys to verify the signature, issuer,
client, expiration, and access-token use.

`always-amz-auth` preserves the viewer's bearer token while CloudFront adds its
own signature. The cache policy explicitly includes `Authorization`, as required
for Web Function GET/HEAD requests. `AllViewerExceptHostHeader` forwards viewer
headers, cookies, and query strings while using the Lambda origin's `Host`.

The cache policy has MinTTL 0, DefaultTTL 0, and MaxTTL 1 second. Every app response
sends `no-store`, including `/stream`, authentication failures, and errors. Selected
error-cache TTLs are also zero to prevent cached errors delaying recovery.

AWS notes that the last `X-Forwarded-For` entry is a CloudFront address. This app
does not trust forwarded headers, enable Express `trust proxy`, or use
`lambda-web-*` headers for authentication or routing. WAF is deferred. Do not add
Lambda@Edge origin-request/origin-response triggers; Web Function origins with
OAC do not support them.

## 3. Add an optional custom domain

These commands create AWS resources and DNS records. You need:

- A hostname you control, with no conflicting DNS record or CloudFront alias.
- An existing public Route 53 hosted zone in the same AWS account, with public
  DNS delegated to that zone.

Deploy the certificate stack in `us-east-1`, where CloudFront requires its viewer
certificate. Pass the certificate ARN to the application stack in `us-west-2`.
Replace the sample values below.

```sh
DOMAIN='app.example.com'
ZONE_ID='Z0123456789EXAMPLE'
CERT_STACK='lwf-cloudfront-certificate'
aws cloudformation deploy --region us-east-1 \
  --stack-name "$CERT_STACK" --template-file certificate.yaml \
  --parameter-overrides DomainName="$DOMAIN" HostedZoneId="$ZONE_ID"
CERT_ARN="$(aws cloudformation describe-stacks --region us-east-1 \
  --stack-name "$CERT_STACK" \
  --query 'Stacks[0].Outputs[?OutputKey==`CertificateArn`].OutputValue' --output text)"
npm run deploy -- --parameter-overrides \
  DomainName="$DOMAIN" CertificateArn="$CERT_ARN" HostedZoneId="$ZONE_ID"
curl -i "https://$DOMAIN/health"
TOKEN="$(npm run --silent get-jwt -- you@example.com)"
curl -i "https://$DOMAIN/whoami" -H "Authorization: Bearer $TOKEN"
```

The certificate stack creates a DNS validation CNAME. The application stack creates
A and AAAA aliases for IPv4 and IPv6 traffic. After distribution and DNS propagation,
compare the custom domain with the default CloudFront hostname; both should enforce
the same JWTs.

Supply all three domain parameters together when updating a domain-enabled
deployment. App deployment does not create or update the certificate stack.

## Clean up or return to the default hostname

The following commands access AWS. To keep the app but remove the custom domain:

```sh
npm run deploy -- --parameter-overrides \
  'DomainName=""' 'CertificateArn=""' 'HostedZoneId=""'
```

Wait for the distribution update to complete before deleting its certificate.
Alternatively, delete the shared application stack first:

```sh
npm run teardown
```

This removes the distribution, aliases, OAC, policy, and shared app/Cognito
resources, including users. It does not delete the certificate stack. Once the
certificate is no longer associated with CloudFront, delete its stack separately:

```sh
aws cloudformation delete-stack --region us-east-1 --stack-name "$CERT_STACK"
aws cloudformation wait stack-delete-complete --region us-east-1 --stack-name "$CERT_STACK"
```

ACM validation CNAMEs can remain. Before removing one, check whether another
certificate uses it, including in other Regions. Preserve records needed for
renewal and the existing hosted zone.

CloudWatch groups also remain without expiry. After checking that you no longer
need them, remove the old and current groups, including `.local` companions:

```sh
source scripts/env.sh
for name in iam public; do
  for suffix in '' .local; do
    aws logs delete-log-group --region "$AWS_REGION" \
      --log-group-name "/aws/lambda/web/${STACK_NAME}-${name}${suffix}"
  done
done
```

An absent group returns an error.

## AWS references

- [Web Function access control](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html)
- [CloudFront OAC for Web Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html)
- [Managed origin request policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html)
- [Error caching](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages-expiration.html)
- [CloudFront certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html)
