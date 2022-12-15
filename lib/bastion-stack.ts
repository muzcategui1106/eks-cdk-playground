

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cdk from 'aws-cdk-lib';
import { UserData } from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam'

/**
 * Create my own Ec2 resource and Ec2 props as these are not yet defined in CDK
 * These classes abstract low level details from CloudFormation
 */
class Ec2InstanceProps { }

export class BastionStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props?: Ec2InstanceProps) {
        super(scope, id, props);
        const vpc = ec2.Vpc.fromLookup(this, "cluster-vpc", { isDefault: false, vpcId: "vpc-0b4ebb5fa7b2e672b" })
        // define a user data script to install & launch our web server 
        const ssmaUserData = UserData.forLinux();
        // make sure the latest SSM Agent is installed.
        const SSM_AGENT_RPM = 'https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm';
        ssmaUserData.addCommands(`sudo yum install -y ${SSM_AGENT_RPM}`, 'restart amazon-ssm-agent');
        // install and start Nginx
        ssmaUserData.addCommands('yum install -y nginx', 'chkconfig nginx on', 'service nginx start');

        // define the IAM role that will allow the EC2 instance to communicate with SSM 
        const role = new iam.Role(this, 'BastionRole', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
        });
        // arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
        role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

        role.addToPolicy(new iam.PolicyStatement({
            sid: "AssumeAnyRoleForSimplicity",
            effect: iam.Effect.ALLOW,
            actions: ["sts:AssumeRole"],
            resources: [
                `arn:aws:iam::${this.account}:role/EksCdkStackEksCluster*`
            ],
        }))

        role.addToPolicy(new iam.PolicyStatement({
            sid: "EksActions",
            effect: iam.Effect.ALLOW,
            actions: ["eks:DescribeCluster"],
            resources: [
                `arn:aws:eks:us-east-1:${this.account}:cluster/*`,
            ],
        }))

        // create the instance
        new ec2.Instance(this, id, {
            instanceName: "eks-bastion",
            vpc: vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            },
            instanceType: ec2.InstanceType.of(
                ec2.InstanceClass.T3,
                ec2.InstanceSize.MICRO,
            ),
            machineImage: new ec2.AmazonLinuxImage({
                generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
            }),
            userData: ssmaUserData,
            role: role,
        })
    }
}
