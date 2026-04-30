# Week 4 Capstone: Advanced IaC & Automated Workflows

A fully automated, serverless cloud platform built with **AWS CDK**, **Step Functions**, **Lambda**, **SSM Parameter Store**, and **CodePipeline** — deployed end-to-end from a single `git push` to this repository.

---

## Architecture Overview

```
GitHub (main branch — briasbk/week4-capstone)
       │
       ▼  webhook trigger
┌──────────────────────────┐
│   AWS CodePipeline       │  CDK Pipelines (self-mutating)
│   workflow-cicd-pipeline │
│  ┌──────────────────┐    │
│  │  Source Stage    │    │  CodeStar Connection → GitHub
│  └────────┬─────────┘    │
│  ┌────────▼─────────┐    │
│  │  Build Stage     │    │  CodeBuild: npm ci → tsc → cdk synth
│  └────────┬─────────┘    │
│  ┌────────▼─────────┐    │
│  │  Deploy Stage    │    │  CloudFormation deploys WorkflowStack
│  └────────┬─────────┘    │
└───────────┼──────────────┘
            │
            ▼
┌───────────────────────────────────────────────────┐
│                  WorkflowStack                    │
│                                                   │
│  ┌──────────────────────────────────────────┐     │
│  │  SSM Parameter Store                     │     │
│  │  /app/config/greeting                    │     │
│  └─────────────────┬────────────────────────┘     │
│                    │ grantRead (IAM)               │
│  ┌─────────────────▼────────────────────────┐     │
│  │  Lambda Function: workflow-task           │     │
│  │  Runtime: Node.js 18 · Logs → CloudWatch │     │
│  └─────────────────┬────────────────────────┘     │
│                    │ invoked by                    │
│  ┌─────────────────▼────────────────────────┐     │
│  │  Step Functions: workflow-state-machine   │     │
│  │                                           │     │
│  │  ① [Pass]  Validate Input                │     │
│  │       ↓                                   │     │
│  │  ② [Wait]  Wait For Ready (1 s)          │     │
│  │       ↓                                   │     │
│  │  ③ [Task]  Invoke Lambda                 │     │
│  │       │  └─ Retry ×2 (backoff ×2)        │     │
│  │       │  └─ Catch → [Fail]               │     │
│  │       ↓                                   │     │
│  │  ④ [Succeed]                             │     │
│  └───────────────────────────────────────────┘     │
└───────────────────────────────────────────────────┘
```

### AWS Services Used

| Service | Role |
|---|---|
| **AWS CDK (TypeScript)** | Infrastructure as Code — all resources defined in code |
| **CDK Pipelines / CodePipeline** | CI/CD — auto-deploys on every push to `main` |
| **CodeBuild** | Compiles TypeScript and synthesises CloudFormation |
| **SSM Parameter Store** | Dynamic runtime config (`/app/config/greeting`) |
| **AWS Lambda (Node.js 18)** | Reads SSM value at runtime, logs it to CloudWatch |
| **AWS Step Functions** | Orchestrates 3-state workflow with retries & error handling |
| **CloudWatch Logs** | Observability for Lambda and Step Functions |
| **IAM** | Least-privilege: Lambda role can only read its one SSM param |

---

## Repository Structure

```
week4-capstone/
├── bin/
│   └── app.ts                 # CDK entrypoint
├── lib/
│   ├── pipeline-stack.ts      # CodePipeline CI/CD stack
│   └── workflow-stack.ts      # SSM + Lambda + Step Functions
├── lambda/
│   └── index.js               # Lambda handler (reads SSM)
├── screenshots/               # Add deployment screenshots here
├── cdk.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Deployment Guide

### Prerequisites

```bash
node --version   # >= 18
aws --version    # >= 2
cdk --version    # >= 2.150  (npm install -g aws-cdk)
```

### 1 — Clone & install

```bash
git clone https://github.com/briasbk/week4-capstone.git
cd week4-capstone
npm install
```

### 2 — Configure AWS CLI

```bash
aws configure
# Region: us-east-1
# Account: 508471420037
```

### 3 — Bootstrap CDK (once per account/region)

```bash
cdk bootstrap aws://508471420037/us-east-1
```

### 4 — Deploy the pipeline

```bash
cdk deploy WorkflowPipelineStack
```

This deploys the self-mutating CodePipeline. From this point forward, every `git push` to `main` automatically builds and re-deploys the full stack.

### 5 — Watch the pipeline

Go to **AWS Console → CodePipeline → workflow-cicd-pipeline** and watch all stages turn green.

### 6 — Execute the State Machine

1. **AWS Console → Step Functions → workflow-state-machine**
2. Click **Start execution** → use default input `{}` → **Start execution**
3. Watch the visual graph — all states should turn green

---

## Evidence of Deployment

### ✅ CodePipeline — Successful Execution

> All stages (Source → Build → Deploy) completed successfully.

![CodePipeline Success](screenshots/codepipeline-success.png)

---

### ✅ Step Functions — Visual Execution Graph

> All 4 states highlighted green: Validate Input → Wait For Ready → Invoke Lambda → Succeed.

![Step Functions Execution](screenshots/stepfunctions-execution.png)

---

### ✅ CloudWatch Logs — Lambda SSM Retrieval

> Lambda logs confirming the SSM parameter was retrieved successfully at runtime.

![CloudWatch Logs](screenshots/cloudwatch-lambda-logs.png)

---

## Key Design Decisions

### Least-Privilege IAM
CDK's `configParam.grantRead(workflowLambda)` scopes the Lambda's IAM policy to `ssm:GetParameter` on the exact ARN of `/app/config/greeting` only — nothing broader.

### Step Functions — 3-State Workflow

| # | State | Type | Purpose |
|---|---|---|---|
| 1 | **Validate Input** | Pass | Adds a UUID correlation ID and stage metadata to the payload |
| 2 | **Wait For Ready** | Wait | 1-second pause simulating an async readiness check |
| 3 | **Invoke Workflow Lambda** | Task | Calls Lambda with **2 retries** (exponential backoff) + **Catch** block routing failures to a `Fail` terminal state |

### Self-Mutating Pipeline
`selfMutation: true` means the pipeline updates its own infrastructure before deploying the app — no manual `cdk deploy` after the first bootstrap.

### Runtime Config via SSM
The Lambda reads the SSM parameter name from an environment variable (`SSM_PARAM_NAME`). The SSM value can be updated without redeploying:

```bash
aws ssm put-parameter \
  --name "/app/config/greeting" \
  --value "New value — no redeploy needed!" \
  --overwrite
```

---

## Useful Commands

```bash
# Manually invoke the Lambda
aws lambda invoke \
  --function-name workflow-task \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  response.json && cat response.json

# Start a Step Functions execution via CLI
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:508471420037:stateMachine:workflow-state-machine \
  --input '{}'

# Tear everything down
cdk destroy --all
```
