# Docker-swarm-autoscale

<a href="https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FAzure%2Fazure-quickstart-templates%2Fmaster%2Fdocker-swarm-cluster%2Fazuredeploy.json" target="_blank">
    <img src="http://azuredeploy.net/deploybutton.png"/>
</a>

This is an autoscale feature for scaling up Docker Swarm cluster hosted on Azure Virtual Machines. 

If you are not familiar with Docker Swarm, please
[read Swarm documentation](http://docs.docker.com/swarm).


## Keypoints

+ An automated way to add new slave nodes to the Swarm cluster. Autoscale criteria implemented in the feature are CPU share and memory usage. 

+ Easy to deploy - Uses [Azure Resource Manager](https://azure.microsoft.com/en-us/documentation/articles/resource-group-authoring-templates/) template to setup a Swarm cluster and to start an autoscale.

+ Uses [Azure Docker Extension](https://azure.microsoft.com/en-us/documentation/articles/virtual-machines-docker-vm-extension/) to deploy Swarm and Autoscale images on Azure VMs.

+ This service runs as a container inside the Swarm master node and uses a Docker image to run the autoscale code inside a container. Image name: [garima0079/swarmautoscale:v5](https://hub.docker.com/r/garima0079/swarmautoscale/tags/).

+ Includes Swarm fix - Uses a customized code fix image instead of docker swarm image. Image name: [garima0079/swarm](https://hub.docker.com/r/garima0079/swarm/).

+ Swarm master uses [Swarm discovery service](https://docs.docker.com/v1.5/swarm/discovery/) to identify the slave nodes in the cluster.

+ Scaling limit = 25 VMs, i.e. it can scale up upto 23 VMs.


## TO DO

+ Scaling down feature.

 
