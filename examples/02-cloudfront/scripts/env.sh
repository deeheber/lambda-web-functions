# Source in Bash or zsh; do not execute directly.
if [ -n "${ZSH_VERSION:-}" ]; then
  _env_source="${(%):-%x}"
else
  _env_source="${BASH_SOURCE[0]}"
fi
_samconfig="$(cd "$(dirname "$_env_source")/.." && pwd)/samconfig.toml"
unset _env_source

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
