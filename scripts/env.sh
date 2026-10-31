# Sourced by create-test-user.sh, smoke-jwt.sh and the smoke:iam npm script. Not run directly.
# STACK_NAME and AWS_REGION come from samconfig.toml so the scripts target what `sam deploy` used.
_samconfig="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/samconfig.toml"

# _samconfig_value <key>: first `key = "value"` line under [default.global.parameters]
_samconfig_value() {
  sed -n '/^\[default\.global\.parameters\]/,/^\[/{
    s/^[[:space:]]*'"$1"'[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p
  }' "$_samconfig" | head -n 1
}

STACK_NAME="$(_samconfig_value stack_name)"
AWS_REGION="$(_samconfig_value region)"
if [ -z "$STACK_NAME" ] || [ -z "$AWS_REGION" ]; then
  echo "env.sh: could not read stack_name and region from $_samconfig" >&2
  return 1 2>/dev/null || exit 1
fi
export AWS_REGION
unset _samconfig

# stack_output <stack-name> <output-key>
stack_output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}
