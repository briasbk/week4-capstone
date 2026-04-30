import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export class WorkflowStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─────────────────────────────────────────────
    // 1. SSM Parameter Store – dynamic configuration
    // ─────────────────────────────────────────────
    const configParam = new ssm.StringParameter(this, 'AppGreeting', {
      parameterName: '/app/config/greeting',
      stringValue: 'Hello from CI/CD Automated Infrastructure!',
      description: 'Greeting message retrieved at runtime by the Lambda function',
      tier: ssm.ParameterTier.STANDARD,
    });

    // ─────────────────────────────────────────────
    // 2. CloudWatch Log Group for Lambda
    // ─────────────────────────────────────────────
    const lambdaLogGroup = new logs.LogGroup(this, 'WorkflowLambdaLogs', {
      logGroupName: '/aws/lambda/workflow-task',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─────────────────────────────────────────────
    // 3. Lambda Function – reads SSM at runtime
    // ─────────────────────────────────────────────
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
      logGroup: lambdaLogGroup,
    });

    // Grant Lambda least-privilege read access to the SSM parameter
    configParam.grantRead(workflowLambda);

    // ─────────────────────────────────────────────
    // 4. CloudWatch Log Group for Step Functions
    // ─────────────────────────────────────────────
    const sfnLogGroup = new logs.LogGroup(this, 'StateMachineLogs', {
      logGroupName: '/aws/states/workflow-state-machine',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─────────────────────────────────────────────
    // 5. Step Functions – State Machine Definition
    // ─────────────────────────────────────────────

    // State 1: Pass state – enrich/validate the input before processing
    const validateInput = new stepfunctions.Pass(this, 'Validate Input', {
      comment: 'Validate and enrich the incoming event payload',
      parameters: {
        'correlationId.$': 'States.UUID()',
        'originalInput.$': '$',
        'stage': 'validation-complete',
      },
      resultPath: '$',
    });

    // State 2: Wait state – simulate an async checkpoint (1 second)
    const waitForReady = new stepfunctions.Wait(this, 'Wait For Ready', {
      comment: 'Brief pause to simulate an async readiness check',
      time: stepfunctions.WaitTime.duration(cdk.Duration.seconds(1)),
    });

    // State 3: Task state – invoke Lambda with retries and error handling
    const invokeLambda = new tasks.LambdaInvoke(this, 'Invoke Workflow Lambda', {
      lambdaFunction: workflowLambda,
      comment: 'Retrieve config from SSM via Lambda',
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // Retry up to 2 times with exponential backoff
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

    // Catch any unhandled errors and route to a Fail state
    const handleFailure = new stepfunctions.Fail(this, 'Workflow Failed', {
      comment: 'Terminal failure state after all retries exhausted',
      error: 'WorkflowError',
      cause: 'Lambda invocation failed after all retry attempts',
    });

    invokeLambda.addCatch(handleFailure, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // Success terminal state
    const workflowSuccess = new stepfunctions.Succeed(this, 'Workflow Succeeded', {
      comment: 'All steps completed successfully',
    });

    // Chain: Validate → Wait → Invoke Lambda → Succeed
    const definition = validateInput
      .next(waitForReady)
      .next(invokeLambda)
      .next(workflowSuccess);

    new stepfunctions.StateMachine(this, 'WorkflowStateMachine', {
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

    // ─────────────────────────────────────────────
    // 6. Stack Outputs
    // ─────────────────────────────────────────────
    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: workflowLambda.functionName,
      description: 'Workflow Lambda function name',
    });

    new cdk.CfnOutput(this, 'SSMParameterName', {
      value: configParam.parameterName,
      description: 'SSM Parameter name',
    });
  }
}
