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
