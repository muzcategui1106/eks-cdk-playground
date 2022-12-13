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
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling'
import * as blueprints from '@aws-quickstart/eks-blueprints';
import 'source-map-support/register';

export interface CdkEksFargateStackProps extends cdk.StackProps {
  version: eks.KubernetesVersion;
  clusterName: string;
  userNamespaces: string[]
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

    const addOns: Array<blueprints.ClusterAddOn> = [
      new blueprints.SecretsStoreAddOn(),
      new blueprints.ClusterAutoScalerAddOn(),
      addArgocdAdmin(),
      addArgocdUsers(),
    ]


    const asgClusterProps: blueprints.AsgClusterProviderProps = {
      version: props.version,
      clusterName: props.clusterName,
      vpc: vpc,
      privateCluster: true,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }], // you can also specify the subnets by other attributes
      outputClusterName: true,
      outputConfigCommand: true,

      // autoscaling parameters
      id: "general-workers",
      minSize: 1,
      maxSize: 50,
      desiredSize: 4,
      instanceType: new ec2.InstanceType('m5.large'),
      machineImageType: eks.MachineImageType.AMAZON_LINUX_2,
      updatePolicy: autoscaling.UpdatePolicy.rollingUpdate(),
    }
    const clusterProvider = new blueprints.AsgClusterProvider(asgClusterProps)

    const bluePrint = blueprints.EksBlueprint.builder()
      .account(this.account)
      .region(this.region)
      .addOns(...addOns)
      .clusterProvider(clusterProvider)
      .build(this, 'EksCluster');
    
    const cluster = bluePrint.getClusterInfo().cluster


    //addBastionHosts(this, cluster)

    // manage security groups for cluster and workers
    // remove the ingress security rule for port 443. only there for experimentation
    cluster.clusterSecurityGroup.addIngressRule(ec2.Peer.ipv4(cluster.vpc.vpcCidrBlock), ec2.Port.tcp(443), "connectivity from other things running in the cluster")
    cluster.clusterSecurityGroup.addEgressRule(ec2.Peer.ipv4(cluster.vpc.vpcCidrBlock), ec2.Port.tcp(443), "connectivity to services running in port 443")
    cluster.clusterSecurityGroup.addEgressRule(ec2.Peer.ipv4(cluster.vpc.vpcCidrBlock), ec2.Port.tcp(53), "dns connectivity tcp")
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

    addUserNamespaces(this, cluster, props.userNamespaces)
  }
}

function addUserNamespaces(stack: cdk.Stack, cluster: eks.ICluster, userNamespaces: string[]){
  userNamespaces.forEach(element => {
    addNamespace(stack, cluster, element)
  })
}

function addNamespace(stack: cdk.Stack, cluster: eks.ICluster, namespaceName: string){
  cluster.addManifest(`EKSNamespace-${namespaceName}`, {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: { name: namespaceName },
    spec: {}
  })
}


function addArgocdAdmin(): blueprints.ClusterAddOn {
  return new blueprints.ArgoCDAddOn()
}

function addArgocdUsers(): blueprints.ClusterAddOn {
  const repoUrl = 'https://github.com/argoproj/argocd-example-apps.git'
  
  const bootstrapRepo: blueprints.ApplicationRepository = {
      repoUrl,
  }
  
  const devBootstrapArgo = new blueprints.ArgoCDAddOn({
      bootstrapRepo: {
          ...bootstrapRepo,
          path: 'guestbook',
          targetRevision: "master"
      },
      namespace: "argocd-users",
  });


  return devBootstrapArgo
}

