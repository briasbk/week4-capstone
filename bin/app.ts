#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';
import { WorkflowStack } from '../lib/workflow-stack';

const app = new cdk.App();

// Deploy WorkflowStack directly (bypasses CDK role assumption issues)
new WorkflowStack(app, 'WorkflowStack', {
  env: { account: '508471420037', region: 'us-east-1' },
});

// Pipeline stack (requires CDK bootstrap roles to be assumable)
new PipelineStack(app, 'WorkflowPipelineStack', {
  env: { account: '508471420037', region: 'us-east-1' },
  description: 'CI/CD Pipeline - auto-deploys the Serverless Workflow stack',
});