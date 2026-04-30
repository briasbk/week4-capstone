# Week 4 Capstone - Automated Serverless Workflows on AWS

For this capstone I built a fully automated cloud deployment where pushing code to GitHub is the only manual step. Everything else - compiling the CDK app, synthesising CloudFormation, deploying Lambda and Step Functions, wiring up SSM - happens automatically through CodePipeline.

The stack uses AWS CDK (TypeScript) to define all infrastructure, CDK Pipelines for CI/CD, SSM Parameter Store for runtime config, Lambda to do the actual work, and Step Functions to orchestrate it all with proper error handling.

---

### Services used

| Service | What it does here |
|---|---|
| AWS CDK (TypeScript) | Defines every resource in code - nothing clicked in the console |
| CDK Pipelines / CodePipeline | Deploys automatically on every push to `main` |
| CodeBuild | Runs `npm ci`, `tsc`, and `cdk synth` |
| SSM Parameter Store | Holds the greeting string the Lambda reads at runtime |
| Lambda (Node.js 18) | Fetches the SSM value and logs it |
| Step Functions | Runs the 3-state workflow with retries and error handling |
| CloudWatch Logs | Captures logs from both Lambda and the state machine |
| IAM | Lambda role scoped to read exactly one SSM parameter, nothing else |

---

## Repo layout

```
week4-capstone/
├── bin/
│   └── app.ts               # CDK entrypoint
├── lib/
│   ├── pipeline-stack.ts    # CodePipeline + self-mutation
│   └── workflow-stack.ts    # SSM, Lambda, Step Functions
├── lambda/
│   └── index.js             # reads SSM, logs the value, returns it
├── screenshots/             # deployment evidence (see below)
├── cdk.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Deploying it yourself

You'll need Node.js ≥ 18, AWS CLI v2, and the CDK CLI (`npm install -g aws-cdk`).

**Clone and install**

```bash
git clone https://github.com/briasbk/week4-capstone.git
cd week4-capstone
npm install
```

**Configure AWS credentials**

```bash
aws configure
aws sts get-caller-identity   # verify it's working
```

**Bootstrap CDK** (only needed once per account/region)

```bash
cdk bootstrap aws://508471420037/us-east-1
```

**Deploy the pipeline**

```bash
cdk deploy WorkflowPipelineStack
```

After this one command, the pipeline is live. Every subsequent push to `main` triggers a full build and deploy automatically - no more manual `cdk deploy` needed.

**Trigger the state machine manually**

Once the pipeline finishes (watch it in the CodePipeline console), go to Step Functions → `workflow-state-machine` → Start execution → use `{}` as the input. All four states should turn green within a few seconds.

---

## Screenshots

### CodePipeline - all stages passing

![CodePipeline Success](screenshots/codepipeline-success.png)

### Step Functions - execution graph

![Step Functions Execution](screenshots/stepfunctions-execution.png)

### CloudWatch - Lambda retrieving the SSM value

![CloudWatch Logs](screenshots/cloudwatch-lambda-logs.png)

---

## Design notes

**IAM permissions** - rather than giving Lambda broad SSM access, CDK's `configParam.grantRead(workflowLambda)` generates a policy scoped to the exact ARN of `/app/config/greeting`. Nothing wider.

**Why three states in the state machine** - the rubric asked for at least two, but I added a Wait state between the Pass and Task states to make the flow more realistic (simulating an async readiness check). The Task state that calls Lambda has two retries with exponential backoff, and a Catch that routes unrecoverable failures to a Fail terminal state rather than leaving the execution hanging.

**Self-mutating pipeline** - `selfMutation: true` in CDK Pipelines means if you change `pipeline-stack.ts` itself, the pipeline updates its own infrastructure on the next run before deploying the app stage. You only ever need to run `cdk deploy` once.

**SSM at runtime, not deploy time** - the Lambda gets the parameter *name* via an environment variable set by CDK, but fetches the actual *value* from SSM each time it runs. That means you can update the greeting without touching the code or redeploying:

```bash
aws ssm put-parameter \
  --name "/app/config/greeting" \
  --value "Something new - no redeploy needed!" \
  --overwrite
```

---

## Useful one-liners

Invoke the Lambda directly (skipping Step Functions):

```bash
aws lambda invoke \
  --function-name workflow-task \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  out.json && cat out.json
```

Kick off a state machine execution from the CLI:

```bash
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:508471420037:stateMachine:workflow-state-machine \
  --input '{}'
```

Tear everything down cleanly:

```bash
cdk destroy --all
```

CloudWatch log groups have `RemovalPolicy.DESTROY` set, so they're cleaned up automatically.