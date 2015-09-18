var fs = require('fs'),
    events = require('events'),
    os = require('os'),
    path = require('path'),
    http = require('http');

var templateOperations = require('./templateOperations'),
    utils = require('./autoscaleUtils'),
    constants = require('./autoscaleConstants');


process.env.FILE_DIRECTORY = path.join('.', 'files');
var tableName = 'diagnosticsTable';


/*
 * Autoscale agent class - Includes function for the monitoring the CPU usage of the cluster and for scaling up action
 * in high load scenario. This agent runs on the Swarm master node to monitor and scale up the cluster.
 * **/
var AutoscaleAgentOperations = (function() {

    var self = null;
    var i = 0;
    var timerId = null;
    var intervalIdDeploymentStatus = null;
    var intervalId = null;

    /* Constructor - To initialize the environment and class variables from the Autoscale config file. */
    function AutoscaleAgentOperations(resourceGroup, criteria) {

        console.log('\n>>>>>>>> Initilizing the Autoscale agent...');
        console.log('Resource group: ' + resourceGroup + '\nAutoscale criteria: ' + criteria);

        try {
            self = this;
            if (!fs.existsSync(process.env.FILE_DIRECTORY)) {
                fs.mkdirSync(process.env.FILE_DIRECTORY);
            }

            this.deploymentTemplateFilePath = path.join(process.env.FILE_DIRECTORY, 'deploymentTemplate.json');
            if (!resourceGroup) {
                throw new Error('Resource group can not be null');
            }
            this.resourceGroup = resourceGroup;
            if (criteria.toLowerCase() !== 'memory' && criteria.toLowerCase() !== 'cpu') {
                throw new Error('Autoscale criteria sould either CPU or Memory.');
            }
            this.criteria = criteria.toLowerCase();
        } catch (e) {
            throw e;
        }
    }

    /**
     * Start funtion for the Autoscale agent. It checks the deployment status of the slaves before starting the agent.
     * Download the template and save it locally for redeployment. Start monitoring the CPU usage of the slaves.
     **/
    AutoscaleAgentOperations.prototype.startAgent = function(callback) {

        console.log('\nStarting autoscale agent..');
        if (!fs.existsSync(this.deploymentTemplateFilePath)) {

            /* Download the template for the later re-deployments. */
            templateOperations.getTemplateForDeployment(this.resourceGroup, function(err, deploymentTemplate) {
                if (err) {
                    return callback(err);
                }
                try {
                    deploymentTemplate.properties.parameters.slaveCount.value = deploymentTemplate.properties.parameters.nodeCount.value;
                    fs.writeFileSync(self.deploymentTemplateFilePath, JSON.stringify(deploymentTemplate, null, 4));

                    monitorStats(function(err) {
                        if (err) {
                            if (intervalId)
                                clearInterval(intervalId);
                            if (intervalIdDeploymentStatus)
                                clearInterval(intervalIdDeploymentStatus);
                            callback(err);
                        }
                    });
                } catch (e) {
                    callback(e);
                }
            });

        } else {

            // If the template already exists locally, start monitoring right away.
            monitorStats(function(err) {
                if (err) {
                    if (intervalId)
                        clearInterval(intervalId);
                    if (intervalIdDeploymentStatus)
                        clearInterval(intervalIdDeploymentStatus);
                    callback(err);
                }
            });
        }

    }

    /*
     * Monitor the cluster for CPU usage and call the scaling operation. 
     * */
    function monitorStats(callback) {
        console.log('++ Checking ' + self.criteria + ' after every ' + constants.MONITORING_INTERVAL + ' seconds');
        intervalId = setInterval(function() {
            var dockerInfoUrl = process.env.SWARM_PORT;
            dockerInfoUrl = dockerInfoUrl.replace("tcp", "http") + '/info';
            console.log('\nGET ' + dockerInfoUrl);
            utils.downloadJson(dockerInfoUrl, http, function(err, response) {
                if (err) {
                    callback(err);
                }
                try {
                    var doAutoScale;
                    if (self.criteria === 'cpu') {
                        doAutoScale = getCPUShareStatus(response);
                    }

                    if (self.criteria === 'memory') {
                        doAutoScale = getUsedMemoryStatus(response);
                    }


                    if (doAutoScale) {
                        console.log('Not enough ' + self.criteria.toUpperCase() + '. Checking again..');
                        i++;
                    } else {
                        i--;
                        if (i < 0)
                            i = 0;
                    }
                } catch (e) {
                    callback(e);
                }

                if (i >= 2) {
                    i = 0;
                    console.log('-> Scaling up the Swarm cluster.');
                    clearInterval(intervalId);
                    scaleUp(function(err) {
                        if (err) {
                            return callback(err);
                        }
                    });
                }
            });
        }, constants.MONITORING_INTERVAL * 1000); /* Monitoring interval */
    }

    function getUsedMemoryStatus(data) {
        try {
            var nodesData = JSON.parse(data);
            var flag = false;
            var node = 1;
            var msg = 'Available memory:';

            for (var i = 0; i < nodesData.DriverStatus.length; i++) {
                if (nodesData.DriverStatus[i].toString().indexOf('Memory') > -1) {

                    var mem = nodesData.DriverStatus[i].toString().split(",")[1].split("/");
                    var usedUnits = mem[0].replace(/[\d.]/g, '').trim();
                    var usedMem = mem[0].replace(/[^\d.]/g, '').trim();

                    var totalAvailableUnits = mem[1].replace(/[\d.]/g, '').trim();
                    var totalAvailableMem = mem[1].replace(/[^\d.]/g, '').trim();

                    totalAvailableMem = parseFloat(totalAvailableMem);
                    usedMem = parseFloat(usedMem);
                    if (usedUnits !== 'GiB')
                        usedMem = usedMem * 0.001; // if the memory mentioned is in MB. Convert to GB.

                    msg += '\n node' + (node++) + ' ' + (totalAvailableMem - usedMem) + ' GiB';
                    if ((totalAvailableMem - usedMem) < 1)
                        flag = true;
                    else {
                        flag = false;
                        break;
                    }
                }
            }
            console.log(msg);
            return flag;
        } catch (e) {
            throw e;
        }
    }

    function getCPUShareStatus(data) {
        try {
            var nodesData = JSON.parse(data);
            var CPUAvailable = nodesData.NCPU;
            var usedCPUShare = 0.0;
            for (var i = 0; i < nodesData.DriverStatus.length; i++) {
                if (nodesData.DriverStatus[i].toString().indexOf('CPUs') > -1) {
                    var cpuShare = nodesData.DriverStatus[i].toString().split(",")[1].split("/");
                    usedCPUShare += parseInt(cpuShare[0]);
                }
            }
            console.log('Total CPU share available for jobs: ' + (CPUAvailable - usedCPUShare) + ' out of ' + CPUAvailable);
            return (usedCPUShare === CPUAvailable);
        } catch (e) {
            throw e;
        }
    }

    /*
     * It does ARM API calls for scaling up and for creating new resources. Also, keep track of new deployment.
     * */
    function scaleUp(callback) {
        utils.getToken(function(err, token) {
            if (err) {
                return callback(err);
            }
            try {
                var armClient = utils.getResourceManagementClient(process.env.SUBSCRIPTION, token); /* resourceManagementClient */
                var parameters = {
                    resourceGroupName: self.resourceGroup,
                    resourceType: "Microsoft.Compute/virtualMachines/extensions"
                }

                /* Check the slave count to set name index for the next slave e.g. Slave1, Slave2. */
                armClient.resources.list(parameters, function(err, response) {
                    if (response.statusCode !== 200)
                        return callback(response.statusCode);
                    if ((response.resources.length - 1) > 25) {
                        return callback(new Error('Limit exceeded. Can\'t create more than 25 VMs'));
                    }

                    var deploymentTemplate = fs.readFileSync(self.deploymentTemplateFilePath, 'utf8');
                    var template = JSON.parse(deploymentTemplate.replace(/\(INDEX\)/g, '(' + (response.resources.length - 1) + ')'));
                    self.deploymentName = "Deployment-" + new Date().getTime();

                    armClient.deployments.createOrUpdate(self.resourceGroup, self.deploymentName, template, function(err, result) {
                        if (err) {
                            return callback(err);
                        }

                        console.log('++Starting ' + self.deploymentName + ', Status code: ' + result.statusCode);
                        intervalIdDeploymentStatus = setInterval(function() {

                            /* Check deployment status on regular interval */
                            checkDeploymentStatus(function(err, result) {
                                if (err) {
                                    return callback(err);
                                }

                                /* If deployment succeeds, start the timeout to stablize the CPU load across the nodes */
                                if (result === 'Succeeded') {
                                    clearInterval(intervalIdDeploymentStatus);
                                    console.log(self.deploymentName + ' Succeeded');
                                    setTimeout(function() {
                                        console.log("\n>>> Timeout after scaling up operation.");
                                        self.startAgent();
                                    }, constants.TIMEOUT * 1000);
                                }

                            });
                        }, constants.CHECK_STATUS_INTERVAL * 1000);
                    });
                });
            } catch (e) {
                return callback(e);
            }
        });
    }

    /* 
     * Check deployment status of the scaling up deployment.
     **/
    function checkDeploymentStatus(callback) {
        utils.getToken(function(err, token) {
            if (err) {
                return callback(err);
            }
            try {
                var armClient = utils.getResourceManagementClient(process.env.SUBSCRIPTION, token);
                armClient.deployments.get(self.resourceGroup, self.deploymentName, function(err, data) {
                    if (err) {
                        return callback(err);
                    }
                    if (data.deployment.properties.provisioningState === 'Running' || data.deployment.properties.provisioningState === 'Accepted') {
                        console.log('Deployment status:' + data.deployment.properties.provisioningState);
                    } else if (data.deployment.properties.provisioningState === 'Failed') {
                        return callback(new Error('Deployment Failed'));
                    } else {
                        return callback(null, data.deployment.properties.provisioningState);
                    }
                });
            } catch (e) {
                callback(e);
            }
        });
    }

    return AutoscaleAgentOperations;
})();


function start() {

    try {
        autoscale = new AutoscaleAgentOperations(process.argv[2], process.argv[3]);
        autoscale.startAgent(function(err) {
            if (err) {
                console.log(err.message);
            }
        });
    } catch (e) {
        console.log(e.message);
    }
}


start();
