#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();

new PipelineStack(app, 'WorkflowPipelineStack', {
  env: { account: '508471420037', region: 'us-east-1' },
  description: 'CI/CD Pipeline - auto-deploys the Serverless Workflow stack',
});
