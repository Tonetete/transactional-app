# Source me: points the AWS CLI, CDK and SDKs at floci.  usage: source scripts/floci-env.sh
export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export CDK_DEFAULT_ACCOUNT=000000000000
export CDK_DEFAULT_REGION="$AWS_REGION"
