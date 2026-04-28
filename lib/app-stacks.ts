import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. SSM Parameter
    const configParam = new ssm.StringParameter(this, 'AppGreeting', {
      parameterName: '/app/config/greeting',
      stringValue: 'Hello from CI/CD Automated Infrastructure!',
    });

    // 2. Lambda Function
    const myLambda = new lambda.Function(this, 'WorkflowLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.seconds(30),
    });

    // Grant Lambda permission to read SSM parameter
    configParam.grantRead(myLambda);

    // 3. Step Functions — State 1: Pass state
    const passState = new stepfunctions.Pass(this, 'WorkflowStarted', {
      comment: 'Workflow initialized successfully',
    });

    // 4. Step Functions — State 2: Lambda Task with retries & catch
    const lambdaTask = new tasks.LambdaInvoke(this, 'InvokeGreetingLambda', {
      lambdaFunction: myLambda,
      outputPath: '$.Payload',
    });

    lambdaTask.addRetry({
      maxAttempts: 2,
      interval: cdk.Duration.seconds(2),
    });

    lambdaTask.addCatch(
      new stepfunctions.Fail(this, 'WorkflowFailed', {
        cause: 'Lambda invocation failed',
        error: 'LAMBDA_ERROR',
      })
    );

    // 5. Chain: Pass → Lambda Task
    const definition = passState.next(lambdaTask);

    // 6. State Machine
    new stepfunctions.StateMachine(this, 'GreetingStateMachine', {
      definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(5),
      stateMachineName: 'Week4-Greeting-Workflow',
    });
  }
}