// function addFargateConfig() {
      // to allow pod running on fargate, we need to define pod execution role and fargate profile
    // https://docs.aws.amazon.com/cdk/api/v1/docs/@aws-cdk_aws-eks.FargateProfile.html
    // const AmazonEKSForFargateServiceRolePolicy = new iam.PolicyStatement({
    //   effect: iam.Effect.ALLOW,
    //   actions: ["ecr:GetAuthorizationToken",
    //     "ecr:BatchCheckLayerAvailability",
    //     "ecr:GetDownloadUrlForLayer",
    //     "ecr:BatchGetImage"],
    //   resources: ["*"],
    // })

    // const FargateLoggingStatement = new iam.PolicyStatement({
    //   effect: iam.Effect.ALLOW,
    //   actions: [
    //     'logs:CreateLogStream',
    //     'logs:CreateLogGroup',
    //     'logs:DescribeLogStreams',
    //     'logs:PutLogEvents'
    //   ],
    //   resources: ['*']
    // })

    // const fargatePodExecutionRole = new iam.Role(this, "AmazonEKSFargatePodExecutionRole", {
    //   roleName: "AmazonEKSFargatePodExecutionRole",
    //   assumedBy: new iam.PrincipalWithConditions(new iam.ServicePrincipal("eks-fargate-pods.amazonaws.com"),
    //     { "ArnLike": { "aws:SourceArn": `arn:aws:eks:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:fargateprofile/*` } }),
    //   inlinePolicies: {
    //     AmazonEKSForFargateServiceRolePolicy: new iam.PolicyDocument({
    //       statements: [AmazonEKSForFargateServiceRolePolicy, FargateLoggingStatement]
    //     })
    //   }
    // })

    // cluster.addFargateProfile("FargateProfileAllNamespaces", {
    //   selectors: [{ namespace: "*" }],
    //   podExecutionRole: fargatePodExecutionRole,
    //   fargateProfileName: "FargateProfileAllNamespaces"
    // })
//}

// function addBastionHosts(stack: cdk.Stack, cluster: eks.ICluster) {
//   const bastionNamespace = "bastion-hosts"
//   addNamespace(stack, cluster, bastionNamespace)
  
//   const BastionReadOnlySA = cluster.addServiceAccount("BastionReadOnly", {
//     name: "bastion-read-only",
//     namespace: "some",
//   })
//   const bastionReadWriteSA = cluster.addServiceAccount("BastionReadWrite", {
//     namespace: bastionNamespace,
//     name: "bastion-read-write"
//   })

//   eksBastionHost(stack, cluster.vpc, BastionReadOnlySA.role, cluster.clusterName + "-bastion-read-only")
//   eksBastionHost(stack, cluster.vpc, bastionReadWriteSA.role, cluster.clusterName + "-bastion-read-write")
// }

// class EksBastionHost extends cdk.NestedStack {
//   constructor(scope: Construct, id: string, props?: cdk.NestedStackProps) {
//     super(scope, id, props);

//     eksBastionHost(this, )
//   }

// }


// function eksBastionHost(stack: cdk.Stack, vpc: ec2.IVpc,  role: iam.IRole, instanceName: string) {
//   // define a user data script to install & launch our web server 
//   const ssmaUserData = UserData.forLinux();
//   // make sure the latest SSM Agent is installed.
//   const SSM_AGENT_RPM = 'https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm';
//   ssmaUserData.addCommands(`sudo yum install -y ${SSM_AGENT_RPM}`, 'restart amazon-ssm-agent');
//   // install and start Nginx
//   ssmaUserData.addCommands('yum install -y nginx', 'chkconfig nginx on', 'service nginx start');

//   // arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
//   role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

//   // create the instance
//   const instanceID = `${stack.stackId}-instance`
//   new ec2.Instance(stack, instanceID, {
//     instanceName: instanceName,
//     vpc: vpc,
//     vpcSubnets: {
//       subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
//     },
//     instanceType: ec2.InstanceType.of(
//       ec2.InstanceClass.T3,
//       ec2.InstanceSize.MICRO,
//     ),
//     machineImage: new ec2.AmazonLinuxImage({
//       generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
//     }),
//     userData: ssmaUserData,
//     role: role,
//   })
// }