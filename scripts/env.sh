# Sourced by deploy.sh and teardown.sh. Not run directly.
export AWS_REGION="${AWS_REGION:-us-west-2}"
STACK_NAME="${STACK_NAME:-lwf}"
ARTIFACTS_STACK_NAME="${ARTIFACTS_STACK_NAME:-${STACK_NAME}-artifacts}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# stack_output <stack-name> <output-key>
stack_output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}
