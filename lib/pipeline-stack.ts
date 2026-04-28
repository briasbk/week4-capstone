import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  CodePipeline,
  CodePipelineSource,
  ShellStep,
} from 'aws-cdk-lib/pipelines';
import { AppStack } from './app-stack';

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const pipeline = new CodePipeline(this, 'CapstoneDeployPipeline', {
      pipelineName: 'Week4-Capstone-Pipeline',
      synth: new ShellStep('Synth', {
        input: CodePipelineSource.connection(
          'briasbk/week4-capstone',   // ← your GitHub username/repo
          'main',
          {
            connectionArn:
              'arn:aws:codeconnections:us-east-1:508471420037:connection/307841f1-3f32-4f99-a8c1-7440ae902383', // ← paste your ARN here
          }
        ),
        commands: ['npm ci', 'npm run build', 'npx cdk synth'],
      }),
    });

    pipeline.addStage(new AppStage(this, 'Deploy'));
  }
}

class AppStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props?: cdk.StageProps) {
    super(scope, id, props);
    new AppStack(this, 'AppStack');
  }
}