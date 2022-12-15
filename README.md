# EKS playground

TBD overview

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template


# Prerequisites

* Create  VPC in us-east-1
* create three private subnets
* Remove any internet or NAT gateway associated with the VPC
* Create the following VPC endpoints with the default security group of the VPC
    * ec2
    * lambda
    * sts
    * cloud formation
    * ssm
    * ssm-messages
    * ssm-ec2-messages
    * emr containers
    * s3 (gateway)
    * ecr.api
    * ecr.dkr
    * logs
* Remove inboud rule from default security group of the VPC otherwise EKS cluster wont be able to talk to vpc endpoints
    * add Inbound rule from anywhere within the VPC for port 443


# To Figure out
* how to protect the master role for the EKS cluster, at the moment any role within the account can assume the masterrole this is not ok
* how to create 2 different instances of ArgoCD, at the moment, there seems to be collision 


# what is verified to work
* Cluster provisioning (connectivity is done through bastion host using SSM)
* 