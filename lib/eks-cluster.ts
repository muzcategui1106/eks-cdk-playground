/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { CfnClusterSecurityGroup } from 'aws-cdk-lib/aws-redshift';

export interface CdkEksFargateStackProps extends cdk.StackProps {
  version: eks.KubernetesVersion;
  clusterName: string;
}

export class CdkEksFargateStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: CdkEksFargateStackProps) {
    super(scope, id, props);
    const vpc = ec2.Vpc.fromLookup(this, "cluster-vpc", { isDefault: false, vpcId: "vpc-0b4ebb5fa7b2e672b" })


    // cluster master role
    // const masterRole = new iam.Role(this, 'cluster-master-role', {
    //   roleName = props.clusterName,
    //   assumedBy: new iam.AccountRootPrincipal(),
    //   managedPolicies: [
    //     iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),
    //     iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy')

    //     iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy')
    //     iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy')
    //     iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy')
    //     iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy')

    //   ],
    // });




    // Create a EKS cluster with Fargate profile.
    const cluster = new eks.Cluster(this, 'eks-cluster', {
      version: props.version,
      //mastersRole: masterRole,
      clusterName: props.clusterName,

      // Networking related settings listed below - important in enterprise context.
      endpointAccess: eks.EndpointAccess.PRIVATE, // In Enterprise context, you may want to set it to PRIVATE.
      vpc: vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }], // you can also specify the subnets by other attributes


      // output cluster information from the stack so we can connect 
      outputClusterName: true,
      outputConfigCommand: true,
    });

    // manage security groups for cluster and workers
    cluster.clusterSecurityGroup.addEgressRule(ec2.Peer.ipv4(cluster.vpc.vpcCidrBlock), ec2.Port.tcp(443), "connectivity to services running in port 443")
    cluster.clusterSecurityGroup.addIngressRule(ec2.Peer.ipv4(cluster.vpc.vpcCidrBlock), ec2.Port.tcp(53), "dns connectivity tcp")
    const workersSecuirityGroup = new ec2.SecurityGroup(this, "WorkersSG", {
      vpc: vpc,
      description: "base security group for all workers in the kubernetes cluster",
      allowAllOutbound: false,
    })

    const connectionWorkersSG = new ec2.Connections({
      securityGroups: [workersSecuirityGroup],
    })

    const connectionClusterSG = new ec2.Connections({
      securityGroups: [cluster.clusterSecurityGroup]
    })

    // rules for worker
    workersSecuirityGroup.connections.allowFrom(connectionWorkersSG, ec2.Port.allTraffic(), "allow any traffic between worker nodes")
    workersSecuirityGroup.connections.allowTo(connectionClusterSG, ec2.Port.tcp(443), "allow traffic to API server")
    workersSecuirityGroup.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTcp(), "allow any tcp traffic to VPC")
    workersSecuirityGroup.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allUdp(), "allow any UDP traffic to VPC")

    // Apart from the permission to access the S3 bucket above, you can also grant permissions of other AWS resources created in this CDK app to such AWS IAM role.
    // Then in the follow-up CDK8S Chart, we will create a K8S Service Account to associate with this AWS IAM role and a nginx K8S deployment to use the K8S SA.
    // As a result, the nginx Pod will have the fine-tuned AWS permissions defined in this AWS IAM role.

    // to allow pod running on fargate, we need to define pod execution role and fargate profile
    // https://docs.aws.amazon.com/cdk/api/v1/docs/@aws-cdk_aws-eks.FargateProfile.html
    const AmazonEKSForFargateServiceRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"],
      resources: ["*"],
    })

    const FargateLoggingStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogStream',
        'logs:CreateLogGroup',
        'logs:DescribeLogStreams',
        'logs:PutLogEvents'
      ],
      resources: ['*']
    })

    const fargatePodExecutionRole = new iam.Role(this, "AmazonEKSFargatePodExecutionRole", {
      roleName: "AmazonEKSFargatePodExecutionRole",
      assumedBy: new iam.PrincipalWithConditions(new iam.ServicePrincipal("eks-fargate-pods.amazonaws.com"),
      {"ArnLike": {"aws:SourceArn": `arn:aws:eks:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:fargateprofile/*`}}),
      inlinePolicies: {
        AmazonEKSForFargateServiceRolePolicy: new iam.PolicyDocument({
          statements: [AmazonEKSForFargateServiceRolePolicy, FargateLoggingStatement]
        })
      }
    })

    cluster.addFargateProfile("FargateProfileAllNamespaces", {
      selectors: [{ namespace: "*" }],
      podExecutionRole: fargatePodExecutionRole,
      fargateProfileName: "FargateProfileAllNamespaces"
    })


    // autoscaling 
    cluster.addAutoScalingGroupCapacity("general-worker-auto-scaling-group", {
      instanceType: new ec2.InstanceType("t2.medium"),
      minCapacity: 1,
      maxCapacity: 100,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    })



  }
}