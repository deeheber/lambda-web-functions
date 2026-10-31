# Sourced by create-test-user.sh, smoke-jwt.sh and the smoke:iam npm script. Not run directly.
export AWS_REGION="${AWS_REGION:-us-west-2}"
STACK_NAME="${STACK_NAME:-lwf}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# stack_output <stack-name> <output-key>
stack_output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}
