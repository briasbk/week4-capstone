import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as pipelines from 'aws-cdk-lib/pipelines';
import { WorkflowStack } from './workflow-stack';

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'workflow-cicd-pipeline',
      selfMutation: false,
      dockerEnabledForSynth: false,
      crossAccountKeys: false,
      synth: new pipelines.ShellStep('Synth', {
        input: pipelines.CodePipelineSource.connection(
          'briasbk/week4-capstone',
          'main',
          {
            connectionArn:
              'arn:aws:codeconnections:us-east-1:508471420037:connection/e5465b63-ff89-4a00-b735-738015dc4181',
          }
        ),
        commands: ['npm ci', 'npm run build', 'npx cdk synth'],
      }),
    });

    pipeline.addStage(
      new WorkflowAppStage(this, 'Deploy', {
        env: { account: '508471420037', region: 'us-east-1' },
      })
    );
  }
}

class WorkflowAppStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props?: cdk.StageProps) {
    super(scope, id, props);
    new WorkflowStack(this, 'WorkflowStack');
  }
}