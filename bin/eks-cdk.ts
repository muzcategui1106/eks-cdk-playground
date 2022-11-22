#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkEksFargateStack } from '../lib/eks-cluster';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { BastionStack } from '../lib/bastion-stack'

const app = new cdk.App();
// new CdkEksFargateStack(app, 'EksCdkStack', {
//   version: eks.KubernetesVersion.V1_21,
//   clusterName: "uzcatm-cluster",
//   env: {
//     'account': "633725053664",
//     'region': "us-east-1"
//   }
// });

new BastionStack(app, 'BastionInstance', {
  env: {
    'account': "633725053664",
    'region': "us-east-1"
  }
});
