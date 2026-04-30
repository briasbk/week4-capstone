import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export class WorkflowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------- SSM Parameter ----------
    const configParam = new ssm.StringParameter(this, 'AppGreeting', {
      parameterName: '/app/config/greeting',
      stringValue: 'Hello from CI/CD Automated Infrastructure!',
      description: 'Greeting message retrieved at runtime by the Lambda function',
      tier: ssm.ParameterTier.STANDARD,
    });

    // ---------- Lambda Function ----------
    const workflowLambda = new lambda.Function(this, 'WorkflowTask', {
      functionName: 'workflow-task',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      environment: {
        SSM_PARAM_NAME: configParam.parameterName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,   // ✅ CDK manages log group creation
    });

    // Grant Lambda read access to SSM
    configParam.grantRead(workflowLambda);

    // ---------- Step Functions Log Group (explicit) ----------
    const sfnLogGroup = new logs.LogGroup(this, 'StateMachineLogs', {
      logGroupName: '/aws/states/workflow-state-machine',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------- Step Functions Definition ----------
    const validateInput = new stepfunctions.Pass(this, 'Validate Input', {
      comment: 'Validate and enrich the incoming event payload',
      parameters: {
        'correlationId.$': 'States.UUID()',
        'originalInput.$': '$',
        'stage': 'validation-complete',
      },
      resultPath: '$',
    });

    const waitForReady = new stepfunctions.Wait(this, 'Wait For Ready', {
      comment: 'Brief pause to simulate an async readiness check',
      time: stepfunctions.WaitTime.duration(cdk.Duration.seconds(1)),
    });

    const invokeLambda = new tasks.LambdaInvoke(this, 'Invoke Workflow Lambda', {
      lambdaFunction: workflowLambda,
      comment: 'Retrieve config from SSM via Lambda',
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    invokeLambda.addRetry({
      errors: [
        'Lambda.ServiceException',
        'Lambda.AWSLambdaException',
        'Lambda.SdkClientException',
        'States.TaskFailed',
      ],
      maxAttempts: 2,
      interval: cdk.Duration.seconds(2),
      backoffRate: 2,
    });

    const handleFailure = new stepfunctions.Fail(this, 'Workflow Failed', {
      comment: 'Terminal failure state after all retries exhausted',
      error: 'WorkflowError',
      cause: 'Lambda invocation failed after all retry attempts',
    });

    invokeLambda.addCatch(handleFailure, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    const workflowSuccess = new stepfunctions.Succeed(this, 'Workflow Succeeded', {
      comment: 'All steps completed successfully',
    });

    const definition = validateInput
      .next(waitForReady)
      .next(invokeLambda)
      .next(workflowSuccess);

    // ---------- State Machine with explicit X-Ray permissions ----------
    const stateMachine = new stepfunctions.StateMachine(this, 'WorkflowStateMachine', {
      stateMachineName: 'workflow-state-machine',
      definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
      stateMachineType: stepfunctions.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(5),
      logs: {
        destination: sfnLogGroup,
        level: stepfunctions.LogLevel.ALL,
        includeExecutionData: true,
      },
      tracingEnabled: true,
    });

    // Ensure the state machine's role can write X-Ray traces
    stateMachine.role?.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
        resources: ['*'],
      })
    );

    // ---------- Outputs ----------
    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: workflowLambda.functionName,
    });
    new cdk.CfnOutput(this, 'SSMParameterName', {
      value: configParam.parameterName,
    });
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
    });
  }
}