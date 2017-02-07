/********************************************************* {COPYRIGHT-TOP} ***
* IBM Confidential
* OCO Source Materials
* IoT for Electronics - SVL720160500
*
* (C) Copyright IBM Corp. 2016  All Rights Reserved.
*
* The source code for this program is not published or otherwise  
* divested of its trade secrets, irrespective of what has been 
* deposited with the U.S. Copyright Office.
********************************************************* {COPYRIGHT-END} **/

var qr = require('qr-image');
var cfenv = require('cfenv');
var queue = require('seq-queue').createQueue(30000);

var device = module.exports;

/* ************** ************** **************
 * ************** UTIL FUNCTIONS **************
 * ************** ************** **************/

var setAttributeIsValid = function(deviceID, attribute, value, data){
	var status = data.attributes.status;
	
	if(!(attribute in data["attributes"])){
		return false;
	}
	
	if(attribute == "doorOpen"){
		switch(value){
		case "true":
			if(status !== "Working"){
				if(status == "Ready")
					simulationClient.setAttributeValue(deviceID, "status", "Not Ready");
			} else {
				return false;
			}
		case "false":
			if(status !== "Working"){
				if(status == "Not Ready")
					simulationClient.setAttributeValue(deviceID, "status", "Ready");
			} else {
				return false;
			}
		}
	}
	
	if(attribute == "program" && status == "Working"){
		return false;
	}

	return true;
	
}

device.getQrCode = function(req, res){
	simulationClient.getDeviceStatus(req.params.deviceID).then(function(data){
		var deviceID = req.params.deviceID;
		var serialNumber = data['attributes']['serialNumber'];
		var deviceMake = data['attributes']['make'];
		var deviceModel = data['attributes']['model'];
		var deviceType = data['deviceType'];
		
		var text = ['2', deviceID, serialNumber, deviceMake, deviceModel, deviceType].join(',');
		
		var img = qr.image(text, { type: 'png', ec_level: 'H', size: 2, margin: 0 });
		res.writeHead(200, {'Content-Type': 'image/png'})
		img.pipe(res);
	});
}

device.QRcreds = function(req, res){
	var VCAP_SERVICES = {};
	if(process.env.VCAP_SERVICES)
		VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);
	
	var appEnv = cfenv.getAppEnv();
	var org = VCAP_SERVICES['iotf-service'][0]['credentials'].org;
	var route = appEnv.url;
	var guid = VCAP_SERVICES['AdvancedMobileAccess'][0]['credentials'].clientId;
	var key = VCAP_SERVICES['iotf-service'][0]['credentials'].apiKey;
	var token = VCAP_SERVICES['iotf-service'][0]['credentials'].apiToken;
	var name = VCAP_SERVICES['iotf-service'][0].name;
	var mqtt_host = VCAP_SERVICES['iotf-service'][0]['credentials'].mqtt_host;
	//var registration_api_version = "v001";
	
	var text = ['1', org, route, guid, key, token, name, mqtt_host].join(',');
	
	var img = qr.image(text, { type: 'png', ec_level: 'H', size: 3, margin: 0 });
	res.writeHead(200, {'Content-Type': 'image/png'})
	img.pipe(res);
}

device.getPlatformQRstring = function(req, res){
	var VCAP_SERVICES = {};
	if(process.env.VCAP_SERVICES)
		VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);
	
	var appEnv = cfenv.getAppEnv();
	var org = VCAP_SERVICES['iotf-service'][0]['credentials'].org;
	var route = appEnv.url;
	var guid = VCAP_SERVICES['AdvancedMobileAccess'][0]['credentials'].clientId;
	var key = VCAP_SERVICES['iotf-service'][0]['credentials'].apiKey;
	var token = VCAP_SERVICES['iotf-service'][0]['credentials'].apiToken;
	var name = VCAP_SERVICES['iotf-service'][0].name;
	var mqtt_host = VCAP_SERVICES['iotf-service'][0]['credentials'].mqtt_host;
	//var registration_api_version = "v001";
	
	var text = ['1', org, route, guid, key, token, name, mqtt_host].join(',');
	
	res.send(text);
}

device.startWashing = function(req, res) {
	washingMachineIoTFClient.sendstartWashingMessage(req.params.deviceID);
	res.status(200).json({
		success: "true",
		command: "startWashing",
		device: req.params.deviceID,
		message: "The start washing command was sent successfully."
	});
}

device.stopWashing = function(req, res) {
	washingMachineIoTFClient.sendstopWashingMessage(req.params.deviceID);
	res.status(200).json({
		success: "true",
		command: "stopWashing",
		device: req.params.deviceID,
		message: "The stop washing command was sent successfully."
	});
}

device.getAllDevicesStatus = function(req, res){
	simulationClient.getAllDevicesStatus().then(function(data){
		res.json(data);
	});
}

device.getStatus = function(req, res) {
	simulationClient.getDeviceStatus(req.params.deviceID).then(function(data){
		res.json(data);
	});
}

device.getAttribute = function(req, res){
	simulationClient.getDeviceStatus(req.params.deviceID).then(function(data){
		if(data["attributes"][req.params.attributeName]){
			
			var key = req.params.attributeName;
			var val = data["attributes"][key];
			
			var obj = {};
			obj["deviceID"] = req.params.deviceID;
			obj["attribute"] = {};
			obj["attribute"][key] = val;
			
			res.json(obj);
			
		} else {
			res.status(400).send("Invalid attribute.");
		}
	});
}

device.setAttribute = function(req, res){
	
	var deviceID       = req.params.deviceID;
	var attributeName  = req.params.attributeName;
	var attributeValue = req.body.value;
	
	simulationClient.getDeviceStatus(deviceID).then(function(data){
		if(setAttributeIsValid(deviceID, attributeName, attributeValue, data)){
			simulationClient.setAttributeValue(deviceID, attributeName, attributeValue);
			simulationClient.getDeviceStatus(deviceID).then(function(data){
				res.json(data);
			});
		} else {
			res.status(400).send("Invalid attribute name / value.");
		}
	});
}

device.setAttributes = function(req, res){
	var deviceID  = req.params.deviceID;
	var json      = req.body;
	
	simulationClient.getDeviceStatus(deviceID).then(function(data){
		for(var key in json){
			var attributeName  = key;
			var attributeValue = json[key];
			
			if(setAttributeIsValid(deviceID, attributeName, attributeValue, data)){
				simulationClient.setAttributeValue(deviceID, attributeName, attributeValue);
			}
		}
	});
	
	simulationClient.getDeviceStatus(req.params.deviceID).then(function(data){
		res.json(data);
	});
}

device.getAttributes = function(req, res){
	simulationClient.getDeviceStatus(req.params.deviceID).then(function(data){
		
		var obj = {};
		obj["deviceID"] = req.params.deviceID;
		obj["attributes"] = {};
		obj["attributes"] = data["attributes"];
		
		res.json(obj);
	});
}

device.reset = function(req, res){
	simulationClient.restartSimulation();
	res.json("Simulation client is restarting.");
}

device.create = function(req, res){
	const MAX_LIMIT = 100;
	queue.push(function(task){
		var numberOfDevices = parseInt(req.params.numberOfDevices);
		var existingDevices = simulationClient.simulationConfig.devices.length;
		if(!isNaN(numberOfDevices)){
			if((numberOfDevices + existingDevices) > MAX_LIMIT){
				task.done();
				res.status(400).json({
					error: "Limit exceeded.",
					message: "You already have " + existingDevices + " devices created. Adding " + numberOfDevices + " more would exceed the limit of " + MAX_LIMIT + " devices."
				});
			} else {
				var configs = [];
				var devices;
				for(var i = 0; i < numberOfDevices; i++){
					configs.push({connected: true});
				}
				simulationClient.createDevices("washingMachine", numberOfDevices, configs).then(function(data){
					for(var key in data){
						var deviceID = data[key]['deviceID'];
						simulationClient.getDeviceStatus(deviceID).then(function(data){
							simulationClient.updateSerialNumber(deviceID, data.attributes.serialNumber);
						});
					}
					simulationClient.saveSimulationConfig();
					task.done();
					res.json(data);
				});
			}
		} else {
			task.done();
			res.status(400).json({
				error: "Not a number.",
				message: "Invalid number of devices was provided. Please check and try again."
			});
		}
	});	
}

device.del = function(req, res){
	simulationClient.unregisterDevice(req.params.deviceID);
	res.json("The device was deleted.");
}

device.renderUI = function(req, res){
	
	simulationClient.getDeviceStatus(req.params.deviceID).then(function(data){
		var status = 'appliance_page.' + data.attributes.status.toLowerCase();
		return res.render('device', {
			deviceId:          data.deviceID,
			deviceStatus:      res.__(status),
			vibration:         data.attributes.vibration,
			waterPressure:     data.attributes.waterPressure,
			serialNumber:      data.attributes.serialNumber,
			make:              data.attributes.make,
			model:             data.attributes.model
		});
	});
}